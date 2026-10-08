import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { readFile, mkdtemp, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import test from 'node:test';
import { NeonReplayStore } from '../../scripts/lib/neon-replay-store.mjs';

const databaseUrl = process.env.ISSUE_60_RECOVERY_TEST_DATABASE_URL;
const literal = (value) => typeof value === 'number' ? String(value)
  : Array.isArray(value) ? `ARRAY[${value.map(literal).join(',')}]`
    : `'${String(value).replaceAll("'", "''")}'`;
const bind = ({ statement, values }) => statement.replace(/\$(\d+)/g, (_, index) => literal(values[Number(index) - 1]));

test('isolated PostgreSQL proves atomic archive guards, preserved metadata and retry exclusion', {
  skip: !databaseUrl && 'Set ISSUE_60_RECOVERY_TEST_DATABASE_URL to the disposable local recovery_test database.',
}, async () => {
  const url = new URL(databaseUrl);
  assert.ok(['localhost', '127.0.0.1'].includes(url.hostname) && url.pathname === '/recovery_test', 'Only the disposable local fixture database is permitted.');
  const root = new URL('../../', import.meta.url);
  const names = ['0001-webhook-replay-claims.sql', '0002-recoverable-webhook-delivery.sql',
    '0003-resumable-webhook-scan.sql', '0004-aggregate-webhook-scan-observations.sql',
    '0005-queue-webhook-redeliveries.sql', '0006-archive-unavailable-webhook-deliveries.sql', '0007-audit-targeted-reconciliation-recovery.sql'];
  const migrations = await Promise.all(names.map((name) => readFile(new URL(`api/github/migrations/${name}`, root), 'utf8')));
  const operation = await readFile(new URL('scripts/issue-60-archive-unavailable.sql', root), 'utf8');
  const rows = Array.from({ length: 161 }, (_, index) => ({
    delivery_guid: `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
    stored_delivery_id: String(3845978218578313000n + BigInt(index)),
    observed_delivery_id: String(3845978218578313000n + BigInt(index)),
    observation_installation_id: '163255060',
  }));
  const manifest = `${literal(JSON.stringify(rows))}::jsonb`;
  const firstGuid = rows[0].delivery_guid;
  const calls = [];
  const store = new NeonReplayStore({ client: { query: async (statement, values) => { calls.push({ statement, values }); return []; } } });
  await store.claimRedeliveryRequest(firstGuid, '3847041198202052608');
  const claim = calls.shift(); calls.length = 0;
  await store.queueRedeliveryRequests([{ guid: firstGuid, githubDeliveryId: '3847041198202052608' }]);
  const requeue = calls.shift(); calls.length = 0;
  await store.dueRedeliveryRequests();
  const due = calls.shift(); calls.length = 0;
  await store.hasPendingRedeliveryRequests();
  const pending = calls.shift();
  calls.length = 0;
  await store.completeRedelivery(firstGuid);
  const complete = calls.shift();
  const replaySql = await readFile(new URL('scripts/issue-60-prepare-one-replay.sql', root), 'utf8');
  const prepare = (runId, exactId = '3847041198202052608') => bind({ statement: replaySql.trim().replace(/;$/, ''),
    values: [`163255060:${firstGuid}`, firstGuid, exactId, runId, JSON.stringify({ operator: 'fixture', delivery_id: exactId })] });
  const script = `BEGIN;
${migrations.join('\n')}
${operation}
INSERT INTO public.webhook_reconciler_state VALUES ('github-app-deliveries',
  '2026-10-01', 3845978218578313000, '2026-10-06 04:39:05.528123+00',
  'stale-cursor', '2026-10-06', 3845978218578313000);
INSERT INTO public.webhook_redelivery_requests
  SELECT delivery_guid, '2026-10-05', 'exhausted', stored_delivery_id::bigint, 1, '2026-10-05'
  FROM jsonb_to_recordset(${manifest}) AS m(delivery_guid text, stored_delivery_id text);
INSERT INTO public.webhook_reconciler_observations
  SELECT delivery_guid, '2026-10-02', observed_delivery_id::bigint, false, 163255060
  FROM jsonb_to_recordset(${manifest}) AS m(delivery_guid text, observed_delivery_id text);
DO $$ DECLARE rejected boolean := false; BEGIN
  BEGIN PERFORM pg_temp.archive_issue_60_deliveries(${literal(JSON.stringify(rows.slice(1)))}::jsonb,
    '{}'::jsonb, '2026-10-06 04:39:05.528123+00');
  EXCEPTION WHEN raise_exception THEN rejected := true; END;
  IF NOT rejected OR EXISTS (SELECT 1 FROM public.webhook_redelivery_archive) THEN RAISE EXCEPTION 'Partial manifest must roll back'; END IF;
END $$;
INSERT INTO public.webhook_controller_receipts(replay_key, expires_at)
  VALUES ('163255060:${firstGuid}', clock_timestamp() + interval '1 day');
DO $$ DECLARE rejected boolean := false; BEGIN
  BEGIN PERFORM pg_temp.archive_issue_60_deliveries(${manifest}, '{}'::jsonb, '2026-10-06 04:39:05.528123+00');
  EXCEPTION WHEN raise_exception THEN rejected := true; END;
  IF NOT rejected OR EXISTS (SELECT 1 FROM public.webhook_redelivery_archive) THEN RAISE EXCEPTION 'Linked receipt must roll back'; END IF;
END $$;
DELETE FROM public.webhook_controller_receipts;
UPDATE public.webhook_redelivery_requests SET github_delivery_id = 1 WHERE delivery_guid = '${firstGuid}';
DO $$ DECLARE rejected boolean := false; BEGIN
  BEGIN PERFORM pg_temp.archive_issue_60_deliveries(${manifest}, '{}'::jsonb, '2026-10-06 04:39:05.528123+00');
  EXCEPTION WHEN raise_exception THEN rejected := true; END;
  IF NOT rejected OR EXISTS (SELECT 1 FROM public.webhook_redelivery_archive) THEN RAISE EXCEPTION 'Changed identity must roll back'; END IF;
END $$;
UPDATE public.webhook_redelivery_requests SET github_delivery_id = ${rows[0].stored_delivery_id} WHERE delivery_guid = '${firstGuid}';
SELECT pg_temp.archive_issue_60_deliveries(${manifest}, '{"manifest_sha256":"fixture"}'::jsonb, '2026-10-06 04:39:05.528123+00');
${bind(claim)};
${bind(requeue)};
${bind(complete)};
-- Replay the old negative status check and old unconditional completion path.
${bind(claim).replace("stored.request_status IN ('queued', 'requesting', 'accepted')", "stored.request_status <> 'exhausted'")};
DELETE FROM public.webhook_redelivery_requests WHERE delivery_guid = '${firstGuid}';
CREATE TEMP TABLE due_results AS ${bind(due)};
CREATE TEMP TABLE pending_results AS ${bind(pending)};
DO $$ BEGIN
  IF (SELECT count(*) FROM public.webhook_redelivery_archive) <> 161
    OR (SELECT count(*) FROM public.webhook_redelivery_requests WHERE request_status = 'archived' AND attempt_count = 1) <> 161
    OR (SELECT count(*) FROM public.webhook_reconciler_observations) <> 161
    OR EXISTS (SELECT 1 FROM due_results) OR EXISTS (SELECT 1 FROM pending_results)
    OR NOT EXISTS (SELECT 1 FROM public.webhook_reconciler_state WHERE scan_cursor IS NULL AND checkpoint_at = '2026-10-01' AND checkpoint_delivery_id = 3845978218578313000)
    OR NOT EXISTS (SELECT 1 FROM public.webhook_redelivery_archive WHERE delivery_guid = '${firstGuid}' AND queue_snapshot->>'github_delivery_id' = '${rows[0].stored_delivery_id}' AND queue_snapshot->>'request_status' = 'exhausted' AND observation_snapshot->>'has_success' = 'false' AND scan_snapshot->>'scan_cursor' = 'stale-cursor')
  THEN RAISE EXCEPTION 'Archive metadata or retry exclusion failed'; END IF;
END $$;
DO $$ DECLARE rejected boolean := false; BEGIN
  BEGIN PERFORM pg_temp.archive_issue_60_deliveries(${manifest}, '{}'::jsonb, '2026-10-06 04:39:05.528123+00');
  EXCEPTION WHEN raise_exception THEN rejected := true; END;
  IF NOT rejected THEN RAISE EXCEPTION 'Repeat apply must fail'; END IF;
END $$;
DELETE FROM public.webhook_redelivery_requests WHERE delivery_guid = '${firstGuid}';
DELETE FROM public.webhook_reconciler_observations;
DO $$ BEGIN
  IF (SELECT count(*) FROM public.webhook_redelivery_archive) <> 161
    OR (SELECT count(*) FROM public.webhook_redelivery_requests WHERE request_status = 'archived') <> 161
  THEN RAISE EXCEPTION 'Archive and guard must survive legacy cleanup'; END IF;
END $$;
-- Explicit rollback first restores the blocking state; normal cleanup then works.
UPDATE public.webhook_redelivery_requests SET request_status = 'exhausted' WHERE delivery_guid = '${firstGuid}';
DELETE FROM public.webhook_redelivery_requests WHERE delivery_guid = '${firstGuid}';
DO $$ BEGIN IF (SELECT count(*) FROM public.webhook_redelivery_requests) <> 160
  OR (SELECT count(*) FROM public.webhook_redelivery_archive) <> 161
  THEN RAISE EXCEPTION 'Explicit restoration must retain the audit'; END IF; END $$;
-- Targeted receipt recovery must preserve the original eight-attempt state.
INSERT INTO public.webhook_redelivery_requests(delivery_guid, requested_at, request_status, github_delivery_id, attempt_count, next_attempt_at)
  VALUES ('${firstGuid}', clock_timestamp(), 'exhausted', 3847041198202052608, 8, clock_timestamp());
INSERT INTO public.webhook_controller_receipts(replay_key, github_delivery_id, expires_at)
  VALUES ('163255060:${firstGuid}', 3847041198202052608, clock_timestamp() + interval '1 day');
${prepare('901', '3847041198202052609')};
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM public.webhook_redelivery_requests WHERE delivery_guid = '${firstGuid}' AND request_status = 'exhausted' AND attempt_count = 8) OR EXISTS (SELECT 1 FROM public.webhook_reconciliation_recoveries)
  THEN RAISE EXCEPTION 'Mismatched exact ID must not reset or audit'; END IF; END $$;
${prepare('902')};
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.webhook_redelivery_requests WHERE delivery_guid = '${firstGuid}' AND request_status = 'queued' AND attempt_count = 0 AND github_delivery_id = 3847041198202052608)
    OR NOT EXISTS (SELECT 1 FROM public.webhook_reconciliation_recoveries WHERE run_id = '902' AND queue_before->>'attempt_count' = '8' AND queue_before->>'request_status' = 'exhausted' AND queue_before->>'github_delivery_id' = '3847041198202052608' AND receipt_before->>'status' = 'pending')
    OR NOT EXISTS (SELECT 1 FROM public.webhook_controller_receipts WHERE replay_key = '163255060:${firstGuid}' AND status = 'pending' AND attempt_count = 0)
  THEN RAISE EXCEPTION 'Targeted retry must preserve metadata and receipt counters'; END IF;
END $$;
UPDATE public.webhook_redelivery_requests SET request_status = 'exhausted', attempt_count = 8 WHERE delivery_guid = '${firstGuid}';
UPDATE public.webhook_controller_receipts SET status = 'running' WHERE replay_key = '163255060:${firstGuid}';
${prepare('903')};
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM public.webhook_redelivery_requests WHERE delivery_guid = '${firstGuid}' AND request_status = 'exhausted' AND attempt_count = 8)
  THEN RAISE EXCEPTION 'Running receipt must preserve exhausted state'; END IF; END $$;
UPDATE public.webhook_controller_receipts SET status = 'pending' WHERE replay_key = '163255060:${firstGuid}';
UPDATE public.webhook_redelivery_requests SET request_status = 'archived' WHERE delivery_guid = '${firstGuid}';
${prepare('904')};
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM public.webhook_redelivery_requests WHERE delivery_guid = '${firstGuid}' AND request_status = 'archived' AND attempt_count = 8)
  OR (SELECT count(*) FROM public.webhook_reconciliation_recoveries) <> 1
  THEN RAISE EXCEPTION 'Running receipts and archived queues must not be requeued'; END IF; END $$;
ROLLBACK;
`;
  const directory = await mkdtemp(path.join(os.tmpdir(), 'issue-60-postgres-'));
  try {
    const file = path.join(directory, 'fixture.sql');
    await writeFile(file, script, { mode: 0o600 });
    await promisify(execFile)('psql', ['--no-psqlrc', '--set', 'ON_ERROR_STOP=1', '--dbname', databaseUrl, '--file', file], { timeout: 30000 });
  } finally { await rm(directory, { recursive: true, force: true }); }
});
