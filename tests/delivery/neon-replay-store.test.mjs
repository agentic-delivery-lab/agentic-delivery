import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { neon } from '@neondatabase/serverless';

import { NeonReplayStore, REPLAY_CLEANUP_BATCH_SIZE } from '../../scripts/lib/neon-replay-store.mjs';
import { replayKey, ReplayProtectionError } from '../../scripts/lib/replay-protection.mjs';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const testDatabaseUrl = process.env.AGENTIC_DELIVERY_REPLAY_TEST_DATABASE_URL;

function fakeDatabase({ now = () => Date.now(), entries = new Map(), queryError } = {}) {
  const calls = [];
  const client = {
    async query(statement, values) {
      calls.push({ statement, values });
      if (queryError) throw queryError;
      if (statement.includes('INSERT INTO public.webhook_replay_claims')) {
        const [key, cleanupLimit, ttlMs] = values;
        const expiredKeys = [...entries.entries()]
          .filter(([candidate, value]) => candidate !== key && value.expiresAt <= now())
          .sort((left, right) => left[1].expiresAt - right[1].expiresAt)
          .slice(0, cleanupLimit)
          .map(([candidate]) => candidate);
        for (const candidate of expiredKeys) entries.delete(candidate);
        const existing = entries.get(key);
        if (existing && existing.expiresAt > now()) return [];
        entries.set(key, { expiresAt: now() + ttlMs });
        return [{ replay_key: key }];
      }
      if (statement.includes('DELETE FROM public.webhook_replay_claims')) {
        entries.delete(values[0]);
        return [];
      }
      throw new Error('Unexpected replay store query.');
    },
  };
  return { client, calls, entries };
}

test('Neon replay adapter maps atomic upsert results to one successful claim', async () => {
  const database = fakeDatabase();
  const store = new NeonReplayStore({ client: database.client });
  const results = await Promise.all(Array.from({ length: 24 }, () => store.claim('163255060:98765432-1234-4234-8234-123456789012')));

  assert.equal(results.filter(Boolean).length, 1);
  assert.equal(results.filter((claimed) => !claimed).length, 23);
  const claim = database.calls[0];
  assert.match(claim.statement, /ON CONFLICT \(replay_key\) DO UPDATE/);
  assert.match(claim.statement, /SET expires_at = clock_timestamp\(\) \+ \(\$3::double precision \* INTERVAL '1 millisecond'\)/);
  assert.match(claim.statement, /WHERE stored\.expires_at <= clock_timestamp\(\)/);
  assert.match(claim.statement, /RETURNING stored\.replay_key/);
  assert.deepEqual(claim.values, ['163255060:98765432-1234-4234-8234-123456789012', REPLAY_CLEANUP_BATCH_SIZE, 300_000]);
});

test('Neon replay claims can be reclaimed after expiry and released after dispatch failure', async () => {
  let now = 1_000;
  const database = fakeDatabase({ now: () => now });
  const store = new NeonReplayStore({ client: database.client });

  assert.equal(await store.claim('163255060:expired-key', { ttlMs: 50 }), true);
  assert.equal(await store.claim('163255060:expired-key', { ttlMs: 50 }), false);
  now = 1_051;
  assert.equal(await store.claim('163255060:expired-key', { ttlMs: 50 }), true);

  await store.release('163255060:expired-key');
  assert.equal(await store.claim('163255060:expired-key', { ttlMs: 50 }), true);
  assert.match(database.calls.at(-2).statement, /DELETE FROM public\.webhook_replay_claims/);
});

test('Neon replay claim cleanup deletes at most one bounded batch of expired keys', async () => {
  const entries = new Map(Array.from({ length: REPLAY_CLEANUP_BATCH_SIZE + 1 }, (_, index) => [
    `expired-${index}`,
    { expiresAt: 0 },
  ]));
  const database = fakeDatabase({ now: () => 10, entries });
  const store = new NeonReplayStore({ client: database.client });

  assert.equal(await store.claim('163255060:new-key'), true);
  assert.equal(entries.size, 2);
  assert.match(database.calls[0].statement, /ORDER BY expires_at ASC\s+LIMIT \$2\s+FOR UPDATE SKIP LOCKED/);
});

test('Neon replay store fails closed and does not expose connection errors', async () => {
  const database = fakeDatabase({ queryError: new Error('postgresql://user:secret@host/replay') });
  const store = new NeonReplayStore({ client: database.client });

  await assert.rejects(store.claim('163255060:failure-key'), (error) => {
    assert.ok(error instanceof ReplayProtectionError);
    assert.match(error.message, /durable replay database operation failed/i);
    assert.doesNotMatch(error.message, /secret|postgresql/i);
    return true;
  });
  assert.throws(() => new NeonReplayStore({ connectionString: 'postgresql://user:secret@ep-test.us-east-1.aws.neon.tech/replay' }), (error) => {
    assert.ok(error instanceof ReplayProtectionError);
    assert.doesNotMatch(error.message, /secret|ep-test/i);
    return true;
  });
  assert.doesNotThrow(() => new NeonReplayStore({ connectionString: 'postgresql://user:password@ep-test-pooler.us-east-1.aws.neon.tech/replay' }));
  assert.doesNotThrow(() => new NeonReplayStore({ connectionString: 'postgresql://user:password@ep-test-pooler.us-east-1.aws.neon.com/replay' }));
});

test('replay migration stores only the key and expiry and indexes bounded cleanup', async () => {
  const migration = await readFile(path.join(repositoryRoot, 'api/github/migrations/0001-webhook-replay-claims.sql'), 'utf8');

  assert.match(migration, /CREATE TABLE IF NOT EXISTS public\.webhook_replay_claims\s*\(\s*replay_key text PRIMARY KEY,\s*expires_at timestamptz NOT NULL\s*\)/);
  assert.match(migration, /ON public\.webhook_replay_claims \(expires_at\)/);
  assert.doesNotMatch(migration, /\b(?:body|payload|token|private_key|model_output)\b/i);
});

test('Neon replay integration proves claim, expiry, release and stored columns', {
  skip: testDatabaseUrl ? false : 'Set AGENTIC_DELIVERY_REPLAY_TEST_DATABASE_URL to an isolated Neon database with the replay migration applied.',
}, async () => {
  const store = new NeonReplayStore({ connectionString: testDatabaseUrl });
  const sql = neon(testDatabaseUrl);
  const key = replayKey({ installationId: '163255060', deliveryId: randomUUID() });

  try {
    const concurrentClaims = await Promise.all([store.claim(key), store.claim(key)]);
    assert.deepEqual(concurrentClaims.sort(), [false, true]);
    assert.equal(await store.claim(key), false);

    await store.release(key);
    assert.equal(await store.claim(key), true);
    await store.release(key);

    assert.equal(await store.claim(key, { ttlMs: 25 }), true);
    await new Promise((resolve) => setTimeout(resolve, 100));
    assert.equal(await store.claim(key), true);

    const columns = await sql.query(`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'webhook_replay_claims'
      ORDER BY column_name
    `, []);
    assert.deepEqual(columns.map((row) => row.column_name), ['expires_at', 'replay_key']);
  } finally {
    await store.release(key);
  }
});
