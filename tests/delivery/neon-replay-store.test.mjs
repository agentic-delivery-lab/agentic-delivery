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

function fakeDatabase({ now = () => Date.now(), entries = new Map(), queryError, afterClaimCommitError } = {}) {
  const calls = [];
  const client = {
    async query(statement, values) {
      calls.push({ statement, values });
      if (queryError) throw queryError;
      if (statement.includes('INSERT INTO public.webhook_replay_claims')) {
        const [key, cleanupLimit, ttlMs, leaseMs, leaseToken] = values;
        const expiredKeys = [...entries.entries()]
          .filter(([candidate, value]) => candidate !== key && value.expiresAt <= now())
          .sort((left, right) => left[1].expiresAt - right[1].expiresAt)
          .slice(0, cleanupLimit)
          .map(([candidate]) => candidate);
        for (const candidate of expiredKeys) entries.delete(candidate);
        const existing = entries.get(key);
        const leaseExpired = existing?.dispatchStatus === 'dispatching' && existing.leaseExpiresAt <= now();
        if (existing && existing.expiresAt > now() && !leaseExpired) return [];
        entries.set(key, {
          expiresAt: now() + ttlMs,
          dispatchStatus: 'dispatching',
          leaseExpiresAt: now() + leaseMs,
          leaseToken,
        });
        if (afterClaimCommitError) {
          const error = afterClaimCommitError;
          afterClaimCommitError = null;
          throw error;
        }
        return [{ replay_key: key }];
      }
      if (statement.includes('SELECT dispatch_status')) {
        const entry = entries.get(values[0]);
        return entry ? [{
          dispatch_status: entry.dispatchStatus,
          lease_active: entry.dispatchStatus === 'dispatching' && entry.leaseExpiresAt > now(),
        }] : [];
      }
      if (statement.includes('UPDATE public.webhook_replay_claims')) {
        const entry = entries.get(values[0]);
        if (entry?.dispatchStatus !== 'dispatching' || entry.leaseToken !== values[1]) return [];
        entry.dispatchStatus = 'dispatched';
        entry.leaseExpiresAt = null;
        entry.leaseToken = null;
        return [{ replay_key: values[0] }];
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
  assert.deepEqual(claim.values.slice(0, 4), ['163255060:98765432-1234-4234-8234-123456789012', REPLAY_CLEANUP_BATCH_SIZE, 300_000, 30_000]);
  assert.match(claim.values[4], /^[0-9a-f-]{36}$/i);
  assert.match(claim.statement, /dispatch_lease_token = \$5/);
});

test('duplicate dispatch claims distinguish a completed dispatch from an active lease', async () => {
  const database = fakeDatabase();
  const store = new NeonReplayStore({ client: database.client });
  const key = '163255060:98765432-1234-4234-8234-123456789012';

  const initial = await store.claimWithLease(key);
  assert.equal(initial.claimed, true);
  assert.equal((await store.claimWithLease(key)).leaseActive, true);
  await store.markDispatched(key, initial.leaseToken);
  assert.deepEqual(await store.claimWithLease(key), {
    claimed: false,
    leaseToken: null,
    status: 'dispatched',
    leaseActive: false,
  });
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

test('a committed claim with a lost HTTP response stays retryable until its lease expires', async () => {
  let now = 1_000;
  const database = fakeDatabase({ now: () => now, afterClaimCommitError: new Error('response was lost') });
  const store = new NeonReplayStore({ client: database.client });
  const key = '163255060:lost-response-key';

  await assert.rejects(store.claimWithLease(key), /durable replay database operation failed/);
  const active = await store.claimWithLease(key);
  assert.equal(active.claimed, false);
  assert.equal(active.status, 'dispatching');
  assert.equal(active.leaseActive, true);
  now += 30_001;
  const reclaimed = await store.claimWithLease(key);
  assert.equal(reclaimed.claimed, true);
  await assert.rejects(store.markDispatched(key, '12345678-1234-4234-8234-123456789012'), /durable replay database operation failed/);
  await store.markDispatched(key, reclaimed.leaseToken);
});

test('Neon replay receipts link a batch of webhook delivery IDs before the scan checkpoint advances', async () => {
  let call;
  const store = new NeonReplayStore({
    client: {
      async query(statement, values) {
        call = { statement, values };
        return [{ replay_key: '163255060:12345678-1234-4234-8234-123456789012' }];
      },
    },
  });
  const links = [{ replayKey: '163255060:12345678-1234-4234-8234-123456789012', githubDeliveryId: '301' }];

  assert.equal(await store.linkGithubDeliveries(links), 1);
  assert.match(call.statement, /jsonb_to_recordset\(\$1::jsonb\)/);
  assert.match(call.statement, /github_delivery_id bigint/);
  assert.match(call.statement, /status IN \('pending', 'running', 'retryable'\)/);
  assert.match(call.statement, /github_delivery_id IS DISTINCT FROM deliveries\.github_delivery_id/);
  assert.deepEqual(JSON.parse(call.values[0]), [{ replay_key: links[0].replayKey, github_delivery_id: links[0].githubDeliveryId }]);
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

test('replay migrations store only minimal lease, receipt, and checkpoint metadata', async () => {
  const initialMigration = await readFile(path.join(repositoryRoot, 'api/github/migrations/0001-webhook-replay-claims.sql'), 'utf8');
  const recoveryMigration = await readFile(path.join(repositoryRoot, 'api/github/migrations/0002-recoverable-webhook-delivery.sql'), 'utf8');
  const scanMigration = await readFile(path.join(repositoryRoot, 'api/github/migrations/0003-resumable-webhook-scan.sql'), 'utf8');
  const observationsMigration = await readFile(path.join(repositoryRoot, 'api/github/migrations/0004-aggregate-webhook-scan-observations.sql'), 'utf8');

  assert.match(initialMigration, /CREATE TABLE IF NOT EXISTS public\.webhook_replay_claims\s*\(\s*replay_key text PRIMARY KEY,\s*expires_at timestamptz NOT NULL\s*\)/);
  assert.match(initialMigration, /ON public\.webhook_replay_claims \(expires_at\)/);
  assert.match(recoveryMigration, /dispatch_lease_expires_at timestamptz/);
  assert.match(recoveryMigration, /dispatch_lease_token text/);
  assert.match(recoveryMigration, /CREATE TABLE IF NOT EXISTS public\.webhook_controller_receipts/);
  assert.match(recoveryMigration, /lease_token text/);
  assert.match(recoveryMigration, /CREATE TABLE IF NOT EXISTS public\.webhook_reconciler_state/);
  assert.match(scanMigration, /ADD COLUMN IF NOT EXISTS scan_cursor text/);
  assert.match(scanMigration, /scan_high_water_at timestamptz/);
  assert.match(scanMigration, /scan_high_water_delivery_id bigint/);
  assert.match(observationsMigration, /CREATE TABLE IF NOT EXISTS public\.webhook_reconciler_observations/);
  assert.match(observationsMigration, /newest_delivery_at timestamptz NOT NULL/);
  assert.match(observationsMigration, /has_success boolean NOT NULL/);
  assert.match(observationsMigration, /installation_id bigint/);
  const migrationSql = (initialMigration + recoveryMigration + scanMigration + observationsMigration).replace(/^\s*--.*$/gm, '');
  assert.doesNotMatch(migrationSql, /\b(?:body|payload|api_token|private_key|model_output)\b/i);
});

test('Neon replay integration proves claim, lost-response recovery, expiry, release and stored columns', {
  skip: testDatabaseUrl ? false : 'Set AGENTIC_DELIVERY_REPLAY_TEST_DATABASE_URL to an isolated Neon database with all replay migrations applied.',
}, async () => {
  const store = new NeonReplayStore({ connectionString: testDatabaseUrl });
  const sql = neon(testDatabaseUrl);
  const key = replayKey({ installationId: '163255060', deliveryId: randomUUID() });
  const lostResponseKey = replayKey({ installationId: '163255060', deliveryId: randomUUID() });
  const linkedReceiptKey = replayKey({ installationId: '163255060', deliveryId: randomUUID() });
  const leaseToken = `integration:${randomUUID()}`;

  try {
    const concurrentClaims = await Promise.all([store.claimWithLease(key), store.claimWithLease(key)]);
    assert.deepEqual(concurrentClaims.map((claim) => claim.claimed).sort(), [false, true]);
    const owner = concurrentClaims.find((claim) => claim.claimed);
    await store.markDispatched(key, owner.leaseToken);
    assert.equal(await store.claim(key), false);
    assert.equal((await store.claimWithLease(key)).status, 'dispatched');

    await store.release(key);
    assert.equal(await store.claim(key), true);
    await store.release(key);

    let dropClaimResponse = true;
    const lostResponseStore = new NeonReplayStore({
      client: {
        async query(statement, values) {
          const rows = await sql.query(statement, values);
          if (dropClaimResponse && statement.includes('INSERT INTO public.webhook_replay_claims')) {
            dropClaimResponse = false;
            throw new Error('simulated response loss after commit');
          }
          return rows;
        },
      },
    });
    const lostResponseLease = { ttlMs: 300_000, leaseMs: 300_000 };
    await assert.rejects(lostResponseStore.claimWithLease(lostResponseKey, lostResponseLease), /durable replay database operation failed/);
    const activeLostResponse = await store.claimWithLease(lostResponseKey, lostResponseLease);
    assert.equal(activeLostResponse.claimed, false);
    assert.equal(activeLostResponse.status, 'dispatching');
    assert.equal(activeLostResponse.leaseActive, true);
    await sql.query(`
      UPDATE public.webhook_replay_claims
      SET dispatch_lease_expires_at = now() - interval '1 second'
      WHERE replay_key = $1
    `, [lostResponseKey]);
    const recovered = await store.claimWithLease(lostResponseKey, lostResponseLease);
    assert.equal(recovered.claimed, true);
    await store.markDispatched(lostResponseKey, recovered.leaseToken);
    assert.equal(await store.claim(lostResponseKey), false);
    assert.equal((await store.claimWithLease(lostResponseKey, lostResponseLease)).status, 'dispatched');

    assert.equal(await store.claim(key, { ttlMs: 25 }), true);
    await new Promise((resolve) => setTimeout(resolve, 100));
    assert.equal(await store.claim(key), true);

    await store.ensureControllerReceipt(key);
    assert.deepEqual(await store.claimController(key, { leaseToken }), { status: 'claimed' });
    await store.completeController(key, { leaseToken });
    assert.equal((await store.controllerReceipt(key)).status, 'completed');

    await store.ensureControllerReceipt(linkedReceiptKey);
    assert.equal(await store.linkGithubDeliveries([{ replayKey: linkedReceiptKey, githubDeliveryId: '987654321' }]), 1);
    assert.equal((await store.controllerReceipt(linkedReceiptKey)).github_delivery_id, '987654321');

    const claimColumns = await sql.query(`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'webhook_replay_claims'
      ORDER BY column_name
    `, []);
    assert.deepEqual(claimColumns.map((row) => row.column_name), [
      'dispatch_lease_expires_at',
      'dispatch_lease_token',
      'dispatch_status',
      'expires_at',
      'replay_key',
    ]);
    const receiptColumns = await sql.query(`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'webhook_controller_receipts'
      ORDER BY column_name
    `, []);
    assert.deepEqual(receiptColumns.map((row) => row.column_name), [
      'attempt_count',
      'created_at',
      'expires_at',
      'github_delivery_id',
      'lease_expires_at',
      'lease_token',
      'next_attempt_at',
      'replay_key',
      'status',
    ]);

    const previousCheckpoint = await store.reconcilerCheckpoint();
    assert.equal(previousCheckpoint?.scan_cursor ?? null, null, 'the isolated database must not have a pending scan');
    const previousCheckpointTime = Date.parse(String(previousCheckpoint?.checkpoint_at ?? ''));
    const highWaterAt = new Date(Math.max(Date.now(), Number.isFinite(previousCheckpointTime) ? previousCheckpointTime : 0) + 1_000).toISOString();
    const scanCursor = `integration:${randomUUID()}`;
    const observationGuid = randomUUID();
    const expectedCheckpoint = {
      expectedCursor: previousCheckpoint?.scan_cursor ?? null,
      expectedCheckpointAt: previousCheckpoint?.checkpoint_at ?? null,
      expectedCheckpointDeliveryId: previousCheckpoint?.checkpoint_delivery_id ?? null,
    };
    await store.mergeReconcilerObservations([{
      guid: observationGuid,
      deliveredAt: highWaterAt,
      deliveryId: '987654322',
      hasSuccess: false,
      installationId: '163255060',
    }], {
      expectedCursor: previousCheckpoint?.scan_cursor ?? null,
      expectedCheckpointAt: previousCheckpoint?.checkpoint_at ?? null,
      expectedCheckpointDeliveryId: previousCheckpoint?.checkpoint_delivery_id ?? null,
    });
    await store.saveReconcilerScan({
      cursor: scanCursor,
      highWaterAt,
      highWaterDeliveryId: '987654322',
      ...expectedCheckpoint,
    });
    const pendingScan = await store.reconcilerCheckpoint();
    assert.equal(pendingScan.scan_cursor, scanCursor);
    assert.equal(pendingScan.scan_high_water_delivery_id, '987654322');
    const firstObservation = (await store.reconcilerObservations()).find((row) => row.delivery_guid === observationGuid);
    assert.equal(firstObservation.has_success, false);
    await store.mergeReconcilerObservations([{
      guid: observationGuid,
      deliveredAt: new Date(Date.parse(highWaterAt) - 1_000).toISOString(),
      deliveryId: '987654321',
      hasSuccess: true,
      installationId: '163255060',
    }], {
      expectedCursor: pendingScan.scan_cursor,
      expectedCheckpointAt: pendingScan.checkpoint_at ?? null,
      expectedCheckpointDeliveryId: pendingScan.checkpoint_delivery_id ?? null,
    });
    const combinedObservation = (await store.reconcilerObservations()).find((row) => row.delivery_guid === observationGuid);
    assert.equal(combinedObservation.has_success, true);
    assert.equal(String(combinedObservation.newest_delivery_id), '987654322');
    const expectedPendingScan = {
      expectedCursor: pendingScan.scan_cursor,
      expectedCheckpointAt: pendingScan.checkpoint_at ?? null,
      expectedCheckpointDeliveryId: pendingScan.checkpoint_delivery_id ?? null,
    };
    await store.advanceReconcilerCheckpoint({
      deliveredAt: highWaterAt,
      deliveryId: '987654322',
      ...expectedPendingScan,
    });
    const completedScan = await store.reconcilerCheckpoint();
    assert.equal(completedScan.checkpoint_delivery_id, '987654322');
    assert.equal(completedScan.scan_cursor, null);
    assert.equal(completedScan.scan_high_water_at, null);
    assert.equal((await store.reconcilerObservations()).some((row) => row.delivery_guid === observationGuid), false);
  } finally {
    await store.release(key);
    await store.release(lostResponseKey);
    for (const receiptKey of [key, lostResponseKey, linkedReceiptKey]) {
      await sql.query('DELETE FROM public.webhook_controller_receipts WHERE replay_key = $1', [receiptKey]);
    }
    await sql.query('DELETE FROM public.webhook_reconciler_observations');
    await sql.query("DELETE FROM public.webhook_reconciler_state WHERE state_key = 'github-app-deliveries'");
  }
});
