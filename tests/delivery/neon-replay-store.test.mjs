import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { neon } from '@neondatabase/serverless';

import {
  CONTROLLER_MAX_ATTEMPTS,
  NeonReplayStore,
  REDELIVERY_COOLDOWN_MS,
  REPLAY_CLEANUP_BATCH_SIZE,
} from '../../scripts/lib/neon-replay-store.mjs';
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

test('Neon controller receipt claims exhaust expired final attempts instead of reclaiming them', async () => {
  const calls = [];
  const store = new NeonReplayStore({
    client: {
      async query(statement, values) {
        calls.push({ statement, values });
        if (statement.includes('INSERT INTO public.webhook_controller_receipts AS stored')) {
          return [{ status: 'exhausted' }];
        }
        throw new Error('Unexpected controller receipt query.');
      },
    },
  });
  const key = '163255060:98765432-1234-4234-8234-123456789012';
  const leaseToken = 'interrupted:8';

  assert.deepEqual(await store.claimController(key, { leaseToken }), { status: 'exhausted' });
  assert.match(calls[0].statement, /SET status = CASE WHEN stored\.attempt_count >= \$5 THEN 'exhausted' ELSE 'running' END/);
  assert.match(calls[0].statement, /WHEN stored\.attempt_count >= \$5 THEN NULL/);
  assert.match(calls[0].statement, /attempt_count = CASE[\s\S]*WHEN stored\.attempt_count >= \$5 THEN stored\.attempt_count/);
  assert.deepEqual(calls[0].values, [key, 6 * 60 * 60 * 1_000, 30 * 24 * 60 * 60 * 1_000, leaseToken, CONTROLLER_MAX_ATTEMPTS]);
});

test('due controller receipt selection first exhausts expired leases at the attempt limit', async () => {
  const calls = [];
  const store = new NeonReplayStore({
    client: {
      async query(statement, values) {
        calls.push({ statement, values });
        return [];
      },
    },
  });

  assert.deepEqual(await store.dueControllerReceipts({ limit: 25 }), []);
  assert.match(calls[0].statement, /UPDATE public\.webhook_controller_receipts/);
  assert.match(calls[0].statement, /SET status = 'exhausted', lease_expires_at = NULL, lease_token = NULL/);
  assert.match(calls[0].statement, /status = 'running'[\s\S]*lease_expires_at <= clock_timestamp\(\)[\s\S]*attempt_count >= \$1/);
  assert.match(calls[0].statement, /LIMIT 100\s+FOR UPDATE SKIP LOCKED/);
  assert.deepEqual(calls[0].values, [CONTROLLER_MAX_ATTEMPTS]);
  assert.match(calls[1].statement, /SELECT replay_key, status, github_delivery_id, attempt_count/);
  assert.match(calls[1].statement, /attempt_count < \$3/);
  assert.deepEqual(calls[1].values, [25, 15 * 60 * 1000, CONTROLLER_MAX_ATTEMPTS]);
});

test('Neon replay adapter preserves definitive redelivery failures as exhausted records', async () => {
  const calls = [];
  const store = new NeonReplayStore({
    client: {
      async query(statement, values) {
        calls.push({ statement, values });
        return [{ delivery_guid: values[0] }];
      },
    },
  });
  const guid = '98765432-1234-4234-8234-123456789012';

  await store.markRedeliveryRejected(guid, '301');

  assert.equal(calls.length, 1);
  assert.match(calls[0].statement, /UPDATE public\.webhook_redelivery_requests/);
  assert.match(calls[0].statement, /SET request_status = 'exhausted', requested_at = clock_timestamp\(\), github_delivery_id = \$2/);
  assert.match(calls[0].statement, /WHERE delivery_guid = \$1 AND request_status = 'requesting'/);
  assert.match(calls[0].statement, /RETURNING delivery_guid/);
  assert.doesNotMatch(calls[0].statement, /DELETE FROM/);
  assert.deepEqual(calls[0].values, [guid.toLowerCase(), '301']);
});

test('Neon replay adapter queues redelivery candidates without replacing an active attempt', async () => {
  const calls = [];
  const store = new NeonReplayStore({
    client: {
      async query(statement, values) {
        calls.push({ statement, values });
        return [];
      },
    },
  });
  const guid = '98765432-1234-4234-8234-123456789012';

  const exactDeliveryId = '3846548579682426877';
  await store.queueRedeliveryRequests([{ guid, githubDeliveryId: exactDeliveryId }]);

  assert.equal(calls.length, 1);
  assert.match(calls[0].statement, /INSERT INTO public\.webhook_redelivery_requests AS stored/);
  assert.match(calls[0].statement, /SELECT candidates\.delivery_guid, clock_timestamp\(\), 'queued', candidates\.github_delivery_id, 0, clock_timestamp\(\)/);
  assert.match(calls[0].statement, /WHERE stored\.request_status = 'queued'/);
  assert.match(calls[0].statement, /WHEN stored\.request_status = 'exhausted' THEN 'queued'/);
  assert.match(calls[0].statement, /stored\.github_delivery_id IS DISTINCT FROM EXCLUDED\.github_delivery_id[\s\S]*stored\.attempt_count < \$3/);
  assert.deepEqual(calls[0].values, [[guid], [exactDeliveryId], CONTROLLER_MAX_ATTEMPTS]);
});

test('a resumed history scan atomically refreshes and requeues an exhausted exact-ID mismatch', async () => {
  let call;
  const store = new NeonReplayStore({
    client: {
      async query(statement, values) {
        call = { statement, values };
        return [{ delivery_guid: values[0] }];
      },
    },
  });
  const guid = '98765432-1234-4234-8234-123456789012';
  const deliveredAt = '2026-10-06T00:00:00.000Z';
  const exactDeliveryId = '3846548579682426877';

  await store.mergeReconcilerObservations([{
    guid,
    deliveredAt,
    deliveryId: exactDeliveryId,
    hasSuccess: false,
    installationId: '163255060',
  }], { refreshEqualTimestampDeliveryIds: true });

  assert.match(call.statement, /\$5::boolean[\s\S]*stored\.newest_delivery_at = EXCLUDED\.newest_delivery_at/);
  assert.match(call.statement, /retry\.request_status = 'exhausted'[\s\S]*retry\.attempt_count < \$6/);
  assert.match(call.statement, /repaired_requests AS \([\s\S]*SET request_status = 'queued'[\s\S]*github_delivery_id = observed\.newest_delivery_id/);
  assert.deepEqual(call.values, [JSON.stringify([{
    guid,
    delivered_at: deliveredAt,
    delivery_id: exactDeliveryId,
    has_success: false,
    installation_id: '163255060',
  }]), null, null, null, true, CONTROLLER_MAX_ATTEMPTS]);
});

test('claiming another redelivery never prunes unresolved exhausted requests', async () => {
  let call;
  const store = new NeonReplayStore({
    client: {
      async query(statement, values) {
        call = { statement, values };
        return [{ delivery_guid: values[0] }];
      },
    },
  });
  const guid = '98765432-1234-4234-8234-123456789012';

  assert.deepEqual(await store.claimRedeliveryRequest(guid, '301'), { claimed: true });

  assert.match(call.statement, /INSERT INTO public\.webhook_redelivery_requests AS stored/);
  assert.match(call.statement, /attempt_count < \$4/);
  assert.doesNotMatch(call.statement, /DELETE FROM public\.webhook_redelivery_requests/);
  assert.doesNotMatch(call.statement, /INTERVAL '30 days'/);
  assert.deepEqual(call.values, [guid, REDELIVERY_COOLDOWN_MS, '301', CONTROLLER_MAX_ATTEMPTS]);
});

test('due redelivery requests can defer queued work during a partial history scan', async () => {
  const calls = [];
  const store = new NeonReplayStore({
    client: {
      async query(statement, values) {
        calls.push({ statement, values });
        return [];
      },
    },
  });

  await store.dueRedeliveryRequests({ limit: 250, includeQueued: false });

  assert.match(calls[0].statement, /\$3::boolean AND request_status = 'queued'/);
  assert.match(calls[0].statement, /request_status IN \('accepted', 'requesting'\) AND next_attempt_at <= clock_timestamp\(\)/);
  assert.match(calls[0].statement, /attempt_count < \$2/);
  assert.deepEqual(calls[0].values, [250, CONTROLLER_MAX_ATTEMPTS, false]);

  await store.dueRedeliveryRequests({ limit: 250 });
  assert.deepEqual(calls[1].values, [250, CONTROLLER_MAX_ATTEMPTS, true]);
});

test('pending redelivery work blocks scan checkpoint advancement', async () => {
  const calls = [];
  const store = new NeonReplayStore({
    client: {
      async query(statement, values) {
        calls.push({ statement, values });
        return [{ delivery_guid: '98765432-1234-4234-8234-123456789012' }];
      },
    },
  });

  assert.equal(await store.hasPendingRedeliveryRequests(), true);
  assert.match(calls[0].statement, /request_status IN \('queued', 'requesting', 'exhausted'\)/);
  assert.match(calls[0].statement, /request_status = 'accepted'\s+AND attempt_count >= \$1\s+AND next_attempt_at <= clock_timestamp\(\)/);
  assert.match(calls[0].statement, /LIMIT 1/);
  assert.deepEqual(calls[0].values, [CONTROLLER_MAX_ATTEMPTS]);
});

test('Neon exhausts due final accepted attempts and reports each state transition', async () => {
  let call;
  const guid = '98765432-1234-4234-8234-123456789012';
  const store = new NeonReplayStore({
    client: { async query(statement, values) { call = { statement, values }; return [{ delivery_guid: guid }]; } },
  });

  assert.equal(await store.exhaustExpiredRedeliveryRequests(), 1);
  assert.match(call.statement, /WITH exhausted_requests AS/);
  assert.match(call.statement, /request_status IN \('requesting', 'accepted'\)/);
  assert.match(call.statement, /attempt_count >= \$1/);
  assert.match(call.statement, /next_attempt_at <= clock_timestamp\(\)/);
  assert.match(call.statement, /LIMIT 100\s+FOR UPDATE SKIP LOCKED/);
  assert.match(call.statement, /RETURNING requests\.delivery_guid/);
  assert.deepEqual(call.values, [CONTROLLER_MAX_ATTEMPTS]);
});

test('Neon marks an accepted final-attempt request as accepted rather than unaccepted exhaustion', async () => {
  let call;
  const store = new NeonReplayStore({
    client: { async query(statement, values) { call = { statement, values }; return [{ delivery_guid: values[0] }]; } },
  });
  const guid = '98765432-1234-4234-8234-123456789012';

  await store.markRedeliveryAccepted(guid, '301');

  assert.match(call.statement, /SET request_status = 'accepted'/);
  assert.doesNotMatch(call.statement, /request_status = CASE WHEN attempt_count/);
  assert.deepEqual(call.values, [guid.toLowerCase(), '301', REDELIVERY_COOLDOWN_MS]);
});

test('redelivery queue insertion splits large candidate sets into bounded SQL batches', async () => {
  const calls = [];
  const store = new NeonReplayStore({
    client: {
      async query(statement, values) {
        calls.push({ statement, values });
        return [];
      },
    },
  });
  const requests = Array.from({ length: 1_001 }, (_, index) => ({
    guid: `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
    githubDeliveryId: String(index + 1),
  }));

  await store.queueRedeliveryRequests(requests);

  assert.deepEqual(calls.map((call) => call.values[0].length), [500, 500, 1]);
  assert.deepEqual(calls.map((call) => call.values[1].length), [500, 500, 1]);
});

test('rate-limited redelivery attempts preserve Retry-After after the normal cooldown', async () => {
  let call;
  const store = new NeonReplayStore({
    client: {
      async query(statement, values) {
        call = { statement, values };
        return [{ delivery_guid: values[0] }];
      },
    },
  });
  const guid = '98765432-1234-4234-8234-123456789012';
  const retryAt = new Date(Date.now() + 60 * 60 * 1_000).toISOString();

  await store.deferRedeliveryRequest(guid, '301', retryAt);

  assert.match(call.statement, /next_attempt_at = GREATEST\(/);
  assert.match(call.statement, /request_status = CASE WHEN attempt_count >= \$5 THEN 'exhausted' ELSE 'requesting' END/);
  assert.match(call.statement, /COALESCE\(\$4::timestamptz/);
  assert.deepEqual(call.values, [guid.toLowerCase(), '301', REDELIVERY_COOLDOWN_MS, retryAt, CONTROLLER_MAX_ATTEMPTS]);
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

test('due controller receipt selection excludes unlinked rows before applying its limit', async () => {
  const unlinked = Array.from({ length: 250 }, (_, index) => ({
    replay_key: `163255060:unlinked-${index}`,
    github_delivery_id: null,
    status: 'retryable',
  }));
  const eligible = {
    replay_key: '163255060:linked-receipt',
    github_delivery_id: '301',
    status: 'retryable',
  };
  let call;
  const store = new NeonReplayStore({
    client: {
      async query(statement, values) {
        call = { statement, values };
        return [...unlinked, eligible].filter((receipt) => receipt.github_delivery_id !== null).slice(0, values[0]);
      },
    },
  });

  assert.deepEqual(await store.dueControllerReceipts({ limit: 250 }), [eligible]);
  assert.match(call.statement, /github_delivery_id IS NOT NULL/);
  assert.match(call.statement, /attempt_count < \$3/);
  assert.match(call.statement, /LIMIT \$1/);
  assert.deepEqual(call.values, [250, 15 * 60 * 1000, CONTROLLER_MAX_ATTEMPTS]);
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
  const queueMigration = await readFile(path.join(repositoryRoot, 'api/github/migrations/0005-queue-webhook-redeliveries.sql'), 'utf8');

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
  assert.match(queueMigration, /request_status IN \('queued', 'requesting', 'accepted', 'exhausted'\)/);
  assert.match(queueMigration, /next_attempt_at timestamptz/);
  const migrationSql = (initialMigration + recoveryMigration + scanMigration + observationsMigration + queueMigration).replace(/^\s*--.*$/gm, '');
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
  const exhaustedReceiptKey = replayKey({ installationId: '163255060', deliveryId: randomUUID() });
  const queuedGuid = randomUUID();
  const acceptedFinalGuid = randomUUID();
  const agedExhaustedGuid = randomUUID();
  const unlinkedReceiptKeys = Array.from({ length: 250 }, () => replayKey({ installationId: '163255060', deliveryId: randomUUID() }));
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
    await store.ensureControllerReceipt(exhaustedReceiptKey);
    await store.linkGithubDelivery(exhaustedReceiptKey, '987654320');
    for (let attempt = 0; attempt < CONTROLLER_MAX_ATTEMPTS; attempt += 1) {
      assert.deepEqual(await store.claimController(exhaustedReceiptKey, {
        leaseMs: 1_000,
        leaseToken: `integration:interrupted:${attempt}`,
      }), { status: 'claimed' });
      await sql.query(`
        UPDATE public.webhook_controller_receipts
        SET lease_expires_at = clock_timestamp() - interval '1 second'
        WHERE replay_key = $1
      `, [exhaustedReceiptKey]);
    }
    await sql.query(`
      UPDATE public.webhook_controller_receipts
      SET status = 'retryable', next_attempt_at = clock_timestamp() - interval '1 hour'
      WHERE replay_key = $1
    `, [linkedReceiptKey]);
    await sql.query(`
      INSERT INTO public.webhook_controller_receipts (replay_key, status, next_attempt_at, created_at, expires_at)
      SELECT entries.replay_key, 'retryable',
             clock_timestamp() - interval '1 hour',
             clock_timestamp() - interval '1 hour',
             clock_timestamp() + interval '1 day'
      FROM jsonb_to_recordset($1::jsonb) AS entries(replay_key text)
    `, [JSON.stringify(unlinkedReceiptKeys.map((replay_key) => ({ replay_key })))]);
    const dueReceipts = await store.dueControllerReceipts({ limit: 250 });
    assert.deepEqual(dueReceipts.map((receipt) => receipt.replay_key), [linkedReceiptKey]);
    const exhaustedReceipt = await store.controllerReceipt(exhaustedReceiptKey);
    assert.equal(exhaustedReceipt.status, 'exhausted');
    assert.equal(Number(exhaustedReceipt.attempt_count), CONTROLLER_MAX_ATTEMPTS);
    assert.equal(dueReceipts.some((receipt) => receipt.replay_key === exhaustedReceiptKey), false);

    const redeliveryColumns = await sql.query(`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'webhook_redelivery_requests'
      ORDER BY column_name
    `, []);
    assert.deepEqual(redeliveryColumns.map((row) => row.column_name), [
      'attempt_count',
      'delivery_guid',
      'github_delivery_id',
      'next_attempt_at',
      'request_status',
      'requested_at',
    ]);
    await store.queueRedeliveryRequests([{ guid: queuedGuid, githubDeliveryId: '987654323' }]);
    assert.ok((await store.dueRedeliveryRequests({ limit: 250 })).some((request) => request.delivery_guid === queuedGuid));
    assert.deepEqual(await store.claimRedeliveryRequest(queuedGuid, '987654323'), { claimed: true });
    await sql.query(`
      UPDATE public.webhook_redelivery_requests
      SET next_attempt_at = clock_timestamp() - interval '1 second'
      WHERE delivery_guid = $1
    `, [queuedGuid]);
    assert.ok((await store.dueRedeliveryRequests({ limit: 250 })).some((request) => request.delivery_guid === queuedGuid));
    assert.deepEqual(await store.claimRedeliveryRequest(queuedGuid, '987654323'), { claimed: true });
    await store.deferRedeliveryRequest(queuedGuid, '987654323', new Date(Date.now() + 60 * 60 * 1_000).toISOString());
    assert.equal((await store.dueRedeliveryRequests({ limit: 250 })).some((request) => request.delivery_guid === queuedGuid), false);
    await sql.query(`
      UPDATE public.webhook_redelivery_requests
      SET request_status = 'requesting', attempt_count = $2, next_attempt_at = clock_timestamp() - interval '1 second'
      WHERE delivery_guid = $1
    `, [queuedGuid, CONTROLLER_MAX_ATTEMPTS]);
    assert.equal(await store.exhaustExpiredRedeliveryRequests(), 1, 'an expired final ambiguous request becomes exhausted');
    assert.equal(await store.hasPendingRedeliveryRequests(), true, 'an exhausted request continues to hold the checkpoint');
    const exhaustedQueueRow = await sql.query(
      'SELECT request_status FROM public.webhook_redelivery_requests WHERE delivery_guid = $1',
      [queuedGuid],
    );
    assert.equal(exhaustedQueueRow[0].request_status, 'exhausted');
    await sql.query(`
      UPDATE public.webhook_redelivery_requests
      SET request_status = 'accepted', attempt_count = $2, next_attempt_at = clock_timestamp() - interval '1 second'
      WHERE delivery_guid = $1
    `, [queuedGuid, CONTROLLER_MAX_ATTEMPTS]);
    assert.equal(await store.exhaustExpiredRedeliveryRequests(), 1, 'an accepted final attempt becomes exhausted after its cooldown when no successful history removed it');
    const exhaustedAcceptedRow = await sql.query(
      'SELECT request_status FROM public.webhook_redelivery_requests WHERE delivery_guid = $1',
      [queuedGuid],
    );
    assert.equal(exhaustedAcceptedRow[0].request_status, 'exhausted');
    await store.completeRedelivery(queuedGuid);

    await store.queueRedeliveryRequests([{ guid: agedExhaustedGuid, githubDeliveryId: '987654325' }]);
    await sql.query(`
      UPDATE public.webhook_redelivery_requests
      SET request_status = 'exhausted', attempt_count = $2, requested_at = clock_timestamp() - interval '31 days'
      WHERE delivery_guid = $1
    `, [agedExhaustedGuid, CONTROLLER_MAX_ATTEMPTS]);
    assert.equal(await store.hasPendingRedeliveryRequests(), true, 'an aged exhausted request alone continues to hold checkpoint progress');
    await store.queueRedeliveryRequests([{ guid: acceptedFinalGuid, githubDeliveryId: '987654324' }]);
    for (let attempt = 0; attempt < CONTROLLER_MAX_ATTEMPTS; attempt += 1) {
      assert.deepEqual(await store.claimRedeliveryRequest(acceptedFinalGuid, '987654324'), { claimed: true });
      if (attempt === 0) {
        const agedExhaustedRow = await sql.query(
          'SELECT request_status FROM public.webhook_redelivery_requests WHERE delivery_guid = $1',
          [agedExhaustedGuid],
        );
        assert.equal(agedExhaustedRow[0].request_status, 'exhausted', 'a new claim must not delete an aged unresolved request');
        await store.completeRedelivery(agedExhaustedGuid);
      }
      await store.markRedeliveryAccepted(acceptedFinalGuid, '987654324');
      if (attempt + 1 < CONTROLLER_MAX_ATTEMPTS) {
        await sql.query(`
          UPDATE public.webhook_redelivery_requests
          SET next_attempt_at = clock_timestamp() - interval '1 second'
          WHERE delivery_guid = $1
        `, [acceptedFinalGuid]);
      }
    }
    const finalAcceptedRow = await sql.query(
      'SELECT request_status, attempt_count FROM public.webhook_redelivery_requests WHERE delivery_guid = $1',
      [acceptedFinalGuid],
    );
    assert.equal(finalAcceptedRow[0].request_status, 'accepted');
    assert.equal(Number(finalAcceptedRow[0].attempt_count), CONTROLLER_MAX_ATTEMPTS);
    assert.equal(await store.hasPendingRedeliveryRequests(), false, 'the accepted final request can complete its current scan');
    await sql.query(`
      UPDATE public.webhook_redelivery_requests
      SET next_attempt_at = clock_timestamp() - interval '1 second'
      WHERE delivery_guid = $1
    `, [acceptedFinalGuid]);
    assert.equal(await store.exhaustExpiredRedeliveryRequests(), 1);
    assert.equal(await store.hasPendingRedeliveryRequests(), true, 'a final accepted request without successful history becomes visible and blocks later progress');
    const recoveredFinalRow = await sql.query(
      'SELECT request_status FROM public.webhook_redelivery_requests WHERE delivery_guid = $1',
      [acceptedFinalGuid],
    );
    assert.equal(recoveredFinalRow[0].request_status, 'exhausted');

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
    await sql.query('DELETE FROM public.webhook_redelivery_requests WHERE delivery_guid = ANY($1::text[])', [[queuedGuid, acceptedFinalGuid, agedExhaustedGuid]]);
    for (const receiptKey of [key, lostResponseKey, linkedReceiptKey, exhaustedReceiptKey]) {
      await sql.query('DELETE FROM public.webhook_controller_receipts WHERE replay_key = $1', [receiptKey]);
    }
    await sql.query('DELETE FROM public.webhook_controller_receipts WHERE replay_key = ANY($1::text[])', [unlinkedReceiptKeys]);
    await sql.query('DELETE FROM public.webhook_reconciler_observations');
    await sql.query("DELETE FROM public.webhook_reconciler_state WHERE state_key = 'github-app-deliveries'");
  }
});
