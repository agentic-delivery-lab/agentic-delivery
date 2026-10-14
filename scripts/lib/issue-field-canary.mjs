// agentic-primitive: {"id":"operator-issue-field-canary","kind":"script","enforcement":"deterministic","adrs":["ADR-0012","ADR-0018","ADR-0019"],"domains":["agentic-delivery-governance","agentic-delivery-control-plane"]}
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
const manifest=JSON.parse(readFileSync(new URL('../../config/operator-field-canaries.json',import.meta.url),'utf8'));
if(manifest.schemaVersion!==1 || !Array.isArray(manifest.targets) || manifest.targets.length!==2 || !Array.isArray(manifest.fields) || manifest.fields.length!==2)throw new Error('Unsupported operator canary manifest.');
export const FIELD_CANARY_TARGETS=Object.freeze(manifest.targets.map(Object.freeze));
export const FIELD_CANARY_FIELDS=Object.freeze(manifest.fields.map(Object.freeze));
export function compileCanaryFields(bindings) {
  return FIELD_CANARY_FIELDS.map(definition=>{
    const binding=bindings?.fields?.[definition.key];const optionId=binding?.options?.[definition.option];
    if(typeof binding?.id!=='string'||!binding.id||typeof optionId!=='string'||!optionId)throw new Error('Missing private canary bindings.');
    return Object.freeze({fieldId:binding.id,name:definition.name,singleSelectOptionId:optionId,optionName:definition.optionName});
  });
}
const keys=['repository','repositoryId','issueNumber','issueId'];
const equal=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
function snapshot(value,target,definitions) {
  if (!value || keys.some(k=>value[k]!==target[k])) throw new Error('Canary repository or issue identity changed.');
  for (const expected of definitions) {
    const matches=value.fieldDefinitions?.filter(f=>f.id===expected.fieldId) ?? [];
    if(matches.length!==1 || matches[0].name!==expected.name || matches[0].dataType!=='SINGLE_SELECT'
      || !matches[0].options?.some(o=>o.id===expected.singleSelectOptionId && o.name===expected.optionName)) throw new Error('Canary field or option binding changed.');
  }
  if(!Array.isArray(value.fieldValues))throw new Error('Missing canary field values.');
  const fields=value.fieldValues.map(v=>({fieldId:v.fieldId,optionId:v.optionId})).sort((a,b)=>String(a.fieldId).localeCompare(String(b.fieldId),'en'));
  if(fields.some(v=>typeof v.fieldId!=='string' || !v.fieldId || typeof v.optionId!=='string' || !v.optionId)
    || new Set(fields.map(v=>v.fieldId)).size!==fields.length)throw new Error('Unsupported or duplicate canary field values.');
  return fields;
}
function selected(values,fields) {return values.filter(v=>fields.some(f=>f.fieldId===v.fieldId));}
export async function runIssueFieldCanary({target,read,write,saveEvidence,actorId,bindings,apply=false}={}) {
  if(typeof apply!=='boolean')throw new Error('Canary apply must be boolean.');
  if(!FIELD_CANARY_TARGETS.some(t=>keys.every(k=>t[k]===target?.[k])))throw new Error('Unknown canary target.');
  if(apply && actorId!=='14937399')throw new Error('Canary mutation requires the delegated interactive operator.');
  if(typeof read!=='function' || typeof saveEvidence!=='function' || (apply && typeof write!=='function'))throw new Error('Missing canary adapter.');
  const fields=compileCanaryFields(bindings);
  const initial=await read();const original=snapshot(initial,target,fields);
  for(const prior of selected(original,fields)) {
    if(!initial.fieldDefinitions.find(f=>f.id===prior.fieldId).options.some(o=>o.id===prior.optionId))throw new Error('Original canary field option cannot be restored.');
  }
  await saveEvidence({phase:'prepared',target,actorId,originalValues:original,originalHash:hash(original),apply});
  if(!apply)return {mutationsRequested:false,originalHash:hash(original)};
  if(fields.some(f=>original.some(v=>v.fieldId===f.fieldId && v.optionId===f.singleSelectOptionId)))throw new Error('Each canary field must start with a different value to prove the test write.');
  if(!equal(snapshot(await read(),target,fields),original))throw new Error('Canary changed before mutation; no write requested.');
  const testValues=fields.map(f=>({fieldId:f.fieldId,optionId:f.singleSelectOptionId})).sort((a,b)=>a.fieldId.localeCompare(b.fieldId,'en'));
  let testError;
  try {
    await write(fields.map(f=>({fieldId:f.fieldId,singleSelectOptionId:f.singleSelectOptionId})));
    const written=snapshot(await read(),target,fields);
    if(!equal(selected(written,fields),testValues))throw new Error('Canary write readback differs.');
    await saveEvidence({phase:'write-verified',target,writtenHash:hash(written)});
  } catch(error) {testError=error;}
  // A rejected/lost response does not prove that the write was absent.
  // Re-read even after a failed write, and never overwrite a third-party value.
  let restored;
  let auditError=false;
  try {
    const currentRead=await read();
    const current=snapshot(currentRead,target,fields);
    for(const prior of selected(original,fields)) {
      if(!currentRead.fieldDefinitions.find(f=>f.id===prior.fieldId).options.some(o=>o.id===prior.optionId))throw new Error('Original option is no longer available.');
    }
    for(const field of fields) {
      const value=current.find(v=>v.fieldId===field.fieldId)?.optionId ?? null;
      const prior=original.find(v=>v.fieldId===field.fieldId)?.optionId ?? null;
      if(value!==prior && value!==field.singleSelectOptionId)throw new Error('Concurrent selected-field change.');
    }
    if(!equal(selected(current,fields),selected(original,fields))) {
      const restore=fields.map(f=>{
        const prior=original.find(v=>v.fieldId===f.fieldId);
        return prior ? {fieldId:f.fieldId,singleSelectOptionId:prior.optionId} : {fieldId:f.fieldId,delete:true};
      });
      try {await saveEvidence({phase:'restore-intent',target,restore});} catch {auditError=true;}
      // The original snapshot was saved before mutation. An audit outage
      // cannot prevent compensation after identity and value checks pass.
      try {await write(restore);} catch {
        // Do not repeat an uncertain restore. Fresh readback decides its state.
      }
    }
    restored=snapshot(await read(),target,fields);
    if(!equal(restored,original))throw new Error('Original complete field state differs.');
    try {await saveEvidence({phase:'restored',target,restoredHash:hash(restored),testSucceeded:!testError});} catch {auditError=true;}
  } catch {
    try {await saveEvidence({phase:'restoration-held',target});} catch { /* Preserve the already-saved original snapshot. */ }
    throw new Error('Canary restoration held; preserve the snapshot and inspect current state without retry.');
  }
  if(testError || auditError)throw new Error('Canary test failed; original values independently restored.');
  return {mutationsRequested:true,restored:true,originalHash:hash(original),restoredHash:hash(restored)};
}
