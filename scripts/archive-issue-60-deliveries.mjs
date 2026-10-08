// agentic-primitive: {"id":"issue-60-webhook-delivery-archive","kind":"script","enforcement":"deterministic","adrs":["ADR-0018"],"domains":["agentic-delivery-control-plane"]}
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { neon } from '@neondatabase/serverless';
import { createGithubAppJwt } from './lib/github-app.mjs';

export const MANIFEST_SHA256 = 'd16f6bff149ffaabe3e67a324a1a2ff489fe03bff4fb0ad76d7d88424dc84055';
const EVIDENCE_SHA256 = 'e0efb4c8a544eb9c3ebd60149f10a565294ac398e1abc2f9cbec9825e4bb781c';
const INSTALLATION_ID = '163255060';

export function validateManifest(text) {
  if (typeof text !== 'string' || createHash('sha256').update(text).digest('hex') !== MANIFEST_SHA256) {
    throw new Error('The recovery manifest does not match the approved evidence.');
  }
  const rows = JSON.parse(text);
  if (rows.length !== 161 || new Set(rows.map((row) => row.delivery_guid)).size !== 161
    || rows.some((row) => !/^[0-9a-f-]{36}$/.test(row.delivery_guid)
      || !/^[1-9][0-9]*$/.test(row.stored_delivery_id)
      || row.observed_delivery_id !== row.stored_delivery_id
      || row.observation_installation_id !== INSTALLATION_ID)) {
    throw new Error('The recovery manifest is invalid.');
  }
  return rows;
}

export async function verifyAbsentHistory(rows, jwt, fetchImpl = fetch) {
  const candidates = new Set(rows.map((row) => row.delivery_guid));
  let route = '/app/hook/deliveries?per_page=100';
  for (let page = 1; page <= 20; page += 1) {
    const response = await fetchImpl(`https://api.github.com${route}`, {
      headers: { Authorization: `Bearer ${jwt}`, Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2026-03-10' },
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) throw new Error('The fresh delivery history request failed.');
    const deliveries = await response.json();
    if (!Array.isArray(deliveries) || deliveries.some((item) => typeof item.guid !== 'string')) {
      throw new Error('The fresh delivery history is invalid.');
    }
    // Only GUID membership is used; numeric delivery IDs never enter this operation.
    if (deliveries.some((item) => candidates.has(item.guid))) {
      throw new Error('An archive candidate is available in fresh history.');
    }
    const link = response.headers.get('link') ?? '';
    const next = /<([^>]+)>;\s*rel="next"/.exec(link);
    if (!next) {
      if (link.includes('rel="next"')) throw new Error('The history pagination is invalid.');
      return { pages: page, captured_at: new Date().toISOString() };
    }
    const url = new URL(next[1]);
    if (url.origin !== 'https://api.github.com' || url.pathname !== '/app/hook/deliveries'
      || url.username || url.password) throw new Error('The history pagination is invalid.');
    route = `${url.pathname}${url.search}`;
  }
  throw new Error('The fresh delivery history scan is incomplete.');
}

export async function recover({ env = process.env, sql, fetchImpl = fetch } = {}) {
  if (!['preview', 'apply'].includes(env.RECOVERY_MODE)) throw new Error('Select preview or apply explicitly.');
  const rows = validateManifest(env.RECOVERY_MANIFEST);
  if (env.GITHUB_REPOSITORY !== 'agentic-delivery-lab/agentic-delivery'
    || env.CODEX_DELIVERY_APP_INSTALLATION_ID !== INSTALLATION_ID) {
    throw new Error('The recovery repository or installation is invalid.');
  }
  if (env.GITHUB_REF !== 'refs/heads/main') {
    throw new Error('Recovery requires the reviewed implementation on main.');
  }
  const jwt = createGithubAppJwt({ appId: env.CODEX_DELIVERY_APP_ID, privateKey: env.CODEX_DELIVERY_APP_PRIVATE_KEY });
  const history = await verifyAbsentHistory(rows, jwt, fetchImpl);
  let client = sql;
  if (!client) {
    const databaseUrl = new URL(env.AGENTIC_DELIVERY_REPLAY_DATABASE_URL);
    databaseUrl.hostname = databaseUrl.hostname.replace('-pooler.', '.');
    client = neon(databaseUrl.toString());
  }
  const snapshot = await client.transaction([
    client`SELECT updated_at::text AS updated_at FROM public.webhook_reconciler_state WHERE state_key = 'github-app-deliveries'`,
    client`SELECT q.request_status, count(*)::text AS count FROM public.webhook_redelivery_requests q
      JOIN jsonb_to_recordset(${JSON.stringify(rows)}::jsonb) AS m(delivery_guid text,
        stored_delivery_id text, observed_delivery_id text, observation_installation_id text) USING (delivery_guid)
      JOIN public.webhook_reconciler_observations o USING (delivery_guid)
      WHERE q.attempt_count = 1 AND q.github_delivery_id::text = m.stored_delivery_id
        AND o.newest_delivery_id::text = m.observed_delivery_id
        AND o.installation_id::text = m.observation_installation_id AND NOT o.has_success
        AND NOT EXISTS (SELECT 1 FROM public.webhook_controller_receipts c
          WHERE split_part(c.replay_key, ':', 2) = q.delivery_guid)
      GROUP BY q.request_status`,
  ], { readOnly: true, isolationLevel: 'RepeatableRead', fetchOptions: { signal: AbortSignal.timeout(30000) } });
  if (snapshot[0].length !== 1 || snapshot[1].length !== 1
    || snapshot[1][0].request_status !== 'exhausted' || snapshot[1][0].count !== '161') {
    throw new Error('The recovery snapshot no longer matches the approved candidates.');
  }
  if (env.RECOVERY_MODE === 'preview') return { mode: 'preview', candidates: rows.length, history_pages: history.pages };
  if (!/^[0-9]+$/.test(env.GITHUB_RUN_ID ?? '') || !/^[0-9a-f]{40}$/.test(env.GITHUB_SHA ?? '')
    || !/^[a-zA-Z0-9-]+$/.test(env.GITHUB_ACTOR ?? '')) throw new Error('Missing operator audit identity.');
  const evidence = { source_issue: 'https://github.com/agentic-delivery-lab/agentic-delivery/issues/60',
    approved_evidence_run: '37762823635', evidence_sha256: EVIDENCE_SHA256,
    manifest_sha256: MANIFEST_SHA256, history, operator: env.GITHUB_ACTOR,
    run_id: env.GITHUB_RUN_ID, implementation_commit: env.GITHUB_SHA };
  const migration = await readFile(new URL('../api/github/migrations/0006-archive-unavailable-webhook-deliveries.sql', import.meta.url), 'utf8');
  const operation = await readFile(new URL('./issue-60-archive-unavailable.sql', import.meta.url), 'utf8');
  const result = await client.transaction([
    client`SET LOCAL lock_timeout = '5s'`,
    client`SET LOCAL statement_timeout = '15s'`,
    client.query(migration, []), client.query(operation, []),
    client`SELECT pg_temp.archive_issue_60_deliveries(${JSON.stringify(rows)}::jsonb,
      ${JSON.stringify(evidence)}::jsonb, ${snapshot[0][0].updated_at}::timestamptz) AS archived`,
    client`SELECT count(*)::text AS archived FROM public.webhook_redelivery_archive
      WHERE operator_evidence->>'manifest_sha256' = ${MANIFEST_SHA256}`,
  ], { isolationLevel: 'Serializable', fetchOptions: { signal: AbortSignal.timeout(60000) } });
  if (result[4][0]?.archived !== 161 || result[5][0]?.archived !== '161') throw new Error('Recovery read-back failed.');
  return { mode: 'apply', archived: 161, history_pages: history.pages, scan_restarted: true, manifest_sha256: MANIFEST_SHA256 };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { console.log(JSON.stringify(await recover())); }
  catch { console.error('Recovery failed; inspect the approved manifest and protected state before retrying.'); process.exitCode = 1; }
}
