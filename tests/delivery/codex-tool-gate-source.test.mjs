import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { rewritePinnedSource, rewritePinnedLockfile } from '../../scripts/prepare-codex-tool-gate.mjs';

const hash = (value) => createHash('sha256').update(value).digest('hex');
test('source preparation rejects a different source before inserting a native gate', () => {
  const record = {sha256:hash('before marker after'),marker:'marker',replacement:'gate marker'};
  assert.equal(rewritePinnedSource('before marker after',record),'before gate marker after');
  assert.throws(()=>rewritePinnedSource('tampered marker after',record),/digest/);
});
test('source preparation refuses missing or ambiguous dispatch anchors even with a matching digest', () => {
  for(const text of ['before after','marker marker']) {
    assert.throws(()=>rewritePinnedSource(text,{sha256:hash(text),marker:'marker',replacement:'gate'}),/exactly once/);
  }
});

test('source preparation preserves a different checkout and its untracked files', async(t)=>{
  const {mkdtemp,writeFile,readFile,rm}=await import('node:fs/promises');
  const {tmpdir}=await import('node:os');const path=await import('node:path');
  const {execFile}=await import('node:child_process');const {promisify}=await import('node:util');
  const {prepareCodexToolGate}=await import('../../scripts/prepare-codex-tool-gate.mjs');
  const root=await mkdtemp(path.join(tmpdir(),'adl-gate-source-test-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const git=(...args)=>promisify(execFile)('git',['-C',root,...args]);
  await git('init','--initial-branch=main');await git('config','core.hooksPath','/dev/null');
  await writeFile(path.join(root,'README.md'),'fixture');await git('add','README.md');
  await git('-c','user.name=Fixture','-c','user.email=fixture@example.invalid','-c','commit.gpgsign=false','commit','-m','fixture');
  await writeFile(path.join(root,'preserve.txt'),'unrelated input');
  await assert.rejects(()=>prepareCodexToolGate(root),/exact clean pinned checkout/);
  assert.equal(await readFile(path.join(root,'preserve.txt'),'utf8'),'unrelated input');
});

test('bootstrap probe rejects a version-only binary without calling a model', {skip:process.platform!=='linux'}, async(t)=>{
  const {mkdtemp,writeFile,rm}=await import('node:fs/promises');const {tmpdir}=await import('node:os');const path=await import('node:path');
  const {probeCodexToolGate}=await import('../../scripts/probe-codex-tool-gate.mjs');
  const root=await mkdtemp(path.join(tmpdir(),'adl-gate-binary-test-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const binary=path.join(root,'version-only');await writeFile(binary,'#!/usr/bin/env node\nconsole.log("codex-cli fixture");\n',{mode:0o700});
  await assert.rejects(()=>probeCodexToolGate(binary),/did not fail closed/);
});

test('bootstrap transport requires readiness and rejects a missing inherited socket', {skip:process.platform!=='linux'}, async(t)=>{
  const {mkdtemp,writeFile,rm}=await import('node:fs/promises');const {tmpdir}=await import('node:os');const path=await import('node:path');
  const {probeCodexToolGate}=await import('../../scripts/probe-codex-tool-gate.mjs');
  const root=await mkdtemp(path.join(tmpdir(),'adl-gate-binary-test-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const binary=path.join(root,'framed-fixture');
  await writeFile(binary,'#!/usr/bin/env node\nconst fs=require("node:fs");if(!fs.fstatSync(3).isSocket())process.exit(1);fs.writeSync(3,JSON.stringify({version:1,type:"ready",sourceCommit:"01fc69f4026735edfdf6789820549727a4867b11"})+"\\n");console.log("codex-cli fixture");\n',{mode:0o700});
  const result=await probeCodexToolGate(binary);assert.equal(result.evidenceClass,'native-bootstrap-only');assert.deepEqual(result.checks.map(value=>[value.channel,value.exitCode,value.ready]),[['inherited',0,true],['absent',1,false]]);
});

test('pinned release lock correction preserves external versions and refuses unexpected bytes or results', () => {
  const input = 'version = "0.0.0"\nexternal = "1.2.3"\n';
  const output = 'version = "0.159.3"\nexternal = "1.2.3"\n';
  const record = {sha256:hash(input),outputSha256:hash(output),packageCount:1};
  assert.equal(rewritePinnedLockfile(input,record),output);
  assert.throws(() => rewritePinnedLockfile(input+'tampered',record),/digest/);
  assert.throws(() => rewritePinnedLockfile(input,{...record,packageCount:2}),/count/);
  assert.throws(() => rewritePinnedLockfile(input,{...record,outputSha256:hash(input)}),/output/);
});
