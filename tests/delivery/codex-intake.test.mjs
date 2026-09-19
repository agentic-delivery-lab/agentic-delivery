import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';
import { intakeEvent, redact, checkPublicationText, deliveryExitCode } from '../../scripts/codex-delivery.mjs';

const repositoryRoot = path.resolve(import.meta.dirname, '../..');

test('model publication text cannot add commit bodies or close unrelated issues', () => {
  checkPublicationText('feat: ✨ add intake', 'Added intake and tests.');
  for (const title of ['feat: ✨ work\n\nCloses #2', 'feat: ✨ fixes #2', 'x'.repeat(121)]) {
    assert.throws(() => checkPublicationText(title));
  }
  for (const summary of ['Resolves org/repo#2', 'Closes https://github.com/org/repo/issues/2', '**Resolves:** #2']) {
    assert.throws(() => checkPublicationText('feat: ✨ add intake', summary), /closing directives/);
  }
});

const env = {SOURCE_ISSUE:'15',GITHUB_REPOSITORY:'owner/repo',GITHUB_EVENT_NAME:'issues',GITHUB_ACTOR:'owner'};
test('starts free-form source issues without a label or form requirement', () => {
  for (const body of ['An idea', 'Requirements', 'A decision']) {
    assert.equal(intakeEvent({action:'opened',issue:{number:15,body}},env).issue,'15');
  }
});
test('trusted owner comments carry their payload identity, including plain continuation text', () => {
  const context={...env,GITHUB_EVENT_NAME:'issue_comment',GITHUB_ACTOR:'rerun-actor',GITHUB_TRIGGERING_ACTOR:'rerun-actor'};
  const event={
    action:'created',
    repository:{owner:{login:'owner'},full_name:'owner/repo'},
    issue:{number:15},
    comment:{id:42,body:'Please use the second option.',user:{login:'owner',type:'User'},author_association:'OWNER'},
  };
  const result=intakeEvent(event,context);
  assert.equal(result.issue,'15');
  assert.equal(result.actor,'owner');
  assert.deepEqual(result.comment,{id:'42',body:'Please use the second option.'});
});

test('the controller carries comment text without assigning routing intent', () => {
  const context={...env,GITHUB_EVENT_NAME:'issue_comment'};
  const event=(id,body)=>({
    action:'created',
    repository:{owner:{login:'owner'},full_name:'owner/repo'},
    issue:{number:15},
    comment:{id,body,user:{login:'owner',type:'User'},author_association:'OWNER'},
  });
  for (const [id, body] of [
    [43, 'Please continue from the saved work.'],
    [44, 'Ga verder met het opgeslagen werk.'],
    [45, 'Do not continue yet.'],
    [46, 'Continue, but remove the changelog first.'],
    [47, '/codex resume'],
  ]) assert.deepEqual(intakeEvent(event(id,body),context).comment,{id:String(id),body});
});

test('bot identities and pull-request comments cannot enter intake while repository users may answer', () => {
  const context={...env,GITHUB_EVENT_NAME:'issue_comment'};
  const base={action:'created',repository:{owner:{login:'owner'},full_name:'owner/repo'},issue:{number:15}};
  assert.doesNotThrow(() => intakeEvent({...base,comment:{id:44,body:'Continue',user:{login:'other',type:'User'},author_association:'COLLABORATOR'}},context));
  assert.throws(() => intakeEvent({...base,comment:{id:45,body:'Continue',user:{login:'owner',type:'Bot'},author_association:'OWNER'}},context),/non-bot repository user/);
  assert.doesNotThrow(() => intakeEvent({...base,comment:{id:46,body:'Continue',user:{login:'owner',type:'User'},author_association:'COLLABORATOR'}},context));
  assert.throws(() => intakeEvent({...base,issue:{number:15,pull_request:{html_url:'https://example.invalid'}}},context),/pull request/);
  assert.throws(() => intakeEvent({action:'created',...base,comment:{id:47,body:'Continue'}},context),/non-bot repository user/);
});

test('comment-driven intake is dispatched only through the explicit agent-invocation workflow', () => {
  const workflow = readFile(path.join(repositoryRoot, '.github/workflows/issue-intake.yml'), 'utf8');
  return workflow.then((source) => {
    assert.doesNotMatch(source, /issue_comment:\s*\n\s*types:/);
    assert.match(source, /inputs\.agent_invocation/);
    assert.match(source, /prepare-agent-invocation\.mjs/);
    assert.match(source, /needs\.classify\.outputs\.route == 'resume'/);
    assert.doesNotMatch(source, /startsWith\(github\.event\.comment\.body/);
  });
});

test('comment issue numbers cannot be redirected through SOURCE_ISSUE', () => {
  const context={...env,GITHUB_EVENT_NAME:'issue_comment'};
  assert.throws(() => intakeEvent({
    action:'created',repository:{owner:{login:'owner'},full_name:'owner/repo'},issue:{number:16},
    comment:{id:48,body:'Continue',user:{login:'owner',type:'User'},author_association:'OWNER'},
  },context),/does not match/);
});
test('accepts lifecycle events only as downstream delivery inputs', () => {
  for (const action of ['edited', 'reopened', 'labeled', 'unlabeled', 'typed', 'untyped', 'closed']) {
    assert.equal(intakeEvent({action, issue:{}}, {...env, GITHUB_EVENT_NAME:'issues'}).issue, '15');
  }
  assert.equal(intakeEvent({issue:{}}, {...env, GITHUB_EVENT_NAME:'workflow_call'}).issue, '15');
});
test('rejects identifiers and events that could escape the repository boundary', () => {
  for(const value of ['../15','15; command','0','-1']) assert.throws(()=>intakeEvent({action:'opened'},{...env,SOURCE_ISSUE:value}));
  assert.throws(()=>intakeEvent({action:'opened'},{...env,GITHUB_REPOSITORY:'../../elsewhere'}));
  assert.throws(()=>intakeEvent({action:'opened'},{...env,GITHUB_EVENT_NAME:'pull_request_target'}));
});
test('redacts known publishing credentials from audit output', () => {
  assert.equal(redact('api=value publish=publish-value',{GH_TOKEN:'value',PUBLISH_TOKEN:'publish-value'}),'api=[redacted] publish=[redacted]');
  assert.equal(redact('ghp_12345678901234567890',{}),'[redacted]');
});

test('awaiting-human is a successful boundary while technical pause remains a failure', () => {
  assert.equal(deliveryExitCode('awaiting-human'),0);
  assert.equal(deliveryExitCode('ignored'),0);
  assert.equal(deliveryExitCode('ready'),0);
  assert.equal(deliveryExitCode('paused'),1);
});
