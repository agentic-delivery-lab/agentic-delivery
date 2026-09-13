import assert from 'node:assert/strict';
import { test } from 'node:test';
import path from 'node:path';
import { rm } from 'node:fs/promises';
import { CodexClient, quotaBoundary, verifyModels, modelEnvironment, deliveryPermissions, checkConfiguration, AUTH_STORAGE_CONFIG, DEFAULT_PERMISSION_CONFIG, appServerFailure } from '../../scripts/lib/codex-client.mjs';

const now = 1_800_000_000;
const window = (usedPercent, windowDurationMins = 300) => ({ usedPercent, windowDurationMins, resetsAt: now + 100 });
const quota = (used = 30, weekly = 20) => ({ rateLimits: { limitId: 'codex', credits:{hasCredits:false,unlimited:false}, primary: window(used), secondary: window(weekly, 10080) } });

test('leaves a small finalization reserve in both usage windows', () => {
  assert.equal(quotaBoundary(quota(97), now).stop, false);
  assert.equal(quotaBoundary(quota(98), now).stop, true);
  assert.equal(quotaBoundary(quota(20, 98), now).stop, true);
  assert.equal(quotaBoundary(quota(100), now).resetsAt, now + 100);
});

test('quota telemetry fails closed on missing, invalid, or expired windows', () => {
  for (const value of [{}, {rateLimits:{}}, quota(NaN), quota(-1), quota('20'), quota(101)]) {
    assert.equal(quotaBoundary(value, now).stop, true);
  }
  assert.equal(quotaBoundary(quota(), now + 101).stop, true);
  const value = quota();
  value.rateLimits.primary.windowDurationMins = 15;
  assert.equal(quotaBoundary(value, now).stop, true);
});

test('checks every returned bucket and explicit server limits', () => {
  const value = quota();
  value.rateLimitsByLimitId = { codex: value.rateLimits, other: { credits:{hasCredits:false,unlimited:false}, primary: window(99, 60) } };
  assert.equal(quotaBoundary(value, now).stop, true);
  assert.equal(quotaBoundary({rateLimits:{...quota().rateLimits, spendControlReached:true}}, now).stop, true);
});

test('refuses model execution when credit spillover is possible or unknown', () => {
  for (const credits of [undefined, null, {}, {hasCredits:true,unlimited:false}, {hasCredits:false,unlimited:true}]) {
    const value = quota(); value.rateLimits.credits = credits;
    assert.equal(quotaBoundary(value, now).stop, true);
    assert.match(quotaBoundary(value, now).reason, /credit/i);
  }
});

test('requires the exact requested models and reasoning efforts', () => {
  const models = [
    {id:'gpt-5.6-sol', supportedReasoningEfforts:[{reasoningEffort:'high'}]},
    {id:'gpt-5.6-luna', supportedReasoningEfforts:[{reasoningEffort:'max'}]},
  ];
  verifyModels(models);
  assert.throws(() => verifyModels(models.slice(0, 1)), /gpt-5.6-luna/);
  models[1].supportedReasoningEfforts = [{reasoningEffort:'high'}];
  assert.throws(() => verifyModels(models), /max/);
});

test('model processes do not inherit publishing, API, or Actions credentials', () => {
  const env = modelEnvironment({PATH:'/bin', HOME:'/example', GH_TOKEN:'secret', PUBLISH_TOKEN:'publish-secret', OPENAI_API_KEY:'secret', ACTIONS_RUNTIME_TOKEN:'secret', NODE_OPTIONS:'--import=/malicious.mjs'});
  assert.deepEqual(env, {PATH:'/bin'});
});

test('planning and implementation restrict reads and deny tool network access', () => {
  const profiles = deliveryPermissions();
  assert.equal(profiles['delivery-plan'].filesystem[':root'], 'deny');
  assert.equal(profiles['delivery-plan'].filesystem[':workspace_roots']['.'], 'read');
  assert.equal(profiles['delivery-edit'].filesystem[':workspace_roots']['.'], 'write');
  assert.equal(profiles['delivery-edit'].filesystem[':workspace_roots']['.git'], 'read');
  assert.deepEqual(profiles['delivery-edit'].network.domains, {'registry.npmjs.org':'deny'});
  assert.deepEqual(profiles['delivery-verify'].network.domains, {'registry.npmjs.org':'deny'});
  assert.equal(profiles['delivery-verify'].filesystem[':workspace_roots']['.'], 'read');
  assert.deepEqual(profiles['delivery-review'].network.domains, {'registry.npmjs.org':'deny'});
  assert.equal(profiles['delivery-review'].filesystem[':workspace_roots']['.'], 'read');
  assert.deepEqual(profiles['delivery-deps'].network.domains, {'registry.npmjs.org':'allow'});
  assert.equal(profiles['delivery-deps'].network.allow_local_binding, false);
});

test('tools have a private temporary home and cannot inherit Codex authentication paths', () => {
  const env = modelEnvironment({HOME:'/account', CODEX_HOME:'/auth', GH_TOKEN:'secret', PATH:'/bin'}, '/runtime');
  assert.equal(env.HOME, path.join('/runtime', 'home'));
  assert.equal(env.TMPDIR, path.join('/runtime', 'tmp'));
  assert.equal(env.CODEX_HOME, undefined);
  assert.equal(env.GH_TOKEN, undefined);
});

test('unsafe user and project configuration fails before thread startup', () => {
  checkConfiguration({});
  for (const config of [{hooks:{session_start:[]}}, {notify:['sh']}, {model_provider:'custom'},
    {model_providers:{openai:{base_url:'http://example.invalid'}}}, {chatgpt_base_url:'http://example.invalid'}]) {
    assert.throws(() => checkConfiguration(config), /configuration/);
  }
});

test('app-server diagnostics retain safe failure context without exposing credentials', () => {
  assert.equal(
    appServerFailure(1, null, 'Error: config defines [permissions] profiles but does not set default_permissions'),
    'Codex app-server stopped (1). Diagnostic: A default permission profile is required. Check the controller startup configuration.',
  );
  assert.equal(
    appServerFailure(1, null, 'no rollout found for thread id 019fb023-24b8-7881-9119-509f078b610e'),
    'Codex app-server stopped (1). Diagnostic: Codex has no persisted rollout for this thread yet.',
  );
  assert.equal(appServerFailure(null, 'SIGTERM', ''), 'Codex app-server stopped (SIGTERM).');
});

test('unrecognized diagnostics never publish raw credential-bearing text', () => {
  for (const diagnostic of [
    'access_token=fixture-secret',
    '{"access_token":"fixture-secret"}',
    '{"refresh_token": "fixture-secret", "id_token": "fixture-secret"}',
    'password: "a multi word fixture-secret"',
    'Bearer fixture-secret',
    'unlabelled fixture-secret',
    `access_token=${'x'.repeat(4500)}fixture-secret`.slice(-4000),
    'config defines [permissions] profiles but does not set default_permissions; fixture-secret',
  ]) {
    const message = appServerFailure(1, null, diagnostic);
    assert.doesNotMatch(message, /fixture-secret/);
    assert.match(message, /Check the (runner|controller)/);
  }
});

test('subprocess stderr is withheld even when chunks lose the credential label', async (t) => {
  const client = new CodexClient({ command: process.execPath, args: ['-e', `
    process.stdin.once('data', () => {
      process.stderr.write('access_token=' + 'x'.repeat(4500));
      process.stderr.write('fixture-secret', () => process.exit(1));
    });
  `, '--'] });
  t.after(async () => { await client.close(); await rm(client.runtime, {recursive:true, force:true}); });
  await assert.rejects(client.initialize(), (error) => {
    assert.match(error.message, /Codex app-server stopped \(1\)/);
    assert.doesNotMatch(error.message, /fixture-secret|x{20}/);
    return true;
  });
});

test('protocol errors use the same safe diagnostic boundary as process errors', async (t) => {
  const client = new CodexClient({ command: process.execPath, args: ['-e', `
    const { createInterface } = require('node:readline');
    createInterface({input:process.stdin}).on('line', (line) => {
      const request = JSON.parse(line);
      process.stdout.write(JSON.stringify({id:request.id, error:{
        code:-32000, message:'Authentication failed: {"refresh_token":"fixture-secret"}'
      }}) + '\\n');
    });
  `, '--'] });
  t.after(async () => { await client.close(); await rm(client.runtime, {recursive:true, force:true}); });
  await assert.rejects(client.initialize(), (error) => {
    assert.match(error.message, /Codex initialize:/);
    assert.doesNotMatch(error.message, /fixture-secret/);
    return true;
  });
});

test('headless app-server authentication uses the file-backed service credential store', () => {
  assert.equal(AUTH_STORAGE_CONFIG, 'cli_auth_credentials_store="file"');
  assert.equal(DEFAULT_PERMISSION_CONFIG, 'default_permissions="delivery-plan"');
});

test('starts persistent threads and resumes the exact UUID without a newest-session fallback', async () => {
  const calls = [];
  const fakeClient = Object.assign(Object.create(CodexClient.prototype), {
    permissions: { 'delivery-plan': {} },
    toolEnv: {},
    request: async (method, params) => {
      calls.push({method, params});
      if (method === 'config/read') return {config:{mcp_servers:{}}};
      if (method === 'thread/start') return {thread:{id:'019fb023-24b8-7881-9119-509f078b610e'}};
      if (method === 'thread/resume') return {thread:{id:'019fb023-24b8-7881-9119-509f078b610e'}};
      throw new Error(`Unexpected request: ${method}`);
    },
  });

  const started = await CodexClient.prototype.startThread.call(fakeClient, '/workspace', 'instructions');
  const resumed = await CodexClient.prototype.resumeThread.call(
    fakeClient,
    '/workspace',
    '019fb023-24b8-7881-9119-509f078b610e',
    'instructions',
  );

  assert.equal(started.thread.id, resumed.thread.id);
  assert.equal(calls[1].method, 'thread/start');
  assert.equal(calls[1].params.ephemeral, false);
  assert.equal(calls[3].method, 'thread/resume');
  assert.equal(calls[3].params.threadId, '019fb023-24b8-7881-9119-509f078b610e');
  assert.equal(calls[3].params.ephemeral, undefined);
  assert.equal(calls.filter(({method}) => method === 'thread/list').length, 0);
});

test('enables only explicitly inventoried MCP servers approved by the selected profile', async () => {
  const calls = [];
  const fakeClient = Object.assign(Object.create(CodexClient.prototype), {
    permissions: { 'delivery-research': {} },
    toolEnv: {},
    availableMcpServers: new Set(['firecrawl', 'context7']),
    approvedMcpServers: new Set(['firecrawl']),
    request: async (method, params) => {
      calls.push({ method, params });
      if (method === 'config/read') return { config: { mcp_servers: { firecrawl: {}, context7: {}, chrome: {} } } };
      throw new Error(`Unexpected request: ${method}`);
    },
  });

  const result = await CodexClient.prototype.threadConfig.call(fakeClient, '/workspace', 'instructions', 'research');

  assert.deepEqual(result.config.mcp_servers, {
    firecrawl: { enabled: true },
    context7: { enabled: false },
    chrome: { enabled: false },
  });
  assert.equal(calls[0].method, 'config/read');
});
