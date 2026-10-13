// agentic-primitive: {"id":"controller-receipt-schema-migration","kind":"script","enforcement":"deterministic","adrs":["ADR-0018"],"domains":["agentic-delivery-governance","agentic-delivery-control-plane"]}
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { authorizeSchemaInspection } from './inspect-controller-receipt-schema.mjs';

export const RECEIPT_MIGRATION_SHA256 = '9542a6069511463ee60894967e29a859a22f30978c99f8723f31b78e72afcc5a';
export const INSPECTED_RECEIPT_TARGET = 'b93ef7f3088d12b7b5858ba8ea059e480b2c0676365ffb9f8f0917c854c98e8a';
const hash = value => createHash('sha256').update(value).digest('hex');

export function authorizeSchemaMigration(env) {
  authorizeSchemaInspection({...env, AGENTIC_RECEIPT_SCHEMA_INSPECTION:'true'});
  if (env.AGENTIC_RECEIPT_SCHEMA_MIGRATION !== 'apply-0008'
    || !/^[0-9a-f]{40}$/.test(env.GITHUB_SHA ?? '')
    || !/^[1-9][0-9]*$/.test(env.GITHUB_RUN_ID ?? '')) {
    throw new Error('Receipt migration requires an attributable explicit operator action.');
  }
}

// This prepares fixed source statements only. No database connection or mutation.
// The future operator caller must supply the reviewed inspection fingerprint,
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
