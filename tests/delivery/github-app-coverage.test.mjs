import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';

import { collectGithubAppCoverage } from '../../scripts/lib/github-app-coverage.mjs';
import { parseRepositoryYaml } from '../../scripts/lib/yaml.mjs';

const sourceCommit = 'a'.repeat(40);
const observedNow = Date.parse('2026-10-29T12:00:00Z');
const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const key = privateKey.export({ type: 'pkcs8', format: 'pem' });
const targets = [
  [1358455028, 'agentic-delivery'], [1380894616, 'agentic-delivery-architecture'],
  [1380894656, 'agentic-delivery-agent-customizations'], [1380894705, 'agentic-delivery-distribution'],
  [1368850419, '.github'], [1380894756, '.github-private'], [1416207421, 'agentic-delivery-requirements'],
];

function environment(overrides = {}) {
  return {
    GITHUB_ACTIONS: 'true', GITHUB_EVENT_NAME: 'workflow_dispatch',
    GITHUB_ACTOR_ID: '14937399', GITHUB_ACTOR: 'sjefsharp', GITHUB_TRIGGERING_ACTOR: 'sjefsharp', GITHUB_REPOSITORY_ID: '1358455028',
    GITHUB_REPOSITORY: 'agentic-delivery-lab/agentic-delivery', GITHUB_REF: 'refs/heads/main',
    GITHUB_SHA: sourceCommit, APP_COVERAGE_SOURCE_COMMIT: sourceCommit, GITHUB_RUN_ID: '123', GITHUB_RUN_ATTEMPT: '1',
    CODEX_DELIVERY_APP_ID: '5011055', CODEX_DELIVERY_APP_INSTALLATION_ID: '163255060',
    CODEX_DELIVERY_APP_PRIVATE_KEY: key, ...overrides,
  };
}

function installation() {
  return {
    id: 163255060, app_id: 5011055, app_slug: 'agentic-delivery-lab-invoker-7f3a',
    account: { id: 327861320, login: 'agentic-delivery-lab', type: 'Organization' },
    target_id: 327861320, target_type: 'Organization', repository_selection: 'selected',
    permissions: { metadata: 'read', contents: 'write', issues: 'write', issue_fields: 'read', issue_types: 'read', pull_requests: 'write' },
    suspended_at: null,
  };
}

function repository(id) {
  const [, name] = targets.find(([candidate]) => candidate === id);
  return { id, full_name: `agentic-delivery-lab/${name}`, owner: { id: 327861320, login: 'agentic-delivery-lab' } };
}

function harness({ change = (_request, data) => data, fail = () => false } = {}) {
  const calls = [];
  const fetchImpl = async (url, options) => {
    const route = url.replace('https://api.github.com', '');
    const request = { route, method: options.method, options, body: options.body ? JSON.parse(options.body) : null };
    calls.push(request);
    if (fail(request)) throw new Error(`Transport failed with sensitive data ${key} fixture-token`);
    let data;
    if (options.method === 'GET' && route === '/app/installations/163255060') data = installation();
    else if (options.method === 'GET' && /^\/repos\/agentic-delivery-lab\/[^/]+\/installation$/.test(route)) data = installation();
    else if (options.method === 'POST' && route === '/app/installations/163255060/access_tokens') {
      assert.deepEqual(request.body.permissions, { metadata: 'read' });
      assert.equal(request.body.repository_ids.length, 1);
      assert.equal(Number.isSafeInteger(request.body.repository_ids[0]), true, 'official API requires integer repository IDs');
      const id = request.body.repository_ids[0];
      assert.equal(targets.some(([expected]) => expected === id), true);
      data = { token: `fixture-token-${id}`, expires_at: new Date(observedNow + 3600000).toISOString(), permissions: { metadata: 'read' }, repositories: [repository(id)] };
    } else if (options.method === 'GET' && route === '/installation/repositories?per_page=2') {
      const id = Number(options.headers.Authorization.match(/fixture-token-(\d+)$/)?.[1]);
      data = { total_count: 1, repositories: [repository(id)] };
    } else if (options.method === 'DELETE' && route === '/installation/token') return new Response(null, { status: 204 });
    else throw new Error(`Unexpected audit request ${options.method} ${route}`);
    const changed = change(request, data);
    if (changed instanceof Response) return changed;
    return new Response(JSON.stringify(changed), { status: request.method === 'POST' ? 201 : 200 });
  };
  const collect = overrides => collectGithubAppCoverage({
    env: environment(), fetchImpl, now: () => observedNow, monotonic: () => 0,
    getSourceCommit: async () => sourceCommit, ...overrides,
  });
  return { calls, collect };
}

test('audit verifies seven native identities using single-repository metadata tokens and confirmed revocation', async () => {
  const { calls, collect } = harness();
  const report = await collect();
  assert.equal(report.currentFactorySetCoverageVerified, true);
  assert.equal(report.allRepositoriesSelected, false);
  assert.equal(report.installationTokenCleanupConfirmed, true);
  assert.equal(report.repositoryMutationsRequested, false);
  assert.equal(report.runtimeAdmissionAuthorized, false);
  assert.equal(report.source.commit, sourceCommit);
  assert.equal(report.source.issue, 60);
  assert.deepEqual(report.repositories.map(row => row.repositoryId).sort(), targets.map(([id]) => id).sort());
  assert.equal(report.repositories.every(row => row.status === 'verified' && row.installationTokenRevoked === true), true);
  assert.equal(calls.filter(call => call.method === 'POST').length, 7);
  assert.equal(calls.filter(call => call.method === 'DELETE').length, 7);
  assert.equal(calls.length, 29);
  assert.equal(calls.every(call => call.options.redirect === 'error' && call.options.signal instanceof AbortSignal), true);
  assert.equal(JSON.stringify(report).includes('fixture-token'), false);
  assert.equal(JSON.stringify(report).includes(key), false);
});

test('audit distinguishes current all-selection metadata from coverage and runtime admission', async () => {
  const { collect } = harness({ change: (_request, data) => data.app_id ? { ...data, repository_selection: 'all' } : data });
  const report = await collect();
  assert.equal(report.allRepositoriesSelected, true);
  assert.equal(report.currentFactorySetCoverageVerified, true);
  assert.equal(report.runtimeAdmissionAuthorized, false);
});

test('audit rejects foreign actors, repositories, refs and event types before using credentials or making requests', async () => {
  for (const overrides of [{ GITHUB_ACTOR_ID: '2' }, { GITHUB_REPOSITORY_ID: '2' }, { GITHUB_REPOSITORY: 'attacker/repo' }, { GITHUB_REF: 'refs/heads/feature' }, { GITHUB_EVENT_NAME: 'pull_request' }, { GITHUB_ACTIONS: 'false' }, { GITHUB_TRIGGERING_ACTOR: 'other-writer' }]) {
    const { calls, collect } = harness();
    const env = environment(overrides);
    Object.defineProperty(env, 'CODEX_DELIVERY_APP_PRIVATE_KEY', { get() { throw new Error('credentials accessed before owner/source validation'); } });
    await assert.rejects(collect({ env }), /owner-only/);
    assert.equal(calls.length, 0);
  }
});

test('audit rejects a source commit or configured App identity mismatch before API access', async () => {
  for (const overrides of [{ getSourceCommit: async () => 'b'.repeat(40) }, { env: environment({ APP_COVERAGE_SOURCE_COMMIT: 'b'.repeat(40) }) }, { env: environment({ CODEX_DELIVERY_APP_ID: '2' }) }, { env: environment({ CODEX_DELIVERY_APP_INSTALLATION_ID: '2' }) }]) {
    const { calls, collect } = harness();
    await assert.rejects(collect(overrides), /source|App configuration/);
    assert.equal(calls.length, 0);
  }
});

test('audit holds unexpected installation identity, organization, selection and suspension before any token mint', async () => {
  for (const change of [data => ({ ...data, app_id: 2 }), data => ({ ...data, id: 2 }), data => ({ ...data, account: { ...data.account, id: 2 } }), data => ({ ...data, repository_selection: 'unknown' }), data => ({ ...data, suspended_at: '2026-10-29T10:00:00Z' }), data => ({ ...data, permissions: {} })]) {
    const { calls, collect } = harness({ change: (_request, data) => data.app_id ? change(data) : data });
    const report = await collect();
    assert.equal(report.currentFactorySetCoverageVerified, false);
    assert.equal(calls.some(call => call.method === 'POST'), false);
    assert.equal(report.runtimeAdmissionAuthorized, false);
  }
});

test('audit records an unavailable repository without inferring absence or stopping unrelated safe lookups', async () => {
  const { calls, collect } = harness({ change: (request, data) => request.route === '/repos/agentic-delivery-lab/agentic-delivery-requirements/installation' ? new Response('{}', { status: 404 }) : data });
  const report = await collect();
  assert.equal(report.currentFactorySetCoverageVerified, false);
  assert.equal(report.repositories.filter(row => row.status === 'verified').length, 6);
  assert.equal(report.repositories.find(row => row.repositoryId === 1416207421).status, 'unverified');
  assert.equal(calls.filter(call => call.method === 'POST').length, 6);
  assert.equal(report.installationTokenCleanupConfirmed, true);
});

test('audit cancels unread HTTP error bodies before continuing safe repository lookups', async () => {
  let cancelled = false;
  const { collect } = harness({ change: (request, data) => request.route === '/repos/agentic-delivery-lab/agentic-delivery/installation'
    ? new Response(new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode('untrusted error body')); }, cancel() { cancelled = true; } }), { status: 404 })
    : data });
  const report = await collect();
  assert.equal(cancelled, true);
  assert.equal(report.repositories[0].reason, 'github-http-404');
  assert.equal(report.repositories.filter(row => row.status === 'verified').length, 6);
  assert.equal(report.installationTokenCleanupConfirmed, true);
});

test('audit rejects extra token permissions and revokes the known token before repository use or another mint', async () => {
  const { calls, collect } = harness({ change: (request, data) => request.method === 'POST' ? { ...data, permissions: { metadata: 'read', contents: 'write' } } : data });
  const report = await collect();
  assert.equal(report.currentFactorySetCoverageVerified, false);
  assert.equal(report.installationTokenCleanupConfirmed, true);
  assert.equal(calls.filter(call => call.method === 'POST').length, 1);
  assert.equal(calls.filter(call => call.method === 'DELETE').length, 1);
  assert.equal(calls.some(call => call.route.startsWith('/installation/repositories')), false);
});

test('audit rejects widened, missing, renamed or substituted repository identities and cleans up', async () => {
  for (const change of [data => ({ total_count: 2, repositories: [...data.repositories, repository(1380894616)] }), data => ({ total_count: 1, repositories: [] }), data => ({ ...data, repositories: [{ ...data.repositories[0], id: 2 }] }), data => ({ ...data, repositories: [{ ...data.repositories[0], full_name: 'attacker/repo' }] })]) {
    const { calls, collect } = harness({ change: (request, data) => request.route.startsWith('/installation/repositories') ? change(data) : data });
    const report = await collect();
    assert.equal(report.currentFactorySetCoverageVerified, false);
    assert.equal(report.installationTokenCleanupConfirmed, true);
    assert.equal(calls.filter(call => call.method === 'POST').length, 1);
    assert.equal(calls.filter(call => call.method === 'DELETE').length, 1);
  }
});

test('audit preserves cleanup for malformed successful token metadata', async () => {
  const { calls, collect } = harness({ change: (request, data) => request.method === 'POST' ? { ...data, expires_at: 'invalid' } : data });
  const report = await collect();
  assert.equal(report.currentFactorySetCoverageVerified, false);
  assert.equal(report.installationTokenCleanupConfirmed, true);
  assert.equal(calls.filter(call => call.method === 'DELETE').length, 1);
});

test('audit stops all later issuance after uncertain mint or revocation and does not leak diagnostics', async () => {
  for (const method of ['POST', 'DELETE']) {
    const { calls, collect } = harness({ fail: request => request.method === method });
    const report = await collect();
    assert.equal(report.currentFactorySetCoverageVerified, false);
    assert.equal(report.installationTokenCleanupConfirmed, false);
    assert.equal(calls.filter(call => call.method === 'POST').length, 1);
    assert.equal(JSON.stringify(report).includes('fixture-token'), false);
    assert.equal(JSON.stringify(report).includes(key), false);
  }
});

test('audit preserves the issuance HTTP failure separately from unconfirmed cleanup', async () => {
  const { calls, collect } = harness({ change: (request, data) => request.method === 'POST' ? new Response('{}', { status: 422 }) : data });
  const report = await collect();
  assert.equal(report.currentFactorySetCoverageVerified, false);
  assert.equal(report.installationTokenCleanupConfirmed, false);
  assert.equal(report.repositories[0].reason, 'github-http-422');
  assert.equal(report.repositories[0].cleanupReason, 'installation-token-cleanup-unconfirmed');
  assert.equal(calls.filter(call => call.method === 'POST').length, 1);
});

test('audit stops requests when its execution allowance expires', async () => {
  const { calls, collect } = harness();
  let ticks = -180001;
  const report = await collect({ monotonic: () => (ticks += 180001) });
  assert.equal(report.currentFactorySetCoverageVerified, false);
  assert.equal(calls.length, 0);
});

test('audit cancels oversized response bodies and revokes the known token before stopping', async () => {
  let cancelled = false;
  const { calls, collect } = harness({ change: (request, data) => request.route.startsWith('/installation/repositories')
    ? new Response(new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(1024 * 1024 + 1)); }, cancel() { cancelled = true; } }))
    : data });
  const report = await collect();
  assert.equal(report.currentFactorySetCoverageVerified, false);
  assert.equal(report.installationTokenCleanupConfirmed, true);
  assert.equal(cancelled, true);
  assert.equal(calls.filter(call => call.method === 'POST').length, 1);
  assert.equal(calls.filter(call => call.method === 'DELETE').length, 1);
});

test('existing inventory command rejects App mode outside the owner workflow without falling back to gh', () => {
  const result = spawnSync(process.execPath, ['scripts/collect-github-inventory.mjs', '--app-coverage'], {
    cwd: new URL('../..', import.meta.url), encoding: 'utf8',
    env: { ...process.env, GITHUB_ACTIONS: 'false', GH_TOKEN: '', GITHUB_TOKEN: '', PATH: '' },
  });
  assert.equal(result.status, 1);
  assert.equal(result.stdout, '');
  assert.match(result.stderr, /owner-only trusted main workflow/);
});

test('missing option values cannot consume the App-mode flag and fall back to OAuth inventory', () => {
  for (const flag of ['--org', '--output']) {
    const result = spawnSync(process.execPath, ['scripts/collect-github-inventory.mjs', flag, '--app-coverage'], {
      cwd: new URL('../..', import.meta.url), encoding: 'utf8',
      env: { ...process.env, GITHUB_ACTIONS: 'false', GH_TOKEN: '', GITHUB_TOKEN: '', PATH: '' },
    });
    assert.equal(result.status, 2);
    assert.match(result.stderr, /requires a value/);
    assert.equal(result.stdout, '');
  }
});

test('owner audit workflow binds the native actor, rerun actor and immutable source without model or write permissions', async () => {
  const source = await readFile(new URL('../../.github/workflows/github-app-coverage.yml', import.meta.url), 'utf8');
  const workflow = parseRepositoryYaml(source, 'App coverage workflow');
  assert.deepEqual(Object.keys(workflow.on), ['workflow_dispatch']);
  assert.equal(workflow.on.workflow_dispatch.inputs.source_commit.required, true);
  assert.deepEqual(workflow.permissions, { contents: 'read' });
  const job = workflow.jobs.observe;
  assert.equal(job['runs-on'], 'ubuntu-latest');
  assert.match(job.if, /github\.actor_id == '14937399'/);
  assert.match(job.if, /github\.repository_id == '1358455028'/);
  assert.match(job.if, /github\.triggering_actor == github\.actor/);
  assert.match(job.if, /github\.ref == 'refs\/heads\/main'/);
  assert.match(job.if, /inputs\.source_commit == github\.sha/);
  const checkout = job.steps.find(step => step.uses?.startsWith('actions/checkout@'));
  assert.equal(checkout.with.ref, '${{ github.sha }}');
  assert.equal(checkout.with['persist-credentials'], false);
  assert.equal(job.steps.filter(step => /CODEX_DELIVERY_APP_PRIVATE_KEY/.test(JSON.stringify(step))).length, 1);
  assert.equal(job.steps.at(-1).run, 'node scripts/collect-github-inventory.mjs --app-coverage');
  assert.equal(job.steps.at(-1).env.APP_COVERAGE_SOURCE_COMMIT, '${{ inputs.source_commit }}');
  assert.equal(/secrets:\s*inherit|codex-preflight|codex-delivery\.mjs/.test(source), false);
});
