// agentic-primitive: {"id":"controller-receipt-schema-migration","kind":"script","enforcement":"deterministic","adrs":["ADR-0018"],"domains":["agentic-delivery-governance","agentic-delivery-control-plane"]}
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { neon } from '@neondatabase/serverless';
import { authorizeSchemaInspection, inspectControllerReceiptSchema } from './inspect-controller-receipt-schema.mjs';

export const RECEIPT_MIGRATION_SHA256 = '9542a6069511463ee60894967e29a859a22f30978c99f8723f31b78e72afcc5a';
export const INSPECTED_RECEIPT_TARGET = 'b93ef7f3088d12b7b5858ba8ea059e480b2c0676365ffb9f8f0917c854c98e8a';
export const RECEIPT_CONSTRAINT_SHA256 = '65a785aca8a1edb7e867cb54d53d21eaa01d92341c8d8d07d8ca7c13a7777c8e';
const hash = value => createHash('sha256').update(value).digest('hex');

export function authorizeSchemaMigration(env) {
  authorizeSchemaInspection({...env, AGENTIC_RECEIPT_SCHEMA_INSPECTION:'true'});
  if (env.AGENTIC_RECEIPT_SCHEMA_MIGRATION !== 'apply-0008'
    || !/^[0-9a-f]{40}$/.test(env.GITHUB_SHA ?? '')
    || !/^[1-9][0-9]*$/.test(env.GITHUB_RUN_ID ?? '')
    || !/^[1-9][0-9]*$/.test(env.GITHUB_RUN_ATTEMPT ?? '')) {
    throw new Error('Receipt migration requires an attributable explicit operator action.');
  }
}

// This prepares fixed source statements only. No database connection or mutation.
// The operator caller must supply the reviewed inspection fingerprint,
// authorize the operation, and keep the whole plan in one bounded transaction.
export async function prepareReceiptSchemaMigration({connectionUrl, inspectedTargetFingerprint} = {}) {
  let target;
  try { target = new URL(connectionUrl); } catch { throw new Error('Unknown receipt migration target.'); }
  if (!['postgres:','postgresql:'].includes(target.protocol) || !target.hostname.endsWith('.neon.tech')) throw new Error('Unknown receipt migration target.');
  target.hostname = target.hostname.replace('-pooler.', '.');
  const targetFingerprint = hash(`${target.hostname}|${target.pathname}`);
  if (targetFingerprint !== inspectedTargetFingerprint) throw new Error('Receipt migration target differs from the reviewed inspection.');
  const migration = await readFile(new URL('../api/github/migrations/0008-controller-receipt-attribution.sql', import.meta.url), 'utf8');
  if (hash(migration) !== RECEIPT_MIGRATION_SHA256) throw new Error('Receipt migration source changed; review is required.');
  const statements = migration.trim().split('\n\nDO ');
  if (statements.length !== 2) throw new Error('Unexpected receipt migration structure.');
  const precondition = `DO $$ BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'webhook_controller_receipts'
      AND column_name IN ('origin_repository','origin_repository_id','source_issue_number','controller_commit','workflow_run_id','workflow_run_attempt'))
      OR EXISTS (SELECT 1 FROM pg_constraint
        WHERE conrelid = 'public.webhook_controller_receipts'::regclass
        AND conname = 'webhook_controller_receipts_identity_check') THEN
      RAISE EXCEPTION 'Receipt attribution schema changed since inspection; hold for review';
    END IF;
  END $$`;
  return Object.freeze({targetFingerprint, migrationSha256:RECEIPT_MIGRATION_SHA256,
    statements:Object.freeze([
      "SET LOCAL lock_timeout = '2s'",
      "SET LOCAL statement_timeout = '10s'",
      'LOCK TABLE public.webhook_controller_receipts IN ACCESS EXCLUSIVE MODE',
      precondition, statements[0], `DO ${statements[1]}`,
    ])});
}

export async function migrateReceiptSchema({env, connectionUrl, clientFactory = neon,
  inspect = inspectControllerReceiptSchema, inspectedTargetFingerprint = INSPECTED_RECEIPT_TARGET} = {}) {
  authorizeSchemaMigration(env ?? {});
  const plan = await prepareReceiptSchemaMigration({connectionUrl, inspectedTargetFingerprint});
  const direct = new URL(connectionUrl);
  direct.hostname = direct.hostname.replace('-pooler.', '.');
  try {
    const client = clientFactory(direct.toString());
    const result = await client.transaction(plan.statements.map(statement => client.query(statement)), {
      readOnly:false, isolationLevel:'Serializable', fetchOptions:{signal:AbortSignal.timeout(30_000)},
    });
    if (!Array.isArray(result) || result.length !== plan.statements.length) throw new Error('Uncertain transaction response.');
    const observed = await inspect({connectionUrl:direct.toString()});
    if (observed.targetFingerprint !== plan.targetFingerprint || !observed.expectedColumnsPresent
      || !observed.constraintPresent || !observed.constraintValidated
      || observed.constraintDefinitionSha256 !== RECEIPT_CONSTRAINT_SHA256) throw new Error('Unexpected schema readback.');
    return {schemaVersion:1, operation:'migration-0008', targetFingerprint:plan.targetFingerprint,
      migrationSha256:plan.migrationSha256, constraintDefinitionSha256:observed.constraintDefinitionSha256,
      implementationCommit:env.GITHUB_SHA, workflowRunId:env.GITHUB_RUN_ID,
      workflowRunAttempt:env.GITHUB_RUN_ATTEMPT, operatorId:env.GITHUB_ACTOR_ID,
      evidenceLimit:'Workflow target migration and independent readback; production deployment target equivalence and writer rollout remain separate gates.'};
  } catch { throw new Error('Receipt migration requires read-only reconciliation before retry; sensitive diagnostics are withheld.'); }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { process.stdout.write(`${JSON.stringify(await migrateReceiptSchema({env:process.env, connectionUrl:process.env.AGENTIC_DELIVERY_REPLAY_DATABASE_URL}))}\n`); }
  catch { process.stderr.write('Receipt migration did not produce accepted readback; reconcile read-only before retry. Sensitive diagnostics are withheld.\n'); process.exitCode=1; }
}
