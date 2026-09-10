import assert from 'node:assert/strict';
import path from 'node:path';
import { test } from 'node:test';

import { classifyAndRoute, loadLifecycleConfig, reconcileLabels } from '../../scripts/issue-intake.mjs';

const repositoryRoot = path.resolve(import.meta.dirname, '../..');
const config = await loadLifecycleConfig(repositoryRoot);

test('reconciles managed labels idempotently while preserving unrelated labels and governance metadata', async () => {
  const calls = [];
  const api = async (route, method = 'GET', body) => {
    calls.push({ route, method, body });
    if (route.startsWith('/labels/')) return { name: decodeURIComponent(route.slice('/labels/'.length)) };
    return null;
  };
  const issue = {
    labels: [
      { name: 'type:feature' },
      { name: 'state:requirements' },
      { name: 'adr:needed' },
      { name: 'team:delivery' },
    ],
  };
  const classification = {
    workType: 'feature',
    workTypeSource: 'label',
    conflict: null,
    governance: ['adr:needed'],
    stateLabel: 'state:requirements',
  };
  const result = await reconcileLabels({ api, issueNumber: '17', issue, config, classification });
  const update = calls.find((call) => call.method === 'PUT' && call.route === '/issues/17/labels');
  assert.equal(update, undefined);
  assert.deepEqual(result.labels.sort(), ['adr:needed', 'state:requirements', 'team:delivery', 'type:feature'].sort());
  assert.equal(result.changed, false);
});

test('removes stale managed state and fallback type labels when native type is authoritative', async () => {
  const calls = [];
  const api = async (route, method = 'GET', body) => {
    calls.push({ route, method, body });
    if (route.startsWith('/labels/')) return { name: decodeURIComponent(route.slice('/labels/'.length)) };
    return null;
  };
  const result = await reconcileLabels({
    api,
    issueNumber: '17',
    issue: { labels: ['type:feature', 'state:requirements', 'security-review', 'team:delivery'] },
    config,
    classification: {
      workType: 'bug',
      workTypeSource: 'native',
      conflict: null,
      governance: ['security-review'],
      stateLabel: 'state:needs-triage',
    },
  });
  const update = calls.find((call) => call.method === 'PUT' && call.route === '/issues/17/labels');
  assert.deepEqual(update.body.labels.sort(), ['security-review', 'state:needs-triage', 'team:delivery'].sort());
  assert.equal(result.changed, true);
});

function apiFixture(issue, permission = 'write') {
  const calls = [];
  const fetchImpl = async (url, options) => {
    const route = url.replace('https://api.github.com/repos/owner/repo', '');
    const body = options.body ? JSON.parse(options.body) : undefined;
    calls.push({ route, method: options.method, body });
    if (route === '/issues/17') return new Response(JSON.stringify(issue), { status: 200 });
    if (route.startsWith('/labels/')) return new Response(JSON.stringify({ name: decodeURIComponent(route.slice('/labels/'.length)) }), { status: 200 });
    if (route === '/issues/17/labels' && options.method === 'PUT') return new Response(JSON.stringify(body.labels.map((name) => ({ name }))), { status: 200 });
    if (route.startsWith('/collaborators/')) return new Response(JSON.stringify({ permission }), { status: 200 });
    throw new Error(`Unexpected route ${route}`);
  };
  return { calls, fetchImpl };
}

test('classifies and hands off a ready issue only after metadata reconciliation and actor authorization', async () => {
  const fixture = apiFixture({
    state: 'open', title: 'Task: implement routing', body: 'Deliver the routing harness.',
    labels: [{ name: 'type:task' }, { name: 'state:requirements' }, { name: 'state:ready-for-plan' }, { name: 'team:delivery' }],
  });
  const result = await classifyAndRoute({
    env: { GITHUB_REPOSITORY: 'owner/repo', SOURCE_ISSUE: '17', GH_TOKEN: 'token', GITHUB_ACTOR: 'maintainer' },
    event: { action: 'labeled', label: { name: 'state:ready-for-plan' }, issue: {} },
    fetchImpl: fixture.fetchImpl,
    config,
  });
  assert.equal(result.route, 'plan');
  assert.equal(result.state, 'ready-for-plan');
  assert.ok(fixture.calls.some((call) => call.route === '/issues/17/labels' && call.method === 'PUT'));
  assert.ok(fixture.calls.some((call) => call.route === '/collaborators/maintainer/permission'));
});

test('keeps an unauthorized ready issue on hold without changing its requested state', async () => {
  const fixture = apiFixture({
    state: 'open', title: 'Task: implement routing', body: 'Deliver the routing harness.',
    labels: [{ name: 'type:task' }, { name: 'state:ready-for-plan' }],
  }, 'read');
  const result = await classifyAndRoute({
    env: { GITHUB_REPOSITORY: 'owner/repo', SOURCE_ISSUE: '17', GH_TOKEN: 'token', GITHUB_ACTOR: 'contributor' },
    event: { action: 'labeled', label: { name: 'state:ready-for-plan' }, issue: {} },
    fetchImpl: async (url, options) => {
      const route = url.replace('https://api.github.com/repos/owner/repo', '');
      if (route === '/collaborators/contributor/permission') return new Response(JSON.stringify({ permission: 'read' }), { status: 200 });
      return fixture.fetchImpl(url, options);
    },
    config,
  });
  assert.equal(result.route, 'hold');
  assert.match(result.metadata.reasons.join(' '), /maintainer/);
  assert.equal(result.state, 'ready-for-plan');
});

test('does not route an untrusted near-match comment to delivery', async () => {
  const fixture = apiFixture({
    state: 'open', title: 'Task: implement routing', body: 'Deliver the routing harness.',
    labels: [{ name: 'type:task' }, { name: 'state:ready-for-plan' }],
  });
  const result = await classifyAndRoute({
    env: { GITHUB_REPOSITORY: 'owner/repo', SOURCE_ISSUE: '17', GH_TOKEN: 'token', GITHUB_ACTOR: 'maintainer', GITHUB_EVENT_NAME: 'issue_comment' },
    event: {
      action: 'created', issue: {},
      repository: { owner: { login: 'owner' } },
      comment: { body: '/codex resume-malicious', user: { login: 'contributor', type: 'User' }, author_association: 'CONTRIBUTOR' },
    },
    fetchImpl: fixture.fetchImpl,
    config,
  });
  assert.equal(result.route, 'hold');
  assert.match(result.metadata.reasons.join(' '), /trusted repository-owner/);
  assert.ok(!fixture.calls.some((call) => call.route.includes('/permission')));
});

test('preserves natural-language recovery through the intake boundary', async () => {
  const fixture = apiFixture({
    state: 'open', title: 'Task: implement routing', body: 'Deliver the routing harness.',
    labels: [{ name: 'type:task' }, { name: 'state:needs-info' }],
  });
  const result = await classifyAndRoute({
    env: { GITHUB_REPOSITORY: 'owner/repo', SOURCE_ISSUE: '17', GH_TOKEN: 'token', GITHUB_ACTOR: 'maintainer', GITHUB_EVENT_NAME: 'issue_comment' },
    event: {
      action: 'created', issue: {},
      repository: { owner: { login: 'owner' } },
      comment: { body: 'Please continue from the saved work.', user: { login: 'owner', type: 'User' }, author_association: 'OWNER' },
    },
    fetchImpl: fixture.fetchImpl,
    config,
  });
  assert.equal(result.route, 'resume');
  assert.ok(fixture.calls.some((call) => call.route === '/collaborators/owner/permission'));
});

test('passes a trusted owner clarification answer to the saved delivery run', async () => {
  const fixture = apiFixture({
    state: 'open', title: 'Task: implement routing', body: 'Deliver the routing harness.',
    labels: [{ name: 'type:task' }, { name: 'state:needs-info' }],
  });
  const result = await classifyAndRoute({
    env: { GITHUB_REPOSITORY: 'owner/repo', SOURCE_ISSUE: '17', GH_TOKEN: 'token', GITHUB_ACTOR: 'maintainer', GITHUB_EVENT_NAME: 'issue_comment' },
    event: {
      action: 'created', issue: {},
      repository: { owner: { login: 'owner' } },
      comment: { body: 'Use the existing wording.', user: { login: 'owner', type: 'User' }, author_association: 'OWNER' },
    },
    fetchImpl: fixture.fetchImpl,
    config,
  });
  assert.equal(result.route, 'resume');
});
