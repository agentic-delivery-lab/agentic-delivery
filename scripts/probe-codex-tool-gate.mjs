// agentic-primitive: {"id":"codex-operation-tool-gate-bootstrap-probe","kind":"validator","enforcement":"deterministic","adrs":["ADR-0009","ADR-0018"],"domains":["agentic-delivery-control-plane","agentic-delivery-governance"]}
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

async function probe(binary, privateHome, withChannel) {
  return new Promise((resolve,reject)=>{
    const child=spawn(binary,['--version'],{detached:true,env:{PATH:process.env.PATH,HOME:privateHome,TMPDIR:privateHome,CODEX_DELIVERY_TOOL_GATE_FD:'3'},stdio:['ignore','pipe','pipe',withChannel?'pipe':'ignore']});
    let output='',buffer='',ready=false,failure,stderrBytes=0;
    const stop=()=>{try{process.kill(-child.pid,'SIGKILL');}catch(error){if(error.code!=='ESRCH')failure=new Error('Probe shutdown is unconfirmed.');}};
    const timer=setTimeout(()=>{failure=new Error('Native gate bootstrap timed out.');stop();},10000);
    child.on('error',()=>{failure=new Error('Native gate binary could not start.');});
    child.stdout.on('data',chunk=>{output+=chunk;if(output.length>4096){failure=new Error('Probe output exceeds its bound.');stop();}});
    child.stderr.on('data',chunk=>{stderrBytes+=chunk.length;if(stderrBytes>4096){failure=new Error('Probe diagnostics exceed their bound.');stop();}});
    child.stdio[3]?.on('data',chunk=>{
      buffer+=chunk;
      if(buffer.length>4096){failure=new Error('Native gate frame exceeds its bound.');stop();return;}
      if(buffer.includes('\n')){
        try{
          const value=JSON.parse(buffer);
          if(ready||Object.keys(value).sort().join(',')!=='sourceCommit,type,version'||value.version!==1||value.type!=='ready'||value.sourceCommit!=='01fc69f4026735edfdf6789820549727a4867b11')throw new Error();
          ready=true;buffer='';
        }catch{failure=new Error('Native gate bootstrap response is invalid.');stop();}
      }
    });
    child.on('close',code=>{
      clearTimeout(timer);
      if(failure)return reject(failure);
      if(withChannel?code!==0||!ready||buffer.length!==0||!output.startsWith('codex-cli '):code===0||ready)return reject(new Error('Native gate bootstrap did not fail closed as required.'));
      resolve({channel:withChannel?'inherited':'absent',exitCode:code,ready,version:withChannel?output.trim():null});
    });
  });
}

export async function probeCodexToolGate(binary) {
  if(process.platform!=='linux')throw new Error('Native gate admission probe currently supports Linux only.');
  const privateHome=await mkdtemp(path.join(os.tmpdir(),'adl-native-gate-probe-'));
  try{
    return {schemaVersion:1,evidenceClass:'native-bootstrap-only',checks:[await probe(path.resolve(binary),privateHome,true),await probe(path.resolve(binary),privateHome,false)]};
  }finally{await rm(privateHome,{recursive:true,force:true});}
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  if(process.argv.length!==3){console.error('Usage: probe-codex-tool-gate.mjs <candidate-binary>');process.exitCode=2;}
  else try{console.log(JSON.stringify(await probeCodexToolGate(process.argv[2]),null,2));}catch(error){console.error(error.message);process.exitCode=1;}
}
