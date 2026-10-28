import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { readFile, readdir } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { OperationBudgetStore } from '../../scripts/lib/operation-budget-store.mjs';
import { NeonReplayStore } from '../../scripts/lib/neon-replay-store.mjs';

const socket = process.env.AGENTIC_OPERATION_BUDGET_TEST_SOCKET;
const databaseUrl = process.env.AGENTIC_OPERATION_BUDGET_TEST_DATABASE_URL;
if (databaseUrl) {
  const target = new URL(databaseUrl);
  if (!['localhost','127.0.0.1','[::1]'].includes(target.hostname) || target.pathname !== '/operation_budget_test') throw new Error('Operation budget SQL tests require their dedicated local disposable database.');
}
const enabled = Boolean(socket || databaseUrl);
function literal(value) {
  if (typeof value === 'number' && Number.isSafeInteger(value)) return String(value);
  if (typeof value === 'string') return `'${value.replaceAll("'", "''")}'`;
  throw new Error('Unsupported disposable-fixture parameter.');
}
// Feed stdin explicitly so SQL values never enter process arguments or shell syntax.
async function databaseQuery(statement, values = []) {
  const sql = values.length ? `PREPARE operation_fixture AS ${statement}; EXECUTE operation_fixture(${values.map(literal).join(',')});` : statement;
  const args = ['-X','-q','--csv','-v','ON_ERROR_STOP=1'];
  if (socket) args.push('-h',socket,'-U','adl_fixture','-d','postgres'); else args.push('--dbname',databaseUrl);
  return new Promise((resolve,reject) => {
    const child = execFile('psql',args,{timeout:15000,maxBuffer:1024*1024},(error,stdout) => error ? reject(error) : resolve(stdout.trim()));
    child.stdin.end(sql);
  });
}
const client = { query:async (statement,values) => {
  const output = await databaseQuery(statement,values);
  if (!output) return [];
  // The fixture returns only UUID/hex/numeric/timestamp columns, never CSV text payloads.
  const [header,...lines] = output.split(/\r?\n/);
  const columns = header.split(',');
  return lines.filter(Boolean).map((line) => Object.fromEntries(line.split(',').map((value,index) =>
    [columns[index], /^(model_turns|validation_attempts|controller_attempts)$/.test(columns[index]) ? Number(value) : value])));
} };
const key = (value) => createHash('sha256').update(value).digest('hex');

async function migrateBudgetFixture() {
  const migrations = new URL('../../api/github/migrations/',import.meta.url);
  for (const file of (await readdir(migrations)).filter((name) => name.endsWith('.sql')).sort()) await databaseQuery(await readFile(new URL(file,migrations),'utf8'));
  await databaseQuery(await readFile(new URL('0009-operation-resource-budgets.sql',migrations),'utf8'));
}

test('real PostgreSQL budgets fence origin/attempt, serialize limits and survive duplicate/restarted calls', {skip:!enabled}, async () => {
  await migrateBudgetFixture();
  const scope = {operationId:randomUUID(),repositoryId:'101',issue:7001,controllerCommit:'a'.repeat(40),policySha256:'b'.repeat(64),contextSha256:'c'.repeat(64),runtimeSha256:'d'.repeat(64)};
  const fence = {replayKey:`budget-fixture:${randomUUID()}`,leaseToken:'123:1',workflowRunId:'123',workflowRunAttempt:1};
  await databaseQuery(`INSERT INTO public.webhook_controller_receipts(replay_key,status,lease_token,lease_expires_at,expires_at,origin_repository,origin_repository_id,source_issue_number,controller_commit,workflow_run_id,workflow_run_attempt) VALUES ($1,'running',$2,clock_timestamp()+interval '5 minutes',clock_timestamp()+interval '1 day','fixture/repo',$3::bigint,$4::integer,$5,$6,$7::integer)`,[fence.replayKey,fence.leaseToken,scope.repositoryId,scope.issue,scope.controllerCommit,fence.workflowRunId,fence.workflowRunAttempt]);
  const store = new OperationBudgetStore({client});
  const consumed = {model:0,validation:0,controller:0};
  await store.initialize(scope,consumed,fence);
  assert.equal((await store.reserve({...scope,repositoryId:'102'},'controller',key('wrong-origin'),fence)).allowed,false);
  assert.equal((await store.reserve(scope,'controller',key('wrong-attempt'),{...fence,workflowRunAttempt:2,leaseToken:'123:2'})).allowed,false);
  const attempts = [];
  for (let offset=0; offset<12; offset+=4) attempts.push(...await Promise.all(
    Array.from({length:Math.min(4,12-offset)},(_,i) => store.reserve(scope,'controller',key(`controller-${offset+i}`),fence))));
  assert.equal(attempts.filter((value) => value.allowed).length,8);
  const restarted = new OperationBudgetStore({client});
  const saved = await restarted.initialize(scope,consumed,fence);
  assert.equal(saved.controller_attempts,8);
  assert.equal(Object.hasOwn(saved, 'tool_invocations'), false);
  assert.equal(Object.hasOwn(saved, 'transport_attempts'), false);
  await assert.rejects(() => restarted.reserve(scope,'tool',key('withdrawn-tool-budget'),fence), /resource/);
  await assert.rejects(() => restarted.reserve(scope,'transport',key('withdrawn-native-transport-budget'),fence), /resource/);
  assert.equal((await restarted.reserve(scope,'controller',key('controller-0'),fence)).allowed,false);
  assert.equal((await restarted.reserve(scope,'controller',key('over-limit'),fence)).allowed,false);
  for (const changed of [{policySha256:'e'.repeat(64)},{contextSha256:'e'.repeat(64)},{runtimeSha256:'e'.repeat(64)},{operationId:randomUUID()}]) {
    await assert.rejects(() => restarted.initialize({...scope,...changed},consumed,fence),/readmission/);
  }
  const lostKey = key('lost-model-response');
  const uncertain = new OperationBudgetStore({client:{query:async (sql,values) => {
    await client.query(sql,values); throw new Error('Fixture response lost after commit');
  }}});
  await assert.rejects(() => uncertain.reserve(scope,'model',lostKey,fence),/uncertain/);
  assert.equal((await restarted.reserve(scope,'model',lostKey,fence)).allowed,false);
  assert.equal((await restarted.initialize(scope,consumed,fence)).model_turns,1);
  await databaseQuery(`UPDATE public.webhook_controller_receipts SET lease_expires_at=clock_timestamp()-interval '1 second' WHERE replay_key=$1`,[fence.replayKey]);
  assert.equal((await restarted.reserve(scope,'validation',key('expired-lease'),fence)).allowed,false);
  await databaseQuery(`UPDATE public.webhook_controller_receipts SET lease_expires_at=clock_timestamp()+interval '5 minutes' WHERE replay_key=$1`,[fence.replayKey]);
  assert.equal((await restarted.initialize(scope,consumed,fence)).validation_attempts,0);
  for (const [resource,remaining] of [['model',7],['validation',3]]) {
    for (let i=0;i<remaining;i++) assert.equal((await restarted.reserve(scope,resource,key(`${resource}-${i}`),fence)).allowed,true);
    assert.equal((await restarted.reserve(scope,resource,key(`${resource}-over`),fence)).allowed,false);
  }
});

for (const [offset, recovery] of ['refresh-expired-receipt', 'garbage-collect-and-recreate'].entries()) {
  test(`real PostgreSQL operation allowance survives ${recovery} with a new fence`, {skip:!enabled}, async () => {
    await migrateBudgetFixture();
    const scope = {operationId:randomUUID(),repositoryId:'101',issue:7100+offset,
      controllerCommit:'a'.repeat(40),policySha256:'b'.repeat(64),contextSha256:'c'.repeat(64),runtimeSha256:'d'.repeat(64)};
    const replayKey = `budget-retention:${randomUUID()}`;
    const oldFence = {replayKey,leaseToken:'321:1',workflowRunId:'321',workflowRunAttempt:1};
    const zero = {model:0,validation:0,controller:0};
    const receipts = new NeonReplayStore({client});
    async function admitFence(fence) {
      await receipts.ensureControllerReceipt(replayKey);
      assert.equal((await receipts.claimController(replayKey,{leaseToken:fence.leaseToken})).status,'claimed');
      await receipts.recordControllerIdentity(replayKey,{leaseToken:fence.leaseToken,identity:{
        originRepository:'fixture/repo',originRepositoryId:scope.repositoryId,sourceIssueNumber:scope.issue,
        controllerCommit:scope.controllerCommit,workflowRunId:fence.workflowRunId,workflowRunAttempt:fence.workflowRunAttempt,
      }});
    }
    await admitFence(oldFence);
    const store = new OperationBudgetStore({client});
    await store.initialize(scope,zero,oldFence);
    for (const [index,resource] of ['model','validation','controller','controller'].entries()) {
      assert.equal((await store.reserve(scope,resource,key(`before-${index}`),oldFence)).allowed,true);
    }
    const spent = await store.initialize(scope,zero,oldFence);
    assert.equal(spent.model_turns,1);assert.equal(spent.validation_attempts,1);assert.equal(spent.controller_attempts,2);

    // Expire retention while the lease is still live: neither predicate alone suffices.
    await databaseQuery(`UPDATE public.webhook_controller_receipts
      SET expires_at=clock_timestamp()-interval '1 second',lease_expires_at=clock_timestamp()+interval '5 minutes'
      WHERE replay_key=$1`,[replayKey]);
    assert.equal((await store.reserve(scope,'model',key('expired-retention'),oldFence)).allowed,false);
    await assert.rejects(store.initialize(scope,zero,oldFence),/readmission/);
    if (recovery === 'garbage-collect-and-recreate') {
      // Exercise the real bounded controller-receipt garbage collector, not a test DELETE.
      await receipts.ensureControllerReceipt(`budget-retention-trigger:${randomUUID()}`);
      assert.equal(await receipts.controllerReceipt(replayKey),null);
    }
    const nextFence = {...oldFence,leaseToken:'321:2',workflowRunAttempt:2};
    await admitFence(nextFence);
    const nextReceipt = await receipts.controllerReceipt(replayKey);
    assert.equal(nextReceipt.identity.workflowRunAttempt,2);
    assert.equal(Number(nextReceipt.attempt_count),1);

    // A restarted caller with no local counters may recover the exact operation,
    // but cannot replace its identity or replenish spent capacity.
    const restarted = new OperationBudgetStore({client});
    await assert.rejects(restarted.initialize({...scope,operationId:randomUUID()},zero,nextFence),/readmission/);
    const retained = await restarted.initialize(scope,zero,nextFence);
    assert.equal(retained.operation_id,scope.operationId);
    for (const column of ['model_turns','validation_attempts','controller_attempts']) assert.equal(retained[column],spent[column]);
    assert.equal((await restarted.reserve(scope,'model',key('before-0'),nextFence)).allowed,false);
    assert.equal((await restarted.reserve(scope,'model',key('stale-owner'),oldFence)).allowed,false);
    for (const [resource,column,limit] of [['model','model_turns',8],['validation','validation_attempts',3],['controller','controller_attempts',8]]) {
      for (let i=retained[column];i<limit;i++) assert.equal((await restarted.reserve(scope,resource,key(`${resource}-after-${i}`),nextFence)).allowed,true);
      assert.equal((await restarted.reserve(scope,resource,key(`${resource}-past-retained-limit`),nextFence)).allowed,false);
    }
    const exhausted = await restarted.initialize(scope,zero,nextFence);
    assert.equal(exhausted.model_turns,8);assert.equal(exhausted.validation_attempts,3);assert.equal(exhausted.controller_attempts,8);
  });
}
