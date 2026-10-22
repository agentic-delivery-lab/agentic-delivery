import assert from 'node:assert/strict';
import { test } from 'node:test';
import { OperationBudgetStore } from '../../scripts/lib/operation-budget-store.mjs';

const scope = { operationId:'12345678-1234-4234-8234-123456789012', repositoryId:'101', issue:7,
  controllerCommit:'a'.repeat(40), policySha256:'b'.repeat(64), contextSha256:'c'.repeat(64), runtimeSha256:'d'.repeat(64) };
const fence = { replayKey:'fixture:operation', leaseToken:'123:1', workflowRunId:'123', workflowRunAttempt:1 };
const consumed = { model:0, validation:0, controller:0 };

test('unknown consumption or unsupported resources hold before reaching storage', async () => {
  let calls = 0;
  const store = new OperationBudgetStore({ client:{ query:async () => { calls++; return []; } } });
  await assert.rejects(() => store.initialize(scope, { ...consumed, model:null }, fence), /consumption/i);
  await assert.rejects(() => store.reserve(scope, 'child', 'e'.repeat(64), fence), /resource/i);
  await assert.rejects(() => store.reserve(scope, 'model', 'e'.repeat(64), { ...fence, leaseToken:'wrong' }), /lease/i);
  assert.equal(calls, 0);
});

test('storage uncertainty never returns a fresh allowance or leaks diagnostics', async () => {
  const store = new OperationBudgetStore({ client:{ query:async () => { throw new Error('credential=secret-value'); } } });
  await assert.rejects(() => store.initialize(scope, consumed, fence), (error) => {
    assert.equal(error.code, 'OPERATION_BUDGET_HOLD');
    assert.doesNotMatch(error.message, /secret-value/); return true;
  });
});


test('withdrawn universal tool budget cannot reserve or query storage', async () => {
  let calls = 0;
  const store = new OperationBudgetStore({ client: { query: async () => { calls++; return []; } } });
  await assert.rejects(() => store.reserve(scope, 'tool', 'e'.repeat(64), fence), /resource/);
  assert.equal(calls, 0);
});

test('withdrawn native transport budget cannot reserve or query storage', async () => {
  let calls = 0;
  const store = new OperationBudgetStore({ client: { query: async () => { calls++; return []; } } });
  await assert.rejects(() => store.reserve(scope, 'transport', 'e'.repeat(64), fence), /resource/);
  assert.equal(calls, 0);
});
