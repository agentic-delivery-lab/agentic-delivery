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
  assert.deepEqual(result.comment,{id:'42',body:'Please use the second option.',isResumeCommand:false,isResumeRequest:false});
});

test('natural-language requests and the legacy command express technical recovery intent', () => {
  const context={...env,GITHUB_EVENT_NAME:'issue_comment'};
  const event=(id,body)=>({
    action:'created',
    repository:{owner:{login:'owner'},full_name:'owner/repo'},
    issue:{number:15},
    comment:{id,body,user:{login:'owner',type:'User'},author_association:'OWNER'},
  });
  const natural=intakeEvent(event(43,'Please continue from the saved work.'),context).comment;
  assert.equal(natural.isResumeRequest,true);
  assert.equal(natural.isResumeCommand,false);
  const dutch=intakeEvent(event(44,'Ga verder met het opgeslagen werk.'),context).comment;
  assert.equal(dutch.isResumeRequest,true);
  assert.equal(intakeEvent(event(45,'Yes, could you please resume from where you left off?'),context).comment.isResumeRequest,true);
  assert.equal(intakeEvent(event(46,'Ja, ga maar verder alsjeblieft.'),context).comment.isResumeRequest,true);
  const legacy=intakeEvent(event(47,'/codex resume'),context).comment;
  assert.equal(legacy.isResumeRequest,true);
  assert.equal(legacy.isResumeCommand,true);
  assert.equal(intakeEvent(event(48,'Do not continue yet.'),context).comment.isResumeRequest,false);
  assert.equal(intakeEvent(event(49,'Continue, but remove the changelog first.'),context).comment.isResumeRequest,false);
});

test('untrusted commenters, bot identities, and pull-request comments cannot enter intake', () => {
  const context={...env,GITHUB_EVENT_NAME:'issue_comment'};
  const base={action:'created',repository:{owner:{login:'owner'},full_name:'owner/repo'},issue:{number:15}};
  for (const comment of [
    {id:44,body:'Continue',user:{login:'other',type:'User'},author_association:'COLLABORATOR'},
    {id:45,body:'Continue',user:{login:'owner',type:'Bot'},author_association:'OWNER'},
    {id:46,body:'Continue',user:{login:'owner',type:'User'},author_association:'COLLABORATOR'},
  ]) {
    assert.throws(() => intakeEvent({...base,comment},context),/trusted repository owner/);
  }
  assert.throws(() => intakeEvent({...base,issue:{number:15,pull_request:{html_url:'https://example.invalid'}}},context),/pull request/);
  assert.throws(() => intakeEvent({action:'created',...base,comment:{id:47,body:'Continue'}},context),/trusted repository owner/);
});

test('issue comments do not require the resume command before controller eligibility is checked', () => {
  const workflow = readFile(path.join(repositoryRoot, '.github/workflows/codex-delivery.yml'), 'utf8');
  return workflow.then((source) => {
    assert.match(source, /github\.event\.comment\.user\.login == github\.repository_owner/);
    assert.match(source, /github\.event\.comment\.author_association == 'OWNER'/);
    assert.match(source, /github\.event\.comment\.user\.type != 'Bot'/);
    assert.doesNotMatch(source, /startsWith\(github\.event\.comment\.body, '\/codex resume'\)/);
  });
});

test('comment issue numbers cannot be redirected through SOURCE_ISSUE', () => {
  const context={...env,GITHUB_EVENT_NAME:'issue_comment'};
  assert.throws(() => intakeEvent({
    action:'created',repository:{owner:{login:'owner'},full_name:'owner/repo'},issue:{number:16},
    comment:{id:48,body:'Continue',user:{login:'owner',type:'User'},author_association:'OWNER'},
  },context),/does not match/);
});
test('rejects identifiers and events that could escape the repository boundary', () => {
  for(const value of ['../15','15; command','0','-1']) assert.throws(()=>intakeEvent({action:'opened'},{...env,SOURCE_ISSUE:value}));
  assert.throws(()=>intakeEvent({action:'opened'},{...env,GITHUB_REPOSITORY:'../../elsewhere'}));
  assert.throws(()=>intakeEvent({action:'opened'},{...env,GITHUB_EVENT_NAME:'pull_request_target'}));
});
test('redacts known publishing credentials from audit output', () => {
  assert.equal(redact('token=value',{GH_TOKEN:'value'}),'token=[redacted]');
  assert.equal(redact('ghp_12345678901234567890',{}),'[redacted]');
});

test('awaiting-human is a successful boundary while technical pause remains a failure', () => {
  assert.equal(deliveryExitCode('awaiting-human'),0);
  assert.equal(deliveryExitCode('ignored'),0);
  assert.equal(deliveryExitCode('ready'),0);
  assert.equal(deliveryExitCode('paused'),1);
});
