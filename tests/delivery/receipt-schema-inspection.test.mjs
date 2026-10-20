import assert from 'node:assert/strict';
import { test } from 'node:test';
import { inspectControllerReceiptSchema, authorizeSchemaInspection } from '../../scripts/inspect-controller-receipt-schema.mjs';
const url = 'postgresql://fixture:fixture@fixture.neon.tech/fixture?sslmode=require';
const columns = ['origin_repository','origin_repository_id','source_issue_number','controller_commit','workflow_run_id','workflow_run_attempt'].map((name,index)=>({name,type:index===1?'bigint':[2,5].includes(index)?'integer':'text',nullable:true}));
test('schema inspection uses a read-only bounded transaction and emits no connection or definition', async () => {
  const calls=[];
  const client={query:(statement)=>{calls.push(statement);return {statement};},transaction:async (_queries,options)=>{assert.equal(options.readOnly,true);assert.ok(options.fetchOptions.signal instanceof AbortSignal);return [[{columns,identity_constraint:{validated:true,definition:'controlled-check-definition'}}]];}};
  const result=await inspectControllerReceiptSchema({connectionUrl:url,client});
  assert.equal(result.expectedColumnsPresent,true);
  assert.equal(result.constraintValidated,true);
  assert.match(result.targetFingerprint,/^[a-f0-9]{64}$/);
  assert.ok(!JSON.stringify(result).includes('fixture'));
  assert.ok(!JSON.stringify(result).includes('controlled-check-definition'));
  assert.ok(calls[0].startsWith('SELECT'));
});
test('missing attribution is reported as uninstalled, not successful migration', async () => {
  const client={query:()=>({}),transaction:async()=>[[{columns:null,identity_constraint:null}]]};
  const result=await inspectControllerReceiptSchema({connectionUrl:url,client});
  assert.equal(result.expectedColumnsPresent,false);
  assert.equal(result.constraintValidated,false);
});
test('unknown target and malformed response fail closed', async () => {
  await assert.rejects(inspectControllerReceiptSchema({connectionUrl:'postgresql://fixture:fixture@unapproved.invalid/db',client:{}}),/approved Neon/);
  await assert.rejects(inspectControllerReceiptSchema({connectionUrl:url,client:{query:()=>({}),transaction:async()=>[]}}),/schema response/);
});

test('schema inspection rejects non-owner, wrong origin, automatic events and absent opt-in', () => {
  const allowed={GITHUB_ACTIONS:'true',GITHUB_EVENT_NAME:'workflow_dispatch',GITHUB_ACTOR_ID:'14937399',GITHUB_REPOSITORY_ID:'1358455028',AGENTIC_RECEIPT_SCHEMA_INSPECTION:'true'};
  authorizeSchemaInspection(allowed);
  for (const mutation of [{GITHUB_ACTIONS:'false'},{GITHUB_EVENT_NAME:'pull_request'},{GITHUB_ACTOR_ID:'123'},{GITHUB_REPOSITORY_ID:'999'},{AGENTIC_RECEIPT_SCHEMA_INSPECTION:'false'}]) assert.throws(()=>authorizeSchemaInspection({...allowed,...mutation}),/operator-only/);
});
test('credential-bearing database failures are withheld', async () => {
  const client={query:()=>({}),transaction:async()=>{throw new Error(url);}};
  await assert.rejects(inspectControllerReceiptSchema({connectionUrl:url,client}),error=>!error.message.includes('fixture') && /withheld/.test(error.message));
});
