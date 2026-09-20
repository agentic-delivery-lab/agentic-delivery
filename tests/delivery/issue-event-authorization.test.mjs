import assert from 'node:assert/strict';
import { test } from 'node:test';

import { authorizeIssueEvent } from '../../scripts/authorize-issue-event.mjs';

function response(status, value) {
  return { ok: status >= 200 && status < 300, status, json: async () => value };
}

test('downstream invocation events do not need a second collaborator lookup', async () => {
  let calls = 0;
  const result = await authorizeIssueEvent({
    env: { GITHUB_EVENT_NAME: 'repository_dispatch', GITHUB_OUTPUT: '' },
    fetchImpl: async () => { calls += 1; return response(500); },
  });
  assert.equal(result.authorized, true);
  assert.equal(calls, 0);
});

test('issue events allow writers and reject readers or unknown collaborators', async () => {
  const base = { GITHUB_EVENT_NAME: 'issues', GITHUB_REPOSITORY: 'owner/repo', GITHUB_ACTOR: 'writer', GH_TOKEN: 'token', GITHUB_OUTPUT: '' };
  const writer = await authorizeIssueEvent({ env: base, fetchImpl: async () => response(200, { permission: 'write' }) });
  assert.equal(writer.authorized, true);
  const reader = await authorizeIssueEvent({ env: { ...base, GITHUB_ACTOR: 'reader' }, fetchImpl: async () => response(200, { permission: 'read' }) });
  assert.equal(reader.authorized, false);
  const unknown = await authorizeIssueEvent({ env: { ...base, GITHUB_ACTOR: 'unknown' }, fetchImpl: async () => response(404) });
  assert.equal(unknown.authorized, false);
});

test('only exact internal automation identities bypass the collaborator lookup', async () => {
  for (const actor of ['github-actions[bot]', 'agentic-delivery-lab-invoker-7f3a[bot]']) {
    let calls = 0;
    const result = await authorizeIssueEvent({
      env: { GITHUB_EVENT_NAME: 'issues', GITHUB_REPOSITORY: 'owner/repo', GITHUB_ACTOR: actor, GITHUB_OUTPUT: '' },
      fetchImpl: async () => { calls += 1; return response(500); },
    });
    assert.equal(result.authorized, true);
    assert.equal(calls, 0);
  }
  await assert.rejects(
    authorizeIssueEvent({
      env: { GITHUB_EVENT_NAME: 'issues', GITHUB_REPOSITORY: 'owner/repo', GITHUB_ACTOR: 'other-bot[bot]', GH_TOKEN: 'token', GITHUB_OUTPUT: '' },
      fetchImpl: async () => response(500),
    }),
    /permission lookup failed/,
  );
});
