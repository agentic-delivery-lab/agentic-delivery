// agentic-primitive: {"id":"issue-60-bounded-reconciliation-recovery","kind":"script","enforcement":"deterministic","adrs":["ADR-0018"],"domains":["agentic-delivery-control-plane"]}
import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { neon } from '@neondatabase/serverless';
import { reconcileWebhookDeliveries } from '../api/cron/reconcile-webhooks.mjs';
import { createGithubAppJwt } from './lib/github-app.mjs';
import { loadParticipantRegistry, participantForRepository } from './lib/participant-registry.mjs';
import { NeonReplayStore } from './lib/neon-replay-store.mjs';
import { MANIFEST_SHA256 } from './archive-issue-60-deliveries.mjs';

export function validateRecoveryContext(env, mode) {
  if (!['inspect', 'scan', 'replay_one'].includes(mode)
    || env.GITHUB_REF !== 'refs/heads/main' || env.GITHUB_REPOSITORY_ID !== '1358455028'
    || env.CODEX_DELIVERY_APP_INSTALLATION_ID !== '163255060') throw new Error('Invalid recovery context.');
}

export function validateCanaryDelivery(delivery, { guid, deliveryId, registry, centralRepositoryId, now = Date.now() }) {
  // GitHub's window is three days; retain the operator job's seven-minute margin.
  const age = now - Date.parse(delivery?.delivered_at);
  if (!Number.isFinite(age) || age < 0 || age >= (3 * 24 * 60 - 7) * 60_000) {
    throw new Error('The delivery is outside the safe redelivery window.');
  }
  const payload = delivery?.request?.payload;
  const repository = payload?.repository;
  const participant = participantForRepository(registry, repository?.id);
  const number = String(payload?.issue?.number ?? '');
  const canary = (String(repository?.id) === centralRepositoryId && number === '62')
    || (participant?.expectedFullName === 'agentic-delivery-lab/.github' && number === '11');
  if (!registry.valid || delivery.guid !== guid || String(delivery.id) !== deliveryId
    || !participant || participant.expectedFullName !== repository?.full_name
    || participant.mode === 'disabled' || !participant.events.includes(delivery.event) || !canary
    || String(delivery.installation_id) !== '163255060'
    || !payload?.issue || Object.hasOwn(payload.issue, 'pull_request')
    || !['issues', 'issue_comment'].includes(delivery.event)) {
    throw new Error('The selected delivery is outside the approved recovery canaries.');
  }
}

export function boundedFetch({ fetchImpl = fetch, targetId = null } = {}) {
  let posts = 0;
  return async (url, options = {}) => {
    const parsed = new URL(url);
    const method = options.method ?? 'GET';
    if (parsed.origin !== 'https://api.github.com' || parsed.username || parsed.password
      || !/^\/app\/hook\/deliveries(?:\/[1-9][0-9]*(?:\/attempts)?)?$/.test(parsed.pathname)) throw new Error('Unexpected recovery API endpoint.');
    if (method !== 'GET') {
      if (method !== 'POST' || !targetId || parsed.pathname !== `/app/hook/deliveries/${targetId}/attempts`
        || posts !== 0) throw new Error('Recovery exceeded its exact one-delivery boundary.');
      posts += 1;
    }
    return fetchImpl(url, { ...options, redirect: 'error' });
  };
}

export async function inspectRecovery(sql) {
  const rows = await sql.transaction([
    sql`SELECT count(*)::text AS count FROM public.webhook_redelivery_archive
      WHERE operator_evidence->>'manifest_sha256' = ${MANIFEST_SHA256}`,
    sql`SELECT request_status, count(*)::text AS count FROM public.webhook_redelivery_requests GROUP BY request_status`,
    sql`SELECT checkpoint_at, checkpoint_delivery_id::text, updated_at, scan_cursor IS NOT NULL AS scan_pending FROM public.webhook_reconciler_state WHERE state_key = 'github-app-deliveries'`,
    sql`SELECT split_part(replay_key, ':', 2) AS guid, status, github_delivery_id::text AS delivery_id,
      attempt_count, expires_at FROM public.webhook_controller_receipts
      WHERE status <> 'completed' ORDER BY created_at LIMIT 20`,
    sql`SELECT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.webhook_redelivery_requests'::regclass
      AND tgname = 'webhook_redelivery_archive_guard' AND tgenabled = 'O') AS archive_guard_enabled`,
  ], { readOnly: true, isolationLevel: 'RepeatableRead', fetchOptions: { signal: AbortSignal.timeout(30000) } });
  return { archived: rows[0][0]?.count, queue: rows[1], scan: rows[2], pending_receipts: rows[3], archive_guard_enabled: rows[4][0]?.archive_guard_enabled };
}

export async function prepareOneReplay(sql, env, guid, fetchImpl, registryLoader = loadParticipantRegistry) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(guid ?? '') || !/^[0-9]+$/.test(env.GITHUB_RUN_ID ?? '')
    || !/^[0-9a-f]{40}$/.test(env.GITHUB_SHA ?? '') || !/^[a-zA-Z0-9-]+$/.test(env.GITHUB_ACTOR ?? '')) throw new Error('Invalid recovery identity.');
  const receipts = await sql`SELECT github_delivery_id::text AS id FROM public.webhook_controller_receipts
    WHERE replay_key = ${`163255060:${guid}`} AND status IN ('pending', 'retryable')
      AND attempt_count < 8 AND expires_at > clock_timestamp() AND github_delivery_id IS NOT NULL`;
  const id = receipts[0]?.id;
  if (receipts.length !== 1 || !/^[1-9][0-9]*$/.test(id ?? '')) throw new Error('No eligible linked controller receipt.');
  const jwt = createGithubAppJwt({ appId: env.CODEX_DELIVERY_APP_ID, privateKey: env.CODEX_DELIVERY_APP_PRIVATE_KEY });
  const response = await fetchImpl(`https://api.github.com/app/hook/deliveries/${id}`, {
    headers: { Authorization: `Bearer ${jwt}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2026-03-10' }, signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw new Error('The selected delivery is unavailable.');
  const delivery = JSON.parse(await response.text(), (key, value, context) => {
    if (key !== 'id' || typeof value !== 'number') return value;
    if (!/^[1-9][0-9]*$/.test(context?.source ?? '')) throw new Error('Invalid exact delivery identity.');
    return context.source;
  });
  const registry = await registryLoader();
  validateCanaryDelivery(delivery, { guid, deliveryId: id, registry, centralRepositoryId: env.GITHUB_REPOSITORY_ID });
  const migration = await readFile(new URL('../api/github/migrations/0007-audit-targeted-reconciliation-recovery.sql', import.meta.url), 'utf8');
  const evidence = JSON.stringify({ operator: env.GITHUB_ACTOR, commit: env.GITHUB_SHA,
    source_issue: `https://github.com/${env.GITHUB_REPOSITORY}/issues/60`, delivery_id: id,
    repository_id: String(delivery.request.payload.repository.id), event: delivery.event,
    source_number: String(delivery.request.payload.issue.number) });
  const operation = await readFile(new URL('./issue-60-prepare-one-replay.sql', import.meta.url), 'utf8');
  const result = await sql.transaction([
    sql`SET LOCAL lock_timeout = '5s'`, sql`SET LOCAL statement_timeout = '15s'`, sql.query(migration, []),
    sql.query(operation, [`163255060:${guid}`, guid, id, env.GITHUB_RUN_ID, evidence]),
  ], { isolationLevel: 'Serializable', fetchOptions: { signal: AbortSignal.timeout(30000) } });
  if (result[3].length !== 1) throw new Error('The selected recovery state changed; no retry prepared.');
  return id;
}

export async function followUp({ env = process.env, mode, guid, sql, store, fetchImpl = fetch } = {}) {
  validateRecoveryContext(env, mode);
  const databaseUrl = new URL(env.AGENTIC_DELIVERY_REPLAY_DATABASE_URL);
  databaseUrl.hostname = databaseUrl.hostname.replace('-pooler.', '.');
  const client = sql ?? neon(databaseUrl.toString());
  if (mode === 'inspect') return { mode, ...await inspectRecovery(client) };
  const before = await inspectRecovery(client);
  if (before.archived !== '161' || !before.archive_guard_enabled) throw new Error('The archive recovery prerequisite is missing.');
  const safeFetch = boundedFetch({ fetchImpl });
  const targetId = mode === 'replay_one' ? await prepareOneReplay(client, env, guid, safeFetch) : null;
  const replayStore = store ?? new NeonReplayStore({ client });
  const selectedStore = targetId ? new Proxy(replayStore, { get(target, property) {
    if (property === 'dueRedeliveryRequests') return async () => client`SELECT delivery_guid, github_delivery_id::text AS github_delivery_id, attempt_count
      FROM public.webhook_redelivery_requests WHERE delivery_guid = ${guid} AND github_delivery_id::text = ${targetId}
      AND attempt_count < 8 AND (request_status = 'queued' OR (request_status IN ('accepted', 'requesting') AND next_attempt_at <= clock_timestamp()))`;
    const member = Reflect.get(target, property);
    return typeof member === 'function' ? member.bind(target) : member;
  } }) : replayStore;
  const cronSecret = randomBytes(32).toString('hex');
  const output = { statusCode: null, setHeader() {}, end(value) { this.body = JSON.parse(value); } };
  await reconcileWebhookDeliveries({ req: { method: 'GET', headers: { authorization: `Bearer ${cronSecret}` } },
    res: output, env: { ...env, CRON_SECRET: cronSecret }, store: selectedStore,
    fetchImpl: boundedFetch({ fetchImpl, targetId }), redeliveryLimit: targetId ? 1 : 0 });
  if (output.statusCode !== 200 || (targetId && output.body.redelivery_requests !== 1)) throw new Error('The bounded reconciliation did not complete.');
  return { mode, result: output.body, after: await inspectRecovery(client) };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const event = JSON.parse(await readFile(process.env.GITHUB_EVENT_PATH, 'utf8'));
    console.log(JSON.stringify(await followUp({ mode: event.inputs?.reconciliation_followup, guid: event.inputs?.recovery_delivery_guid })));
  } catch { console.error('Bounded recovery failed; inspect the protected state before retrying.'); process.exitCode = 1; }
}
