import assert from 'node:assert/strict';
import { test } from 'node:test';
import path from 'node:path';
import { rm } from 'node:fs/promises';
import { CodexClient, quotaBoundary, quotaTelemetryUnavailable, formatQuotaDiagnostics, verifyModels, modelEnvironment, deliveryPermissions, checkConfiguration, AUTH_STORAGE_CONFIG, DEFAULT_PERMISSION_CONFIG, appServerFailure } from '../../scripts/lib/codex-client.mjs';

const now = 1_800_000_000;
const window = (usedPercent, windowDurationMins = 300) => ({ usedPercent, windowDurationMins, resetsAt: now + 100 });
const quota = (used = 30, weekly = 20) => ({ rateLimits: { limitId: 'codex', credits:{hasCredits:false,unlimited:false}, primary: window(used), secondary: window(weekly, 10080) } });

test('leaves a small finalization reserve in both usage windows', () => {
  assert.equal(quotaBoundary(quota(97), now).stop, false);
  assert.equal(quotaBoundary(quota(98), now).stop, true);
  assert.equal(quotaBoundary(quota(20, 98), now).stop, true);
  assert.equal(quotaBoundary(quota(100), now).resetsAt, now + 100);
  const weeklyLimit = quotaBoundary(quota(24, 98), now);
  assert.deepEqual(weeklyLimit.windows.map(({ bucketIndex, slot, durationMinutes, usedPercent }) => (
    { bucketIndex, slot, durationMinutes, usedPercent }
  )), [
    { bucketIndex: 1, slot: 'primary', durationMinutes: 300, usedPercent: 24 },
    { bucketIndex: 1, slot: 'secondary', durationMinutes: 10_080, usedPercent: 98 },
  ]);
  assert.deepEqual(weeklyLimit.guardSignals, {
    windowThresholdReached: true,
    rateLimitReached: false,
    spendControlReached: false,
  });
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
  const serverLimited = quota(24, 62);
  serverLimited.rateLimits.rateLimitReachedType = 'secondary';
  const result = quotaBoundary(serverLimited, now);
  assert.equal(result.usedPercent, 62);
  assert.deepEqual(result.guardSignals, {
    windowThresholdReached: false,
    rateLimitReached: true,
    spendControlReached: false,
  });
});

test('formats sanitized per-window quota details for runner logs', () => {
  const diagnostics = formatQuotaDiagnostics(quotaBoundary(quota(24, 98), now));
  assert.match(diagnostics, /stop reason window_reserve/);
  assert.match(diagnostics, /highest-window usage 98%/);
  assert.match(diagnostics, /bucket 1 primary: 300m at 24%, resets 2027-/);
  assert.match(diagnostics, /bucket 1 secondary: 10080m at 98%, resets 2027-/);
  assert.match(diagnostics, /window threshold=true; rate-limit=false; spend-control=false/);
  assert.doesNotMatch(diagnostics, /codex|limitId/i);
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
    {id:'gpt-6-sol', model:'gpt-6-sol', supportedReasoningEfforts:[{reasoningEffort:'high'}]},
    {id:'gpt-6-luna', model:'gpt-6-luna', supportedReasoningEfforts:[{reasoningEffort:'medium'}]},
    {id:'gpt-6-luna-catalog-entry', model:'gpt-6-luna', supportedReasoningEfforts:[{reasoningEffort:'low'},{reasoningEffort:'max'}]},
  ];
  verifyModels(models);
  assert.throws(() => verifyModels(models.slice(0, 1)), /gpt-6-luna/);
  models[2].supportedReasoningEfforts = [{reasoningEffort:'low'}];
  assert.throws(() => verifyModels(models), /gpt-6-luna\/max/);
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


test('invalid finite quota metrics never trigger a usage reserve or enter usage summaries', () => {
  const invalidCases = [
    (value) => { value.rateLimits.primary.usedPercent = 101; },
    (value) => { value.rateLimits.primary.windowDurationMins = 0; },
    (value) => { value.rateLimits.primary.resetsAt = -1; },
  ];
  for (const makeInvalid of invalidCases) {
    const value = quota(99, 20);
    makeInvalid(value);
    const decision = quotaBoundary(value, now);
    assert.equal(decision.stop, true);
    assert.equal(decision.reasonCode, 'missing_or_invalid_window');
    assert.deepEqual(decision.diagnostics.triggerReasons, ['missing_or_invalid_window']);
    assert.equal(decision.diagnostics.triggeringWindows.some((item) => item.valid), false);
    assert.equal(decision.usedPercent, 20, 'only valid windows contribute to the usage summary');
    assert.equal(decision.resetsAt, null, 'invalid telemetry cannot supply a retry time');
  }
});

test('fails closed when a returned secondary quota window is malformed', () => {
  for (const malformed of ['malformed-window', false, 0, '']) {
    const value = quota();
    value.rateLimits.secondary = malformed;
    const decision = quotaBoundary(value, now);
    assert.equal(decision.stop, true, `secondary=${JSON.stringify(malformed)}`);
    assert.equal(decision.reasonCode, 'invalid_bucket');
    assert.deepEqual(decision.diagnostics.windows.find((item) => item.slot === 'secondary'), {
      bucket: 'bucket-1', slot: 'secondary', usedPercent: null, windowDurationMins: null, resetsAt: null, valid: false,
    });
  }
  const optional = quota();
  optional.rateLimits.secondary = null;
  assert.equal(quotaBoundary(optional, now).stop, false, 'the protocol declares secondary nullable');
  delete optional.rateLimits.secondary;
  assert.equal(quotaBoundary(optional, now).stop, false, 'secondary may also be absent');
});

test('quota decisions identify triggering windows and expose only sanitized diagnostics', () => {
  const value = quota();
  value.rateLimitsByLimitId = {
    codex: JSON.parse(JSON.stringify(value.rateLimits)),
    other: {
      credits: { hasCredits: false, unlimited: false },
      primary: window(99, 60),
      rateLimitReachedType: 'provider-detail-must-not-be-published',
    },
    'refresh-token.fixture-secret': {
      credits: { hasCredits: false, unlimited: false },
      primary: window(12, 300),
    },
  };
  value.accountId = 'private-account-id';

  const decision = quotaBoundary(value, now);

  assert.equal(decision.reasonCode, 'window_reserve');
  assert.deepEqual(decision.diagnostics.triggerReasons, ['window_reserve', 'server_rate_limit']);
  assert.deepEqual(decision.diagnostics.triggeringWindows, [{
    bucket: 'bucket-2', slot: 'primary', usedPercent: 99, windowDurationMins: 60, resetsAt: now + 100, valid: true,
  }]);
  assert.equal(decision.diagnostics.nextEligibleAt, null, 'a server block has no known reset time');
  assert.equal(decision.diagnostics.windows.length, 4, 'the legacy mirror is not reported as a duplicate bucket');
  assert.equal(decision.diagnostics.serverBlocks[1].rateLimitReached, true);
  assert.doesNotMatch(JSON.stringify(decision), /provider-detail|fixture-secret|private-account-id/);
});

test('checks a distinct legacy quota window alongside the keyed map', () => {
  const value = quota(99, 20);
  value.rateLimits.limitId = 'legacy-extra';
  value.rateLimitsByLimitId = {
    mapped: {
      limitId: 'mapped',
      credits: { hasCredits: false, unlimited: false },
      primary: window(20),
      secondary: window(30, 10080),
    },
  };
  const decision = quotaBoundary(value, now);
  assert.equal(decision.stop, true);
  assert.equal(decision.diagnostics.triggeringWindows[0].bucket, 'bucket-2');
  assert.equal(decision.diagnostics.triggeringWindows[0].usedPercent, 99);
});

test('checks divergent legacy quota data even when its limit ID matches the keyed map', () => {
  const value = quota(99, 20);
  value.rateLimitsByLimitId = {
    codex: {
      limitId: 'codex',
      credits: { hasCredits: false, unlimited: false },
      primary: window(20),
      secondary: window(20, 10080),
    },
  };
  const decision = quotaBoundary(value, now);
  assert.equal(decision.stop, true);
  assert.deepEqual(decision.diagnostics.triggeringWindows[0], {
    bucket: 'bucket-2', slot: 'primary', usedPercent: 99, windowDurationMins: 300, resetsAt: now + 100, valid: true,
  });
});

test('quota reason codes distinguish credit, server-rate, and spend-control stops', () => {
  const credit = quota();
  credit.rateLimits.credits.hasCredits = true;
  assert.equal(quotaBoundary(credit, now).reasonCode, 'credit_spillover');

  const unlimited = quota();
  unlimited.rateLimits.credits.unlimited = true;
  assert.equal(quotaBoundary(unlimited, now).reasonCode, 'unlimited_credits');

  const unknownCredits = quota();
  unknownCredits.rateLimits.credits = {};
  assert.equal(quotaBoundary(unknownCredits, now).reasonCode, 'credit_telemetry_unavailable');

  const rateLimited = quota(70, 80);
  rateLimited.rateLimits.rateLimitReachedType = 'private-provider-detail';
  const rateLimitDecision = quotaBoundary(rateLimited, now);
  assert.equal(rateLimitDecision.reasonCode, 'server_rate_limit');
  assert.deepEqual(rateLimitDecision.diagnostics.triggerReasons, ['server_rate_limit']);
  assert.equal(rateLimitDecision.diagnostics.nextEligibleAt, null);

  const spendControlled = quota(70, 80);
  spendControlled.rateLimits.spendControlReached = true;
  const spendDecision = quotaBoundary(spendControlled, now);
  assert.equal(spendDecision.reasonCode, 'spend_control');
  assert.deepEqual(spendDecision.diagnostics.triggerReasons, ['spend_control']);
});

test('quota diagnostics retain credit, window, and server causes when they occur together', () => {
  const mixed = quota(99, 20);
  mixed.rateLimits.credits.hasCredits = true;
  mixed.rateLimits.rateLimitReachedType = 'provider-detail-must-not-be-published';

  const decision = quotaBoundary(mixed, now);

  assert.equal(decision.stop, true);
  assert.equal(decision.reasonCode, 'credit_spillover', 'the existing credit-first primary reason remains stable');
  assert.deepEqual(decision.diagnostics.triggerReasons, ['credit_spillover', 'window_reserve', 'server_rate_limit']);
  assert.deepEqual(decision.diagnostics.triggeringWindows, [{
    bucket: 'bucket-1', slot: 'primary', usedPercent: 99, windowDurationMins: 300, resetsAt: now + 100, valid: true,
  }]);
  assert.equal(decision.diagnostics.serverBlocks[0].rateLimitReached, true);
  assert.equal(decision.diagnostics.nextEligibleAt, null, 'a reset is not a retry time while other causes remain');
  assert.equal(decision.resetsAt, null);
});

test('capability preflight converts quota-read failures to a safe pause', async () => {
  const client = Object.create(CodexClient.prototype);
  client.request = async (method) => {
    if (method === 'account/read') return {account:{type:'chatgpt'}};
    if (method === 'model/list') return {data:[
      {id:'gpt-6-sol',supportedReasoningEfforts:[{reasoningEffort:'high'}]},
      {id:'gpt-6-luna',supportedReasoningEfforts:[{reasoningEffort:'low'},{reasoningEffort:'medium'},{reasoningEffort:'max'}]},
    ]};
    if (method === 'collaborationMode/list') return {data:[{mode:'plan'}]};
    if (method === 'account/rateLimits/read') throw new Error('account token fixture-secret');
    assert.fail(`unexpected request: ${method}`);
  };
  const result = await client.capabilities();
  assert.deepEqual(result, quotaTelemetryUnavailable());
  assert.doesNotMatch(JSON.stringify(result), /fixture-secret|account token/);
});