import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, readFile, rm, stat, mkdir, chmod, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { currentOperationPolicyReference, INITIAL_OPERATION_LIMITS } from '../../scripts/lib/operation-budget-policy.mjs';
import { createOperationReceipt, writeOperationReceipt } from '../../scripts/lib/operation-receipt.mjs';

const input = () => ({
  stage: 'admission', outcome: 'admitted', repository: 'fixture/repo', repositoryId: '101', issue: '7', actor: 'maintainer',
  runId: '123', runAttempt: '1', authorityChecked: true, nowMs: 100,
  state: { operationId: '12345678-1234-4234-8234-123456789012',
    budgetPolicyReference: { id: 'factory-budget', version: '1.0.0-proposed.1', sha256: 'a'.repeat(64) },
    validationProfileReference: { id: 'control-plane', version: '1.0.0', contentSha256: 'b'.repeat(64), controllerCommit: 'c'.repeat(40) },
    controllerAttemptCount: 1, modelTurnCount: 2, validationAttemptCount: 1,
    activeTime: { version: 1, limitMs: 1800000, spentMs: 25, reservation: null },
  },
});

test('versioned admission snapshots preserve provenance and represent unknown tool consumption', () => {
  const value = input(); const receipt = createOperationReceipt(value);
  assert.equal(receipt.schemaVersion, 2);
  assert.equal(receipt.operationId, value.state.operationId);
  assert.equal(receipt.consumption.toolInvocations, null);
  assert.equal(receipt.authorityContext, null, 'receipt cannot fabricate W12 approval');
  value.state.modelTurnCount = 8;
  assert.equal(receipt.consumption.modelTurns, 2);
});

test('terminal publication requires confirmed shutdown, settlement and credential cleanup', () => {
  const value = { ...input(), stage: 'terminal', outcome: 'candidate-published', shutdown: { ownedExecutionStopped: true, activeTimeSettled: true, issuedTokenRevocationConfirmed: true } };
  assert.equal(createOperationReceipt(value).outcome, 'candidate-published');
  for (const key of Object.keys(value.shutdown)) assert.throws(() => createOperationReceipt({ ...value, shutdown: { ...value.shutdown, [key]: false } }), /receipt/i);
  assert.equal(createOperationReceipt({ ...value, outcome: 'held', shutdown: { ...value.shutdown, ownedExecutionStopped: false } }).outcome, 'held');
});

test('held unknown identity does not mint a new operation or reset unknown consumption', () => {
  const value = input(); value.outcome = 'held'; value.authorityChecked = false; value.state = {};
  const receipt = createOperationReceipt(value);
  assert.equal(receipt.operationId, null);
  assert.equal(receipt.consumption.modelTurns, null);
  assert.equal(receipt.policy, null);
  assert.throws(() => createOperationReceipt({ ...value, outcome: 'admitted' }), /receipt/i);
});

test('private journal writes separate immutable receipts without overwriting history', async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), 'operation-receipt-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const receipt = createOperationReceipt(input());
  const first = await writeOperationReceipt(root, receipt);
  const second = await writeOperationReceipt(root, receipt);
  assert.notEqual(first, second);
  assert.deepEqual(JSON.parse(await readFile(first, 'utf8')), receipt);
  if (process.platform !== 'win32') {
    assert.equal((await stat(first)).mode & 0o777, 0o600);
    assert.equal((await stat(path.dirname(first))).mode & 0o777, 0o700);
  }
});


test('journal rejects a public or redirected directory instead of exposing private records', { skip: process.platform === 'win32' }, async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), 'operation-receipt-directory-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const journal = path.join(root, 'operation-receipts');
  await mkdir(journal); await chmod(journal, 0o755);
  await assert.rejects(() => writeOperationReceipt(root, createOperationReceipt(input())), /private directory/);
  await rm(journal, { recursive: true });
  const destination = path.join(root, 'other'); await mkdir(destination, { mode: 0o700 });
  await symlink(destination, journal);
  await assert.rejects(() => writeOperationReceipt(root, createOperationReceipt(input())), /private directory/);
});

test('receipts carry configured limits only when their policy fingerprint matches', () => {
  const value = input(); value.state.budgetPolicyReference = currentOperationPolicyReference();
  const receipt = createOperationReceipt(value);
  assert.equal(receipt.schemaVersion, 2);
  assert.deepEqual(receipt.configuredLimits, INITIAL_OPERATION_LIMITS);
  value.state.budgetPolicyReference.sha256 = 'e'.repeat(64);
  assert.equal(createOperationReceipt(value).configuredLimits, null);
});

test('held receipts explain exhausted budgets without leaking provider diagnostics', () => {
  const value = input(); value.outcome = 'held'; value.failureCode = 'OPERATION_BUDGET_HOLD'; value.state.budgetPolicyReference = currentOperationPolicyReference();
  value.state.modelTurnCount = 8; value.state.reason = 'provider credential=secret-value';
  const receipt = createOperationReceipt(value);
  assert.equal(receipt.failureClass, 'budget');
  assert.equal(receipt.stopReason, 'model-turn-limit');
  assert.match(receipt.recoveryAction, /operator.*without resetting/i);
  assert.doesNotMatch(JSON.stringify(receipt), /secret-value/);
});

test('cleanup uncertainty takes precedence and successful outcomes carry no failure', () => {
  const value = {...input(), stage:'terminal', outcome:'held', shutdown:{ownedExecutionStopped:true,activeTimeSettled:true,issuedTokenRevocationConfirmed:false}};
  const receipt = createOperationReceipt(value);
  assert.equal(receipt.failureClass, 'credential-cleanup');
  assert.equal(receipt.stopReason, 'issued-token-revocation-unconfirmed');
  assert.match(receipt.recoveryAction, /operator.*revocation/i);
  const successful = createOperationReceipt(input());
  assert.equal(successful.failureClass, null);assert.equal(successful.stopReason, null);assert.equal(successful.recoveryAction, null);
});

test('budget stop reasons distinguish limits, missing history and changed policy', () => {
  for (const [change,reason] of [
    [{controllerAttemptCount:8},'controller-attempt-limit'],
    [{validationAttemptCount:3},'validation-attempt-limit'],
    [{activeTime:{version:1,limitMs:1800000,spentMs:1800000,reservation:null}},'active-time-limit'],
    [{modelTurnCount:null},'unknown-consumption'],
    [{operationId:null,budgetPolicyReference:null},'unknown-consumption'],
    [{budgetPolicyReference:null},'policy-readmission'],
  ]) {
    const value = input();value.outcome='held';value.failureCode='OPERATION_BUDGET_HOLD';
    Object.assign(value.state,{budgetPolicyReference:currentOperationPolicyReference()},change);
    assert.equal(createOperationReceipt(value).stopReason,reason);
  }
  const value=input();value.outcome='held';value.failureCode='VALIDATION_PROFILE_HOLD';
  assert.equal(createOperationReceipt(value).stopReason,'validation-profile-readmission');
  value.failureCode='provider-secret';value.state.reason='provider-secret';
  assert.equal(createOperationReceipt(value).stopReason,'execution-held');
  assert.doesNotMatch(JSON.stringify(createOperationReceipt(value)),/provider-secret/);
});
