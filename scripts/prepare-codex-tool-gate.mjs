// agentic-primitive: {"id":"codex-operation-tool-gate-source-preparation","kind":"validator","enforcement":"deterministic","adrs":["ADR-0009","ADR-0018"],"domains":["agentic-delivery-control-plane","agentic-delivery-governance"]}
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { lstat, readFile, realpath, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execute = promisify(execFile);
const controllerRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sourceDirectory = path.join(controllerRoot,'runtime/codex');
const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const targets = ['codex-rs/core/src/lib.rs','codex-rs/cli/src/main.rs','codex-rs/core/src/tools/registry.rs'];

export function rewritePinnedSource(contents, record) {
  if (!/^[0-9a-f]{64}$/.test(record.sha256) || sha256(contents) !== record.sha256) throw new Error('Pinned source digest does not match.');
  if (typeof record.marker !== 'string' || !record.marker || contents.split(record.marker).length !== 2 || typeof record.replacement !== 'string') throw new Error('Pinned source anchor must occur exactly once.');
  return contents.replace(record.marker,()=>record.replacement);
}

export async function prepareCodexToolGate(sourceRoot) {
  const root = await realpath(path.resolve(sourceRoot));
  const reference = JSON.parse(await readFile(path.join(sourceDirectory,'source-admission.json'),'utf8'));
  if (reference.schemaVersion !== 1 || reference.status !== 'proposed' || reference.sourceRepository !== 'openai/codex'
    || reference.sourceCommit !== '01fc69f4026735edfdf6789820549727a4867b11'
    || reference.version !== '0.159.3' || reference.rustToolchain !== '1.95.0'
    || !Array.isArray(reference.files) || reference.files.length !== targets.length
    || !targets.every((target,index)=>reference.files[index]?.path === target)) throw new Error('Unsupported native tool gate source admission.');
  const git = async (...args) => (await execute('git',['-C',root,...args],{env:{...process.env,GIT_NO_REPLACE_OBJECTS:'1'},maxBuffer:1024*1024})).stdout.trim();
  if (await git('rev-parse','HEAD') !== reference.sourceCommit || await git('status','--porcelain','--untracked-files=normal')) throw new Error('Native gate preparation requires the exact clean pinned checkout.');
  const updates = [];
  for (const record of reference.files) {
    const file = path.join(root,record.path);
    const info = await lstat(file);
    if (!info.isFile() || info.isSymbolicLink()) throw new Error('Pinned source must be an ordinary file.');
    const input = await readFile(file,'utf8');
    updates.push({file,relative:record.path,input,output:rewritePinnedSource(input,record)});
  }
  const modulePath = 'codex-rs/core/src/operation_tool_gate.rs';
  try { await lstat(path.join(root,modulePath)); throw new Error('Native gate target already exists; preserve it.'); }
  catch(error) { if (error.code !== 'ENOENT') throw error; }
  const module = await readFile(path.join(sourceDirectory,'operation_tool_gate.rs'),'utf8');
  // Preflight all source identities before modifying the isolated build checkout.
  for (const update of updates) await writeFile(update.file,update.output);
  await writeFile(path.join(root,modulePath),module,{flag:'wx'});
  return {schemaVersion:1,status:'prepared-not-admitted',sourceCommit:reference.sourceCommit,
    files:[...updates.map(({relative,input,output})=>({path:relative,inputSha256:sha256(input),outputSha256:sha256(output)})),
      {path:modulePath,outputSha256:sha256(module)}]};
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length !== 3) { console.error('Usage: prepare-codex-tool-gate.mjs <isolated-pinned-source-root>'); process.exitCode=2; }
  else try { console.log(JSON.stringify(await prepareCodexToolGate(process.argv[2]),null,2)); }
  catch(error) { console.error(error.message);process.exitCode=1; }
}
