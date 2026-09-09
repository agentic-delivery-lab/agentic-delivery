import assert from 'node:assert/strict';
import { test } from 'node:test';
import { intakeEvent, redact, checkPublicationText } from '../../scripts/codex-delivery.mjs';

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
test('resume requests are explicit and PR comments cannot trigger intake', () => {
  const context={...env,GITHUB_EVENT_NAME:'issue_comment'};
  assert.equal(intakeEvent({action:'created',comment:{body:'/codex resume\nAnswers here'},issue:{}},context).issue,'15');
  for(const body of ['Please continue','/codex resume-malicious']) {
    assert.throws(()=>intakeEvent({action:'created',comment:{body},issue:{}},context));
  }
  assert.throws(()=>intakeEvent({action:'opened',issue:{pull_request:{}}},env),/pull request/);
});
test('accepts lifecycle events only as downstream delivery inputs', () => {
  for (const action of ['edited', 'reopened', 'labeled', 'unlabeled', 'typed', 'untyped']) {
    assert.equal(intakeEvent({action, issue:{}}, {...env, GITHUB_EVENT_NAME:'issues'}).issue, '15');
  }
  assert.equal(intakeEvent({issue:{}}, {...env, GITHUB_EVENT_NAME:'workflow_call'}).issue, '15');
  assert.throws(() => intakeEvent({action:'closed', issue:{}}, {...env, GITHUB_EVENT_NAME:'issues'}), /Unsupported issue activity/);
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
