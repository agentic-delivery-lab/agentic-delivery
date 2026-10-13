import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHash } from 'node:crypto';
import { prepareReceiptSchemaMigration, authorizeSchemaMigration } from '../../scripts/migrate-controller-receipt-schema.mjs';
const url = 'postgresql://fixture:fixture@fixture-pooler.neon.tech/fixture';
const fingerprint = createHash('sha256').update('fixture.neon.tech|/fixture').digest('hex');
const env = {GITHUB_ACTIONS:'true',GITHUB_EVENT_NAME:'workflow_dispatch',GITHUB_ACTOR_ID:'14937399',GITHUB_REPOSITORY_ID:'1358455028',GITHUB_SHA:'a'.repeat(40),GITHUB_RUN_ID:'123',AGENTIC_RECEIPT_SCHEMA_MIGRATION:'apply-0008'};
test('migration requires the explicit operator action and native origin', () => {
  authorizeSchemaMigration(env);
  for (const change of [{GITHUB_ACTOR_ID:'1'},{GITHUB_EVENT_NAME:'pull_request'},{AGENTIC_RECEIPT_SCHEMA_MIGRATION:'true'},{GITHUB_SHA:''},{GITHUB_REPOSITORY_ID:'1'}]) assert.throws(()=>authorizeSchemaMigration({...env,...change}));
});
test('fixed migration plan binds the inspected target before database calls', async () => {
  const plan = await prepareReceiptSchemaMigration({connectionUrl:url, inspectedTargetFingerprint:fingerprint});
  assert.equal(plan.targetFingerprint,fingerprint);
  assert.ok(!JSON.stringify(plan).includes('fixture'));
  assert.ok(!Object.hasOwn(plan,'connectionUrl'));
  assert.match(plan.statements[0],/lock_timeout = '2s'/);
  assert.match(plan.statements[1],/statement_timeout = '10s'/);
  assert.match(plan.statements[2],/ACCESS EXCLUSIVE/);
  assert.match(plan.statements[3],/RAISE EXCEPTION/);
  assert.match(plan.statements[4],/^ALTER TABLE public.webhook_controller_receipts/);
  assert.match(plan.statements[5],/^DO/);
  assert.equal(plan.migrationSha256,'9542a6069511463ee60894967e29a859a22f30978c99f8723f31b78e72afcc5a');
  await assert.rejects(prepareReceiptSchemaMigration({connectionUrl:url,inspectedTargetFingerprint:'0'.repeat(64)}),/target/);
  await assert.rejects(prepareReceiptSchemaMigration({connectionUrl:'postgresql://fixture:fixture@wrong.invalid/db',inspectedTargetFingerprint:fingerprint}),/target/);
});
