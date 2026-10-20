// agentic-primitive: {"id":"controller-receipt-schema-inspection","kind":"validator","enforcement":"deterministic","adrs":["ADR-0018"],"domains":["agentic-delivery-governance","agentic-delivery-control-plane"]}
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { neon } from '@neondatabase/serverless';

const expected = { origin_repository:'text', origin_repository_id:'bigint', source_issue_number:'integer', controller_commit:'text', workflow_run_id:'text', workflow_run_attempt:'integer' };
const query = `SELECT
  (SELECT jsonb_agg(jsonb_build_object('name', column_name, 'type', data_type, 'nullable', is_nullable = 'YES'))
   FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'webhook_controller_receipts'
     AND column_name IN ('origin_repository','origin_repository_id','source_issue_number','controller_commit','workflow_run_id','workflow_run_attempt')) AS columns,
  (SELECT jsonb_build_object('validated', convalidated, 'definition', pg_get_constraintdef(oid))
   FROM pg_constraint WHERE conrelid = to_regclass('public.webhook_controller_receipts')
     AND conname = 'webhook_controller_receipts_identity_check' AND contype = 'c') AS identity_constraint`;
const digest = (value) => createHash('sha256').update(value).digest('hex');

export function authorizeSchemaInspection(env) {
  if (env.GITHUB_ACTIONS !== 'true' || env.GITHUB_EVENT_NAME !== 'workflow_dispatch'
    || env.GITHUB_ACTOR_ID !== '14937399' || env.GITHUB_REPOSITORY_ID !== '1358455028'
    || env.AGENTIC_RECEIPT_SCHEMA_INSPECTION !== 'true') {
    throw new Error('Controller receipt schema inspection requires its operator-only workflow.');
  }
}

export async function inspectControllerReceiptSchema({ connectionUrl, client } = {}) {
  let target;
  try { target = new URL(connectionUrl); } catch { throw new Error('Schema inspection requires the approved Neon connection.'); }
  if (!['postgres:','postgresql:'].includes(target.protocol) || !target.hostname.endsWith('.neon.tech')) throw new Error('Schema inspection requires the approved Neon connection.');
  const sql = client ?? neon(connectionUrl);
  let result;
  try {
    result = await sql.transaction([sql.query(query)], { readOnly:true, fetchOptions:{signal:AbortSignal.timeout(30_000)} });
  } catch { throw new Error('Controller receipt schema inspection failed; connection diagnostics are withheld.'); }
  const row = result?.[0]?.[0];
  if (result?.length !== 1 || result[0]?.length !== 1 || !row || !Object.hasOwn(row,'columns') || !Object.hasOwn(row,'identity_constraint')) throw new Error('Invalid controller receipt schema response.');
  const columns = row.columns ?? [];
  const constraint = row.identity_constraint;
  if (!Array.isArray(columns) || (constraint !== null && (typeof constraint?.validated !== 'boolean' || typeof constraint?.definition !== 'string'))) throw new Error('Invalid controller receipt schema response.');
  return {
    schemaVersion:1,
    targetFingerprint:digest(`${target.hostname.replace('-pooler.','.')}|${target.pathname}`),
    expectedColumnsPresent:columns.length === 6 && Object.entries(expected).every(([name,type]) => columns.some(c=>c.name===name && c.type===type && c.nullable===true)),
    constraintPresent:constraint !== null,
    constraintValidated:constraint?.validated === true,
    constraintDefinitionSha256:constraint ? digest(constraint.definition) : null,
    evidenceLimit:'Schema metadata only; constraint semantics, deployed target equivalence and migration acceptance require separate verification.',
  };
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { authorizeSchemaInspection(process.env); process.stdout.write(`${JSON.stringify(await inspectControllerReceiptSchema({connectionUrl:process.env.AGENTIC_DELIVERY_REPLAY_DATABASE_URL}))}\n`); }
  catch { process.stderr.write('Controller receipt schema inspection failed; sensitive diagnostics are withheld.\n'); process.exitCode=1; }
}
