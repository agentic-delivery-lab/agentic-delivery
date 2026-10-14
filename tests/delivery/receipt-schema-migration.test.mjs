import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHash } from 'node:crypto';
import { readFile, mkdtemp, writeFile, rm, mkdir } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import os from 'node:os';
import path from 'node:path';
import { parseRepositoryYaml } from '../../scripts/lib/yaml.mjs';
import { prepareReceiptSchemaMigration, authorizeSchemaMigration, migrateReceiptSchema, RECEIPT_CONSTRAINT_SHA256 } from '../../scripts/migrate-controller-receipt-schema.mjs';
const url = 'postgresql://fixture:fixture@fixture-pooler.neon.tech/fixture';
const fingerprint = createHash('sha256').update('fixture.neon.tech|/fixture').digest('hex');
const env = {GITHUB_ACTIONS:'true',GITHUB_EVENT_NAME:'workflow_dispatch',GITHUB_ACTOR_ID:'14937399',GITHUB_REPOSITORY_ID:'1358455028',GITHUB_SHA:'a'.repeat(40),GITHUB_RUN_ID:'123',GITHUB_RUN_ATTEMPT:'1',AGENTIC_RECEIPT_SCHEMA_MIGRATION:'apply-0008'};
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

test('operator migration executes one bounded transaction then independent schema readback', async () => {
  const statements=[];let committed=false;let calls=0;
  const result=await migrateReceiptSchema({env,connectionUrl:url,inspectedTargetFingerprint:fingerprint,
    clientFactory:direct=>{assert.equal(new URL(direct).hostname,'fixture.neon.tech');return {
      query:statement=>{statements.push(statement);return statement;},
      transaction:async(queries,options)=>{calls++;assert.equal(options.readOnly,false);assert.ok(options.fetchOptions.signal instanceof AbortSignal);committed=true;return queries.map(()=>[]);},
    };},
    inspect:async()=>{assert.equal(committed,true);return {targetFingerprint:fingerprint,expectedColumnsPresent:true,constraintPresent:true,constraintValidated:true,constraintDefinitionSha256:RECEIPT_CONSTRAINT_SHA256};},
  });
  assert.equal(calls,1);assert.equal(statements.length,6);assert.equal(result.workflowRunId,'123');
  assert.equal(result.constraintDefinitionSha256,RECEIPT_CONSTRAINT_SHA256);
  assert.ok(!JSON.stringify(result).includes('fixture'));
});
test('denied authorization and changed target never construct a database client', async () => {
  const clientFactory=()=>{throw new Error('must not construct');};
  await assert.rejects(migrateReceiptSchema({env:{...env,GITHUB_ACTOR_ID:'1'},connectionUrl:url,clientFactory}),/operator/);
  await assert.rejects(migrateReceiptSchema({env,connectionUrl:url,clientFactory}),/target/);
});
test('uncertain commit and wrong semantic readback hold without retry or credential diagnostics', async () => {
  for (const failure of ['commit','readback']) {
    let calls=0;
    await assert.rejects(migrateReceiptSchema({env,connectionUrl:url,inspectedTargetFingerprint:fingerprint,
      clientFactory:()=>({query:statement=>statement,transaction:async queries=>{calls++;if(failure==='commit')throw new Error(url);return queries.map(()=>[]);}}),
      inspect:async()=>({targetFingerprint:fingerprint,expectedColumnsPresent:true,constraintPresent:true,constraintValidated:true,constraintDefinitionSha256:'0'.repeat(64)}),
    }),error=>/reconciliation/.test(error.message) && !error.message.includes('fixture'));
    assert.equal(calls,1);
  }
});

test('migration workflow is an exclusive operator mode with secret confined to fixed command', async () => {
  const workflow = parseRepositoryYaml(await readFile(new URL('../../.github/workflows/delivery-quality.yml',import.meta.url),'utf8'));
  const job = workflow.jobs['migrate-receipt-schema'];
  assert.ok(job);
  assert.match(job.if,/workflow_dispatch/);assert.match(job.if,/14937399/);assert.match(job.if,/1358455028/);
  assert.match(job.if,/!inputs.inspect_receipt_schema/);
  assert.equal(job['runs-on'],'ubuntu-latest');assert.equal(job['timeout-minutes'],2);
  assert.deepEqual(job.permissions,{contents:'read'});
  assert.equal(job.steps[0].with.ref,'${{ github.sha }}');
  assert.equal(job.steps[0].with['persist-credentials'],false);
  assert.equal(job.steps.at(-1).run,'node scripts/migrate-controller-receipt-schema.mjs');
  assert.equal(job.steps.at(-1).env.AGENTIC_RECEIPT_SCHEMA_MIGRATION,'apply-0008');
  for (const step of job.steps.slice(0,-1)) assert.ok(!step.env);
  for (const name of ['quality','portability','recovery-sql']) assert.match(workflow.jobs[name].if,/!inputs.migrate_receipt_schema/);
  assert.match(workflow.jobs['inspect-receipt-schema'].if,/!inputs.migrate_receipt_schema/);
});

test('Git CRLF checkout preserves exact pinned migration bytes', async t => {
  const root=new URL('../../',import.meta.url);
  const attributes=await readFile(new URL('api/github/migrations/.gitattributes',root),'utf8');
  const migration=await readFile(new URL('api/github/migrations/0008-controller-receipt-attribution.sql',root),'utf8');
  const fixture=await mkdtemp(path.join(os.tmpdir(),'adl-w06-line-ending-'));
  t.after(()=>rm(fixture,{recursive:true,force:true}));
  const hooks=path.join(fixture,'empty-hooks');await mkdir(hooks);
  const run=promisify(execFile);
  const git=(...args)=>run('git',['-c','core.autocrlf=true','-c',`core.hooksPath=${hooks}`,'-c','commit.gpgsign=false','-c','user.name=fixture','-c','user.email=fixture@invalid',...args],{cwd:fixture});
  const name='0008-controller-receipt-attribution.sql';
  await git('init','-b','main');
  await writeFile(path.join(fixture,'.gitattributes'),attributes);
  await writeFile(path.join(fixture,name),migration);
  await git('add','.gitattributes',name);await git('commit','-m','fixture');
  await rm(path.join(fixture,name));await git('checkout','--',name);
  assert.equal(createHash('sha256').update(await readFile(path.join(fixture,name))).digest('hex'),'9542a6069511463ee60894967e29a859a22f30978c99f8723f31b78e72afcc5a');
});
