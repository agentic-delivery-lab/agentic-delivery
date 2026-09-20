import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { generateKeyPairSync } from 'node:crypto';

import { classifyAndRoute, loadLifecycleConfig, reconcileLabels } from '../../scripts/issue-intake.mjs';

const repositoryRoot = path.resolve(import.meta.dirname, '../..');
const config = await loadLifecycleConfig(repositoryRoot);

const modelRoute = (route, workType, state, governance = []) => async () => {
  const legacy = config.legacy.state_labels[`state:${state}`];
  const patterns = {
    refine: 'idea-discovery', research: 'research-only', requirements: 'requirements',
    architecture: 'architecture-decision', plan: 'implementation-fresh',
    implement: 'implementation-existing-plan', resume: 'implementation-continuation',
    validate: 'validation-only', coordinate: 'parent-coordination',
  };
  return {
    route, workType, state,
    lifecycleStage: legacy?.stage ?? state,
    readiness: legacy?.readiness ?? 'not-ready',
    governance,
    orchestrationPattern: route === 'hold' ? null : patterns[route] ?? null,
    summary: `Model selected ${route}.`, message: '',
  };
};

test('legacy label reconciliation is read-only during the migration window', async () => {
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

test('governance labels are not created by lifecycle reconciliation', async () => {
  const calls = [];
  const api = async (route, method = 'GET', body) => {
    calls.push({ route, method, body });
    return null;
  };

  const result = await reconcileLabels({
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

  assert.equal(result.migrationOnly, true);
  assert.equal(calls.length, 0);
});

test('stale lifecycle and fallback type labels remain untouched until explicit migration', async () => {
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
  assert.equal(calls.length, 0);
  assert.equal(result.changed, false);
  assert.equal(result.migrationOnly, true);
});

function apiFixture(issue, permission = 'write', comments = [], repository = 'owner/repo') {
  const calls = [];
  const fetchImpl = async (url, options) => {
    const route = url.replace('https://api.github.com/repos/' + repository, '');
    const body = options.body ? JSON.parse(options.body) : undefined;
    calls.push({ route, method: options.method, body });
    if (route === '/issues/17') return new Response(JSON.stringify(issue), { status: 200 });
    if (route === '/issues/17/comments' && options.method === 'POST') return new Response(JSON.stringify({ id: 100 }), { status: 201 });
    if (route.startsWith('/issues/17/comments?')) return new Response(JSON.stringify(comments), { status: 200 });
    if (route.startsWith('/labels/')) return new Response(JSON.stringify({ name: decodeURIComponent(route.slice('/labels/'.length)) }), { status: 200 });
    if (route === '/issues/17/labels' && options.method === 'PUT') return new Response(JSON.stringify(body.labels.map((name) => ({ name }))), { status: 200 });
    if (route.startsWith('/collaborators/')) return new Response(JSON.stringify({ permission }), { status: 200 });
    throw new Error(`Unexpected route ${route}`);
  };
  return { calls, fetchImpl };
}

test('central intake addresses the originating repository instead of the controller repository', async () => {
  const origin = 'agentic-delivery-lab/service-a';
  const fixture = apiFixture({
    state: 'open', title: 'Task: implement routing', body: 'Deliver the routing harness.',
    labels: [{ name: 'type:task' }, { name: 'state:requirements' }, { name: 'team:delivery' }],
  }, 'write', [], origin);
  const result = await classifyAndRoute({
    env: {
      GITHUB_REPOSITORY: 'agentic-delivery-lab/agentic-delivery',
      ORIGIN_REPOSITORY: origin,
      SOURCE_ISSUE: '17',
      GH_TOKEN: 'token',
      GITHUB_ACTOR: 'maintainer',
    },
    event: { action: 'edited', issue: {}, repository: { full_name: origin } },
    fetchImpl: fixture.fetchImpl,
    config,
    reasonRoute: modelRoute('plan', 'task', 'ready-for-plan'),
  });
  assert.equal(result.route, 'plan');
  assert.ok(fixture.calls.length > 0);
});

test('central intake mints an origin-scoped App token instead of using the controller token', async () => {
  const origin = 'agentic-delivery-lab/service-a';
  const fixture = apiFixture({
    state: 'open', title: 'Task: implement routing', body: 'Deliver the routing harness.',
    labels: [{ name: 'type:task' }, { name: 'state:requirements' }, { name: 'team:delivery' }],
  }, 'write', [], origin);
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const tokenRequests = [];
  const apiCalls = [];
  const fetchImpl = async (url, options) => {
    if (url.endsWith('/access_tokens')) {
      tokenRequests.push(JSON.parse(options.body));
      return new Response(JSON.stringify({ token: 'origin-scoped-token', expires_at: '2099-01-01T00:00:00Z' }), { status: 201 });
    }
    apiCalls.push(options.headers.Authorization);
    return fixture.fetchImpl(url, options);
  };
  const result = await classifyAndRoute({
    env: {
      GITHUB_REPOSITORY: 'agentic-delivery-lab/agentic-delivery',
      ORIGIN_REPOSITORY: origin,
      ORIGIN_REPOSITORY_ID: '777777777',
      CODEX_DELIVERY_APP_ID: '5011055',
      CODEX_DELIVERY_APP_PRIVATE_KEY: privateKey.export({ type: 'pkcs8', format: 'pem' }),
      CODEX_DELIVERY_APP_INSTALLATION_ID: '163255060',
      SOURCE_ISSUE: '17',
      GH_TOKEN: 'controller-token',
      GITHUB_ACTOR: 'maintainer',
    },
    event: { action: 'edited', issue: {}, repository: { full_name: origin } },
    fetchImpl,
    config,
    reasonRoute: modelRoute('plan', 'task', 'ready-for-plan'),
  });
  assert.equal(result.route, 'plan');
  assert.deepEqual(tokenRequests[0].repository_ids, ['777777777']);
  assert.ok(apiCalls.length > 0 && apiCalls.every((authorization) => authorization === 'Bearer origin-scoped-token'));
});

test('classifies and hands off a ready issue only after metadata reconciliation and actor authorization', async () => {
  const fixture = apiFixture({
    state: 'open', title: 'Task: implement routing', body: 'Deliver the routing harness.',
    labels: [{ name: 'type:task' }, { name: 'state:requirements' }, { name: 'team:delivery' }],
  });
  const result = await classifyAndRoute({
    env: { GITHUB_REPOSITORY: 'owner/repo', SOURCE_ISSUE: '17', GH_TOKEN: 'token', GITHUB_ACTOR: 'maintainer' },
    event: { action: 'edited', issue: {} },
    fetchImpl: fixture.fetchImpl,
    config,
    reasonRoute: modelRoute('plan', 'task', 'ready-for-plan'),
  });
  assert.equal(result.route, 'plan');
  assert.equal(result.state, 'ready-for-plan');
  assert.deepEqual(result.metadata.targetFields, {
    lifecycle_stage: 'planning',
    readiness: 'ready',
    lifecycleStageField: 'lifecycle-stage',
    readinessField: 'delivery-readiness',
  });
  assert.ok(!fixture.calls.some((call) => call.route === '/issues/17/labels' && call.method === 'PUT'));
  assert.ok(fixture.calls.some((call) => call.route === '/collaborators/maintainer/permission'));
});

test('routes a blank untyped source issue to refinement without manual labels', async () => {
  const fixture = apiFixture({ state: 'open', title: 'A new goal', body: '', labels: [] });
  const result = await classifyAndRoute({
    env: { GITHUB_REPOSITORY: 'owner/repo', SOURCE_ISSUE: '17', GH_TOKEN: 'token', GITHUB_ACTOR: 'maintainer', GITHUB_EVENT_NAME: 'issues' },
    event: { action: 'opened', issue: {} }, fetchImpl: fixture.fetchImpl, config,
    reasonRoute: modelRoute('refine', null, 'needs-triage'),
  });
  assert.equal(result.route, 'refine');
  assert.equal(result.state, 'needs-triage');
  assert.deepEqual(result.metadata.targetFields, {
    lifecycle_stage: 'intake',
    readiness: 'not-ready',
    lifecycleStageField: 'lifecycle-stage',
    readinessField: 'delivery-readiness',
  });
  assert.ok(!fixture.calls.some((call) => call.route === '/issues/17/labels' && call.method === 'PUT'));
});

test('holds live intake before model routing when organization lifecycle fields are unavailable', async () => {
  const fixture = apiFixture({ state: 'open', title: 'A new goal', body: '', labels: [] });
  const result = await classifyAndRoute({
    env: { GITHUB_REPOSITORY: 'owner/repo', SOURCE_ISSUE: '17', GH_TOKEN: 'token', GITHUB_ACTOR: 'maintainer', GITHUB_EVENT_NAME: 'issues', ISSUE_FIELD_BINDINGS_JSON: '' },
    event: { action: 'opened', issue: {} },
    fetchImpl: fixture.fetchImpl,
    graphqlImpl: async () => ({}),
    controlPlaneReader: async () => ({ organizationIssueTypes: [], organizationIssueFields: [] }),
    config,
    reasonRoute: async () => { throw new Error('Unavailable metadata must hold before model routing.'); },
  });
  assert.equal(result.route, 'hold');
  assert.match(result.metadata.reasons.join(' '), /organization issue fields are not ready/);
  assert.ok(!fixture.calls.some((call) => call.route.includes('/permission')));
});

test('does not refine an already-ready decomposed implementation child', async () => {
  const fixture = apiFixture({
    state: 'open', title: 'Implement: child work', body: '<!-- codex-lineage:v1 parent=17 key=implementation -->\nDeliver the child.',
    labels: [{ name: 'type:implementation' }, { name: 'state:ready-for-plan' }],
  });
  const result = await classifyAndRoute({
    env: { GITHUB_REPOSITORY: 'owner/repo', SOURCE_ISSUE: '17', GH_TOKEN: 'token', GITHUB_ACTOR: 'maintainer', GITHUB_EVENT_NAME: 'issues' },
    event: { action: 'opened', issue: {} }, fetchImpl: fixture.fetchImpl, config,
    reasonRoute: modelRoute('plan', 'implementation', 'ready-for-plan'),
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
  assert.match(result.metadata.reasons.join(' '), /repository writer/);
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
    reasonRoute: modelRoute('resume', 'task', 'needs-info'),
  });
  assert.equal(result.route, 'hold');
  assert.match(result.metadata.reasons.join(' '), /non-bot/);
  assert.ok(!fixture.calls.some((call) => call.route.includes('/permission')));
});

test('uses model reasoning for comment routing instead of matching comment words', async () => {
  const issue = {
    state: 'open', title: 'Task: implement routing', body: 'Deliver the routing harness.',
    labels: [{ name: 'type:task' }, { name: 'state:in-progress' }],
    plan: { exists: true, valid: true, digest: 'a'.repeat(64) },
    session: { exists: true, resumable: true, id: '019fb023-24b8-7881-9119-509f078b610e' },
  };
  const event = (body) => ({
    action: 'created', issue: {},
    comment: { body, user: { login: 'owner', type: 'User' }, author_association: 'OWNER' },
  });
  const resumeFixture = apiFixture(issue, 'write', [{ id: 9, body: 'Publishing failed after implementation.', user: { login: 'github-actions[bot]', type: 'Bot' } }]);
  let routedIssue;
  const resumed = await classifyAndRoute({
    env: { GITHUB_REPOSITORY: 'owner/repo', SOURCE_ISSUE: '17', GH_TOKEN: 'token', GITHUB_EVENT_NAME: 'issue_comment' },
    event: event('This sentence deliberately contains no routing keyword.'),
    fetchImpl: resumeFixture.fetchImpl,
    config,
    reasonRoute: async ({ issue: issueWithConversation }) => {
      routedIssue = issueWithConversation;
      return {
        route: 'resume', workType: 'task', state: 'in-progress', lifecycleStage: 'execution', readiness: 'working', governance: [], orchestrationPattern: 'implementation-continuation',
        summary: 'The owner authorized the saved work to continue.', message: '',
      };
    },
  });
  assert.equal(resumed.route, 'resume', JSON.stringify(resumed));
  assert.equal(routedIssue.comments[0].body, 'Publishing failed after implementation.');

  const holdFixture = apiFixture(issue);
  const held = await classifyAndRoute({
    env: { GITHUB_REPOSITORY: 'owner/repo', SOURCE_ISSUE: '17', GH_TOKEN: 'token', GITHUB_EVENT_NAME: 'issue_comment' },
    event: event('Continue immediately.'),
    fetchImpl: holdFixture.fetchImpl,
    config,
    reasonRoute: async () => ({
      route: 'hold', workType: 'task', state: 'in-progress', lifecycleStage: 'execution', readiness: 'working', governance: [], orchestrationPattern: null,
      summary: 'The surrounding context says not to act yet.', message: '',
    }),
  });
  assert.equal(held.route, 'hold');
});

test('uses the runner-local saved plan and session to authorize exact continuation routing', async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), 'issue-intake-state-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, '100', '17'), { recursive: true });
  await writeFile(path.join(root, '100', '17', 'state.json'), JSON.stringify({
    repository: 'owner/repo', issue: '17', version: 3, phase: 'implement', status: 'paused',
    events: [], tasks: [], plan: { status: 'ready' }, planDigest: 'a'.repeat(64),
    sessionId: '019fb023-24b8-7881-9119-509f078b610e',
    execution: { status: 'paused', operation: 'implement', run: null, lastFailure: null },
  }));
  const fixture = apiFixture({
    state: 'open', title: 'Task: continue routing', body: 'Continue the saved implementation.',
    labels: [{ name: 'type:task' }, { name: 'state:in-progress' }],
  }, 'write');
  const result = await classifyAndRoute({
    env: {
      GITHUB_REPOSITORY: 'owner/repo', SOURCE_ISSUE: '17', GH_TOKEN: 'token',
      GITHUB_EVENT_NAME: 'issue_comment', CODEX_DELIVERY_STATE_DIR: root,
    },
    event: {
      action: 'created', repository: { id: 100 }, issue: {},
      comment: { id: 10, body: 'Continue from the saved work.', user: { login: 'owner', type: 'User' } },
    },
    fetchImpl: fixture.fetchImpl,
    config,
    reasonRoute: async () => ({
      route: 'resume', workType: 'task', lifecycleStage: 'execution', readiness: 'working',
      governance: [], orchestrationPattern: 'implementation-continuation',
      summary: 'Resume the unchanged saved implementation.', message: '',
    }),
  });
  assert.equal(result.route, 'resume', JSON.stringify(result));
  assert.equal(result.metadata.orchestrationPattern, 'implementation-continuation');
});

test('does not route an older comment after a newer human reply', async () => {
  const fixture = apiFixture({
    state: 'open', title: 'Task: resume saved work', body: 'Continue after answering.',
    labels: [{ name: 'type:task' }, { name: 'state:in-progress' }],
  }, 'write', [
    { id: 4, body: 'First answer', user: { login: 'owner', type: 'User' } },
    { id: 5, body: 'Correction: wait', user: { login: 'owner', type: 'User' } },
  ]);
  const result = await classifyAndRoute({
    env: { GITHUB_REPOSITORY: 'owner/repo', SOURCE_ISSUE: '17', GH_TOKEN: 'token', GITHUB_EVENT_NAME: 'issue_comment' },
    event: { action: 'created', issue: {}, comment: { id: 4, body: 'First answer', user: { login: 'owner', type: 'User' } } },
    fetchImpl: fixture.fetchImpl, config,
    reasonRoute: async () => { throw new Error('The older event must not reach the model.'); },
  });
  assert.equal(result.route, 'hold');
  assert.match(result.metadata.reasons.join(' '), /newer human comment/);
  assert.ok(!fixture.calls.some((call) => call.method === 'PUT'));
});

test('preserves natural-language recovery through the intake boundary', async () => {
  const fixture = apiFixture({
    state: 'open', title: 'Task: implement routing', body: 'Deliver the routing harness.',
    labels: [{ name: 'type:task' }, { name: 'state:in-progress' }],
    plan: { exists: true, valid: true, digest: 'a'.repeat(64) },
    session: { exists: true, resumable: true, id: '019fb023-24b8-7881-9119-509f078b610e' },
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
    reasonRoute: async () => ({
      route: 'resume', workType: 'task', lifecycleStage: 'execution', readiness: 'needs-info',
      governance: [], orchestrationPattern: 'implementation-continuation',
      summary: 'The owner authorized the saved work to continue.', message: '',
    }),
  });
  assert.equal(result.route, 'resume', JSON.stringify(result));
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
    reasonRoute: modelRoute('requirements', 'task', 'needs-info'),
  });
  assert.equal(result.route, 'requirements');
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
    reasonRoute: modelRoute('coordinate', 'feature', 'coordinating'),
  });
  assert.equal(result.route, 'coordinate');
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
