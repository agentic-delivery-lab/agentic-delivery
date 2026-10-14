import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';
import {parseCanaryArguments} from '../../scripts/run-issue-field-canary.mjs';
import {runIssueFieldCanary, FIELD_CANARY_TARGETS, compileCanaryFields} from '../../scripts/lib/issue-field-canary.mjs';
const target=FIELD_CANARY_TARGETS[0];
const bindings={lifecycle_stage:{id:'fixture-stage',options:{intake:'fixture-intake'}},readiness:{id:'fixture-readiness',options:{'not-ready':'fixture-not-ready'}}};
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
test('shadow canary never writes',async()=>{
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
