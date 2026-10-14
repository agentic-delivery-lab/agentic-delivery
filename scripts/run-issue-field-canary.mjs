// agentic-primitive: {"id":"interactive-issue-field-canary-command","kind":"script","enforcement":"deterministic","adrs":["ADR-0012","ADR-0018","ADR-0019"],"domains":["agentic-delivery-governance","agentic-delivery-control-plane"]}
import {execFileSync} from 'node:child_process';
import {createHash,randomUUID} from 'node:crypto';
import {lstatSync,readFileSync,writeFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {FIELD_CANARY_TARGETS,runIssueFieldCanary} from './lib/issue-field-canary.mjs';
import {GITHUB_API_VERSION,SET_ISSUE_FIELDS_MUTATION} from './lib/issue-field-api.mjs';
const root=fileURLToPath(new URL('../',import.meta.url));
const query=`query Canary($owner:String!,$name:String!,$number:Int!,$organization:String!) {
 repository(owner:$owner,name:$name) { databaseId nameWithOwner issue(number:$number) { id number
  issueFieldValues(first:100) { pageInfo { hasNextPage } nodes {
   ... on IssueFieldSingleSelectValue { optionId field { ... on Node { id } } }
  } }
 } }
 organization(login:$organization) { issueFields(first:100) { pageInfo { hasNextPage } nodes {
  ... on Node { id } ... on IssueFieldCommon { name dataType }
  ... on IssueFieldSingleSelect { options { id name } }
 } } }
}`;
export function parseCanaryArguments(args) {
 const parsed={apply:false};const seen=new Set();
 for(let i=0;i<args.length;i++) {
  const flag=args[i];if(seen.has(flag))throw new Error('Duplicate canary argument.');seen.add(flag);
  if(flag==='--apply')parsed.apply=true;
  else if(['--evidence-dir','--approved-commit','--bindings-file','--bindings-sha256'].includes(flag)) {
   const value=args[++i];if(!value||value.startsWith('--'))throw new Error('Missing canary argument value.');
   parsed[{'--evidence-dir':'evidenceDir','--approved-commit':'approvedCommit','--bindings-file':'bindingsFile','--bindings-sha256':'bindingsSha256'}[flag]]=value;
  } else throw new Error('Unknown canary argument.');
 }
 if(parsed.approvedCommit!==undefined&&!/^[a-f0-9]{40}$/.test(parsed.approvedCommit))throw new Error('Invalid reviewed canary commit.');
 if(parsed.bindingsSha256!==undefined&&!/^[a-f0-9]{64}$/.test(parsed.bindingsSha256))throw new Error('Invalid private bindings digest.');
 if(!parsed.evidenceDir || !parsed.bindingsFile || (parsed.apply&&(!/^[a-f0-9]{40}$/.test(parsed.approvedCommit??'')||!/^[a-f0-9]{64}$/.test(parsed.bindingsSha256??''))))throw new Error('Canary evidence directory and reviewed apply commit are required.');
 return parsed;
}
function gh(args,input) {
 return JSON.parse(execFileSync('gh',['api','--hostname','github.com',...args],{input:input===undefined?undefined:JSON.stringify(input),encoding:'utf8',timeout:30_000,maxBuffer:1024*1024,stdio:['pipe','pipe','pipe']}));
}
function graphql(statement,variables) {
 const result=gh(['graphql','-H',`X-GitHub-Api-Version:${GITHUB_API_VERSION}`,'--input','-'],{query:statement,variables});
 if(result.errors?.length||!result.data)throw new Error('Canary GraphQL operation failed.');return result.data;
}
export async function runInteractiveCanaries(options) {
 const directory=path.resolve(options.evidenceDir);const info=lstatSync(directory);
 if(!info.isDirectory()||info.isSymbolicLink()||(info.mode&0o077)!==0||(process.getuid&&info.uid!==process.getuid()))throw new Error('Canary evidence directory must already be private.');
 const sourceCommit=execFileSync('git',['-C',root,'rev-parse','HEAD'],{encoding:'utf8'}).trim();
 if(options.apply) {
  if(process.env.GITHUB_ACTIONS==='true')throw new Error('Canary apply is interactive only.');
  if(sourceCommit!==options.approvedCommit || execFileSync('git',['-C',root,'status','--porcelain','--untracked-files=all'],{encoding:'utf8'}).trim())throw new Error('Canary apply requires the reviewed clean source commit.');
 }
 const bindingPath=path.resolve(options.bindingsFile);const bindingInfo=lstatSync(bindingPath);
 if(!bindingInfo.isFile()||bindingInfo.isSymbolicLink()||bindingInfo.size>65536||(bindingInfo.mode&0o077)!==0||(process.getuid&&bindingInfo.uid!==process.getuid()))throw new Error('Canary bindings must be a private owned file.');
 const bindingBytes=readFileSync(bindingPath);const bindingSha256=createHash('sha256').update(bindingBytes).digest('hex');
 if(options.apply&&bindingSha256!==options.bindingsSha256)throw new Error('Private canary bindings changed since review.');
 const bindings=JSON.parse(bindingBytes);
 const actor=gh(['user']);if(options.apply&&String(actor.id)!=='14937399')throw new Error('Canary apply requires the delegated operator.');
 const operationId=randomUUID();const results=[];let ordinal=0;
 for(const target of FIELD_CANARY_TARGETS) {
  const read=async()=>{
   const data=graphql(query,{owner:'agentic-delivery-lab',name:target.repository.split('/')[1],number:target.issueNumber,organization:'agentic-delivery-lab'});
   const repo=data.repository;const issue=repo?.issue;const fields=data.organization?.issueFields;
   if(!issue || issue.issueFieldValues?.pageInfo?.hasNextPage!==false || fields?.pageInfo?.hasNextPage!==false)throw new Error('Canary metadata is missing or truncated.');
   return {repository:repo.nameWithOwner,repositoryId:String(repo.databaseId),issueNumber:issue.number,issueId:issue.id,
    fieldDefinitions:fields.nodes,fieldValues:issue.issueFieldValues.nodes.map(v=>({fieldId:v.field?.id,optionId:v.optionId}))};
  };
  const write=async issueFields=>graphql(SET_ISSUE_FIELDS_MUTATION,{input:{issueId:target.issueId,issueFields,clientMutationId:`${operationId}-${++ordinal}`}});
  const saveEvidence=async event=>{
   const record={schemaVersion:1,operationId,sourceIssue:60,sourceCommit,bindingSha256,actorId:String(actor.id),observedAt:new Date().toISOString(),...event};
   writeFileSync(path.join(directory,`${operationId}-${String(++ordinal).padStart(3,'0')}.json`),JSON.stringify(record,null,2)+'\n',{mode:0o600,flag:'wx'});
  };
  const result=await runIssueFieldCanary({target,read,write,saveEvidence,actorId:String(actor.id),bindings,apply:options.apply});
  results.push({repositoryId:target.repositoryId,issueNumber:target.issueNumber,...result});
 }
 return {schemaVersion:1,operationId,sourceCommit,bindingSha256,mode:options.apply?'operator-apply':'operator-preview',results};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
 try {console.log(JSON.stringify(await runInteractiveCanaries(parseCanaryArguments(process.argv.slice(2)))));}
 catch {console.error('Canary did not complete. Preserve private snapshots and inspect current values before retry; sensitive diagnostics are withheld.');process.exitCode=1;}
}
