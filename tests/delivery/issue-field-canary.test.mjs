import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';
import {parseCanaryArguments} from '../../scripts/run-issue-field-canary.mjs';
import {runIssueFieldCanary, FIELD_CANARY_TARGETS, compileCanaryFields} from '../../scripts/lib/issue-field-canary.mjs';
const target=FIELD_CANARY_TARGETS[0];
const bindings={fields:{lifecycle_stage:{id:'fixture-stage',options:{intake:'fixture-intake'}},readiness:{id:'fixture-readiness',options:{'not-ready':'fixture-not-ready'}}}};
const writes=compileCanaryFields(bindings);
function fixture(original=[],identity=target) {
 let fields=structuredClone(original);const calls=[],events=[];
 const read=async()=>({...identity,fieldValues:structuredClone(fields),fieldDefinitions:writes.map(f=>({id:f.fieldId,name:f.name,dataType:'SINGLE_SELECT',options:[{id:f.singleSelectOptionId,name:f.optionName},...original.filter(v=>v.fieldId===f.fieldId && v.optionId!==f.singleSelectOptionId).map(v=>({id:v.optionId,name:'Prior option'}))]}))});
 const write=async inputs=>{calls.push(structuredClone(inputs));for(const f of inputs){fields=fields.filter(v=>v.fieldId!==f.fieldId);if(!f.delete)fields.push({fieldId:f.fieldId,optionId:f.singleSelectOptionId});}};
 return {bindings,read,write,saveEvidence:async e=>events.push(structuredClone(e)),calls,events,setFields:v=>{fields=v;}};
}
test('operator canary restores absent fields using explicit deletion and independent readback',async()=>{
 const io=fixture();const result=await runIssueFieldCanary({...io,target,actorId:'14937399',apply:true});
 assert.equal(result.restored,true);assert.equal(io.calls.length,2);
 assert.ok(io.calls[1].every(f=>f.delete===true && !Object.hasOwn(f,'singleSelectOptionId')));
 assert.deepEqual((await io.read()).fieldValues,[]);assert.equal(io.events[0].phase,'prepared');
});
test('operator preview never writes',async()=>{
 const io=fixture();const result=await runIssueFieldCanary({...io,target,actorId:'14937399'});
 assert.equal(result.mutationsRequested,false);assert.equal(io.calls.length,0);
});
test('unknown actor and field identity are rejected before mutation',async()=>{
 const io=fixture();await assert.rejects(runIssueFieldCanary({...io,target,actorId:'1',apply:true}),/operator/);
 const read=async()=>({...await io.read(),fieldDefinitions:[]});
 await assert.rejects(runIssueFieldCanary({...io,read,target,actorId:'14937399',apply:true}),/field/);
 assert.equal(io.calls.length,0);
});
test('uncertain write is reconciled and restored without repeating the test write',async()=>{
 const io=fixture();let first=true;
 const write=async input=>{await io.write(input);if(first){first=false;throw new Error('uncertain response');}};
 await assert.rejects(runIssueFieldCanary({...io,write,target,actorId:'14937399',apply:true}),/restored/);
 assert.equal(io.calls.length,2);assert.deepEqual((await io.read()).fieldValues,[]);
});
test('concurrent selected-field changes are preserved and restoration holds',async()=>{
 const io=fixture();const write=async input=>{await io.write(input);io.setFields([{fieldId:writes[0].fieldId,optionId:'other-human-option'}]);};
 await assert.rejects(runIssueFieldCanary({...io,write,target,actorId:'14937399',apply:true}),/restoration/);
 assert.equal(io.calls.length,1);assert.equal((await io.read()).fieldValues[0].optionId,'other-human-option');
});
test('existing field options are restored by exact option identity',async()=>{
 const original=writes.map((f,i)=>({fieldId:f.fieldId,optionId:`prior-option-${i}`}));
 const io=fixture(original);const result=await runIssueFieldCanary({...io,target,actorId:'14937399',apply:true});
 assert.equal(result.restored,true);assert.deepEqual((await io.read()).fieldValues,original);
});

test('lost restoration response is independently reconciled without a second restore',async()=>{
 const io=fixture();let calls=0;
 const write=async input=>{await io.write(input);if(++calls===2)throw new Error('lost restore response');};
 const result=await runIssueFieldCanary({...io,write,target,actorId:'14937399',apply:true});
 assert.equal(result.restored,true);assert.equal(io.calls.length,2);assert.deepEqual((await io.read()).fieldValues,[]);
});
test('nonboolean apply is rejected without reading or writing',async()=>{
 const io=fixture();await assert.rejects(runIssueFieldCanary({...io,target,actorId:'14937399',apply:'false'}),/boolean/);
 assert.equal(io.calls.length,0);assert.equal(io.events.length,0);
});

test('a different original option is restored rather than a default',async()=>{
 const original=[{fieldId:writes[0].fieldId,optionId:'prior-option'}];
 const io=fixture(original);const result=await runIssueFieldCanary({...io,target,actorId:'14937399',apply:true});
 assert.equal(result.restored,true);assert.equal(io.calls[1][0].singleSelectOptionId,'prior-option');
 assert.equal(io.calls[1][1].delete,true);assert.deepEqual((await io.read()).fieldValues,original);
});

test('canary CLI fixes targets and rejects ambiguous or invalid approval arguments',()=>{
 assert.deepEqual(parseCanaryArguments(['--evidence-dir','private','--bindings-file','pins']),{apply:false,evidenceDir:'private',bindingsFile:'pins'});
 assert.equal(parseCanaryArguments(['--apply','--evidence-dir','private','--bindings-file','pins','--bindings-sha256','b'.repeat(64),'--approved-commit','a'.repeat(40)]).apply,true);
 for(const args of [[],['--target','other'],['--apply','--evidence-dir','private'],['--evidence-dir','private','--apply','--apply'],['--evidence-dir','private','--approved-commit','invalid']]) assert.throws(()=>parseCanaryArguments(args));
});

test('audit storage failure after mutation still restores the saved original values',async()=>{
 const io=fixture();let saves=0;
 const saveEvidence=async event=>{if(++saves>1)throw new Error('audit storage unavailable');await io.saveEvidence(event);};
 await assert.rejects(runIssueFieldCanary({...io,saveEvidence,target,actorId:'14937399',apply:true}),/restored/);
 assert.equal(io.calls.length,2);assert.deepEqual((await io.read()).fieldValues,[]);
});

test('public canary manifest contains only logical field references',async()=>{
 const text=await readFile(new URL('../../config/operator-field-canaries.json',import.meta.url),'utf8');
 assert.ok(!/IFSS(?:O)?_kg/.test(text));
 assert.throws(()=>compileCanaryFields(undefined),/private canary bindings/);
});
test('second repository identity uses the same safe restoration contract',async()=>{
 const second=FIELD_CANARY_TARGETS[1];const io=fixture([],second);
 const result=await runIssueFieldCanary({...io,target:second,actorId:'14937399',apply:true});
 assert.equal(result.restored,true);assert.equal(io.calls.length,2);assert.deepEqual((await io.read()).fieldValues,[]);
});

test('apply rejects a canary when either field already holds its test option',async()=>{
 for(const original of [writes.map(f=>({fieldId:f.fieldId,optionId:f.singleSelectOptionId})),[{fieldId:writes[0].fieldId,optionId:writes[0].singleSelectOptionId}],[{fieldId:writes[1].fieldId,optionId:writes[1].singleSelectOptionId}]]) {
  const io=fixture(original);
  await assert.rejects(runIssueFieldCanary({...io,target,actorId:'14937399',apply:true}),/different/);
  assert.equal(io.calls.length,0);assert.deepEqual((await io.read()).fieldValues,original);
 }
});

test('canary uses the existing nested private binding contract and rejects flat input',()=>{
 assert.equal(compileCanaryFields(bindings).length,2);
 assert.throws(()=>compileCanaryFields(bindings.fields),/private canary bindings/);
});

test('partial test writes restore only changed fields and preserve an intervening untouched-field change',async()=>{
 for(const concurrent of [false,true]) {
  const io=fixture();const requests=[];let ordinal=0;
  const write=async inputs=>{
   requests.push(structuredClone(inputs));
   if(++ordinal===1){await io.write(inputs.slice(0,1));throw new Error('partial uncertain write');}
   if(concurrent)io.setFields([...(await io.read()).fieldValues,{fieldId:writes[1].fieldId,optionId:'human-option'}]);
   await io.write(inputs);
  };
  await assert.rejects(runIssueFieldCanary({...io,write,target,actorId:'14937399',apply:true}),concurrent?/restoration held/:/independently restored/);
  assert.equal(requests.length,2);assert.deepEqual(requests[1],[{fieldId:writes[0].fieldId,delete:true}]);
  assert.deepEqual((await io.read()).fieldValues,concurrent?[{fieldId:writes[1].fieldId,optionId:'human-option'}]:[]);
 }
});

test('falsy write rejections cannot become successful canary receipts',async()=>{
 for(const rejection of [undefined,null,false,0,'']) {
  const io=fixture();let first=true;
  const write=async inputs=>{await io.write(inputs);if(first){first=false;throw rejection;}};
  await assert.rejects(runIssueFieldCanary({...io,write,target,actorId:'14937399',apply:true}),/independently restored/);
  assert.equal(io.calls.length,2);assert.deepEqual((await io.read()).fieldValues,[]);
  assert.equal(io.events.find(e=>e.phase==='restored').testSucceeded,false);
 }
});

test('existing-option probe clears and restores the approved values before restoring original absence',async()=>{
 const io=fixture();
 const result=await runIssueFieldCanary({...io,target,actorId:'14937399',apply:true,verifyExistingOptions:true});
 assert.equal(result.existingOptionsRestored,true);
 assert.equal(io.calls.length,4);
 assert.ok(io.calls[1].every(f=>f.delete===true));
 assert.deepEqual(io.calls[2],io.calls[0]);
 assert.deepEqual((await io.read()).fieldValues,[]);
 assert.deepEqual(io.events.filter(e=>e.phase.startsWith('existing-options')).map(e=>e.phase),
  ['existing-options-prepared','existing-options-cleared','existing-options-restore-intent','existing-options-restored']);
 const prepared=io.events.find(e=>e.phase==='existing-options-prepared');
 const restored=io.events.find(e=>e.phase==='existing-options-restored');
 assert.equal(restored.restoredHash,prepared.originalHash);
 assert.equal(prepared.originalValues.length,2);
});

test('existing-option probe remains non-mutating in preview and rejects nonboolean input',async()=>{
 const io=fixture();
 await runIssueFieldCanary({...io,target,actorId:'14937399',verifyExistingOptions:true});
 assert.equal(io.calls.length,0);
 await assert.rejects(runIssueFieldCanary({...io,target,actorId:'14937399',apply:true,verifyExistingOptions:'false'}),/boolean/);
 assert.equal(io.calls.length,0);
});

test('canary CLI explicitly selects the existing-option probe without changing its targets',()=>{
 assert.equal(parseCanaryArguments(['--verify-existing-options','--evidence-dir','private','--bindings-file','pins']).verifyExistingOptions,true);
});

test('existing-option probe restores arbitrary prior options after clearing its approved values',async()=>{
 const original=writes.map((f,i)=>({fieldId:f.fieldId,optionId:`prior-${i}`}));
 const io=fixture(original);
 const result=await runIssueFieldCanary({...io,target,actorId:'14937399',apply:true,verifyExistingOptions:true});
 assert.equal(result.existingOptionsRestored,true);
 assert.deepEqual((await io.read()).fieldValues,original);
 assert.ok(io.calls[3].every(f=>f.singleSelectOptionId.startsWith('prior-')));
});

test('uncertain probe clear restores original values without repeating the clear',async()=>{
 for(const original of [[],writes.map((f,i)=>({fieldId:f.fieldId,optionId:`prior-${i}`}))]) {
  const io=fixture(original);let count=0;
  const write=async inputs=>{await io.write(inputs);if(++count===2)throw new Error('lost clear response');};
  await assert.rejects(runIssueFieldCanary({...io,write,target,actorId:'14937399',apply:true,verifyExistingOptions:true}),/independently restored/);
  assert.equal(io.calls.length,original.length?3:2);
  assert.deepEqual((await io.read()).fieldValues,original);
  assert.equal(io.events.some(e=>e.phase==='existing-options-restored'),false);
 }
});

test('lost probe restoration response is read before outer compensation and never retried',async()=>{
 const io=fixture();let count=0;
 const write=async inputs=>{await io.write(inputs);if(++count===3)throw new Error('lost option restoration response');};
 await assert.rejects(runIssueFieldCanary({...io,write,target,actorId:'14937399',apply:true,verifyExistingOptions:true}),/independently restored/);
 assert.equal(io.calls.length,4);
 assert.equal(io.calls.filter(call=>call.every(f=>!f.delete)).length,2);
 assert.deepEqual((await io.read()).fieldValues,[]);
});

test('probe preserves a third-party selected value after its clear and holds all later writes',async()=>{
 const io=fixture();let count=0;
 const write=async inputs=>{await io.write(inputs);if(++count===2)io.setFields([{fieldId:writes[0].fieldId,optionId:'human-option'}]);};
 await assert.rejects(runIssueFieldCanary({...io,write,target,actorId:'14937399',apply:true,verifyExistingOptions:true}),/restoration held/);
 assert.equal(io.calls.length,2);
 assert.deepEqual((await io.read()).fieldValues,[{fieldId:writes[0].fieldId,optionId:'human-option'}]);
});

test('probe rechecks the complete vector immediately before restoring approved options',async()=>{
 const io=fixture();
 const saveEvidence=async event=>{
  await io.saveEvidence(event);
  if(event.phase==='existing-options-restore-intent')io.setFields([{fieldId:'other-field',optionId:'human-option'}]);
 };
 await assert.rejects(runIssueFieldCanary({...io,saveEvidence,target,actorId:'14937399',apply:true,verifyExistingOptions:true}),/restoration held/);
 assert.equal(io.calls.length,2);
 assert.deepEqual((await io.read()).fieldValues,[{fieldId:'other-field',optionId:'human-option'}]);
});

test('partial clear cannot produce a successful probe and restores the original vector',async()=>{
 const io=fixture();let count=0;
 const write=async inputs=>{await io.write(++count===2?inputs.slice(0,1):inputs);};
 await assert.rejects(runIssueFieldCanary({...io,write,target,actorId:'14937399',apply:true,verifyExistingOptions:true}),/independently restored/);
 assert.equal(io.calls.length,3);
 assert.deepEqual((await io.read()).fieldValues,[]);
 assert.equal(io.events.some(e=>e.phase==='existing-options-restored'),false);
});

test('probe audit failure after clearing still compensates the prior options',async()=>{
 const original=writes.map((f,i)=>({fieldId:f.fieldId,optionId:`prior-${i}`}));
 const io=fixture(original);
 const saveEvidence=async event=>{if(event.phase==='existing-options-cleared')throw new Error('audit unavailable');await io.saveEvidence(event);};
 await assert.rejects(runIssueFieldCanary({...io,saveEvidence,target,actorId:'14937399',apply:true,verifyExistingOptions:true}),/independently restored/);
 assert.equal(io.calls.length,3);
 assert.deepEqual((await io.read()).fieldValues,original);
});

test('both fixed repository identities can prove existing options and original absence',async()=>{
 for(const selectedTarget of FIELD_CANARY_TARGETS) {
  const io=fixture([],selectedTarget);
  const result=await runIssueFieldCanary({...io,target:selectedTarget,actorId:'14937399',apply:true,verifyExistingOptions:true});
  assert.equal(result.existingOptionsRestored,true);
  assert.equal(result.originalHash,result.restoredHash);
  assert.equal(io.calls.length,4);
 }
});
