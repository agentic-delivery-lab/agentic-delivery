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

test('creates missing governance labels with GitHub API-compatible names', async () => {
  const calls = [];
  const api = async (route, method = 'GET', body) => {
    calls.push({ route, method, body });
    if (route === '/labels/human-review' && method === 'GET') {
      const error = new Error('Label not found.');
      error.status = 404;
      throw error;
    }
    return null;
  };

  await reconcileLabels({
    api,
    issueNumber: '17',
    issue: { labels: [] },
    config,
    classification: {
      workType: null,
      workTypeSource: 'unknown',
      conflict: null,
      governance: [],
      stateLabel: null,
    },
  });

  assert.deepEqual(
    calls.find((call) => call.route === '/labels' && call.method === 'POST')?.body,
    {
      name: 'human-review',
      color: '5319E7',
      description: 'A human review control applies to this work.',
    },
  );
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

test('does not refine an already-ready decomposed implementation child', async () => {
  const fixture = apiFixture({
    state: 'open', title: 'Implement: child work', body: '<!-- codex-lineage:v1 parent=17 key=implementation -->\nDeliver the child.',
    labels: [{ name: 'type:implementation' }, { name: 'state:ready-for-plan' }],
  });
  const result = await classifyAndRoute({
    env: { GITHUB_REPOSITORY: 'owner/repo', SOURCE_ISSUE: '17', GH_TOKEN: 'token', GITHUB_ACTOR: 'maintainer', GITHUB_EVENT_NAME: 'issues' },
    event: { action: 'opened', issue: {} }, fetchImpl: fixture.fetchImpl, config,
  });
  assert.equal(result.route, 'plan');
  assert.equal(result.state, 'ready-for-plan');
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

test('does not route a bot near-match comment to delivery', async () => {
  const fixture = apiFixture({
    state: 'open', title: 'Task: implement routing', body: 'Deliver the routing harness.',
    labels: [{ name: 'type:task' }, { name: 'state:ready-for-plan' }],
  });
  const result = await classifyAndRoute({
    env: { GITHUB_REPOSITORY: 'owner/repo', SOURCE_ISSUE: '17', GH_TOKEN: 'token', GITHUB_ACTOR: 'maintainer', GITHUB_EVENT_NAME: 'issue_comment' },
    event: {
      action: 'created', issue: {},
      repository: { owner: { login: 'owner' } },
      comment: { body: '/codex resume-malicious', user: { login: 'contributor', type: 'Bot' }, author_association: 'BOT' },
    },
    fetchImpl: fixture.fetchImpl,
    config,
  });
  assert.equal(result.route, 'hold');
  assert.match(result.metadata.reasons.join(' '), /non-bot/);
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

test('routes a repository-writer clarification answer into refinement', async () => {
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
  assert.equal(result.route, 'refine');
});

test('allows a writer to request a later refinement wave from a coordinating parent', async () => {
  const fixture = apiFixture({
    state: 'open', title: 'Feature: coordinate work', body: 'Use the research findings.',
    labels: [{ name: 'type:feature' }, { name: 'state:coordinating' }],
  });
  const result = await classifyAndRoute({
    env: { GITHUB_REPOSITORY: 'owner/repo', SOURCE_ISSUE: '17', GH_TOKEN: 'token', GITHUB_ACTOR: 'maintainer', GITHUB_EVENT_NAME: 'issue_comment' },
    event: {
      action: 'created', issue: {},
      comment: { body: 'The research is complete; refine the parent with those findings.', user: { login: 'owner', type: 'User' }, author_association: 'OWNER' },
    }, fetchImpl: fixture.fetchImpl, config,
  });
  assert.equal(result.route, 'refine');
  assert.equal(result.state, 'coordinating');
});

test('routes a changed child issue to its coordinating lineage root', async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    const route = url.replace('https://api.github.com/repos/owner/repo', '');
    calls.push({ route, method: options.method });
    if (route === '/issues/42') return new Response(JSON.stringify({
      number: 42, state: 'closed', body: '<!-- codex-lineage:v1 parent=17 key=implementation -->', labels: [{ name: 'type:implementation' }],
    }), { status: 200 });
    if (route === '/issues/17') return new Response(JSON.stringify({
      number: 17, state: 'open', title: 'Feature: coordinate work', body: 'Deliver the result.',
      labels: [{ name: 'type:feature' }, { name: 'state:coordinating' }],
    }), { status: 200 });
    if (route === '/collaborators/maintainer/permission') return new Response(JSON.stringify({ permission: 'write' }), { status: 200 });
    throw new Error(`Unexpected route ${route}`);
  };
  const result = await classifyAndRoute({
    env: { GITHUB_REPOSITORY: 'owner/repo', SOURCE_ISSUE: '42', GH_TOKEN: 'token', GITHUB_TRIGGERING_ACTOR: 'maintainer', GITHUB_EVENT_NAME: 'issues' },
    event: { action: 'closed', issue: { number: 42 } }, fetchImpl, config,
  });
  assert.equal(result.issue, '17');
  assert.equal(result.route, 'coordinate');
  assert.equal(result.state, 'coordinating');
  assert.ok(calls.some((call) => call.route === '/issues/17'));
  assert.ok(!calls.some((call) => call.method === 'PUT'));
});
