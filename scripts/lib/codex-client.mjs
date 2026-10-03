import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { createInterface } from 'node:readline';
import { existsSync, realpathSync, mkdirSync, mkdtempSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { isDeepStrictEqual } from 'node:util';
import { QUOTA_REASON } from './quota-diagnostics.mjs';

export const MODELS = Object.freeze({
  route: { model: 'gpt-6-luna', effort: 'low', mode: 'plan' },
  refine: { model: 'gpt-6-luna', effort: 'medium', mode: 'plan' },
  discovery: { model: 'gpt-6-luna', effort: 'medium', mode: 'plan' },
  research: { model: 'gpt-6-luna', effort: 'medium', mode: 'plan' },
  requirements: { model: 'gpt-6-luna', effort: 'medium', mode: 'plan' },
  architecture: { model: 'gpt-6-sol', effort: 'high', mode: 'plan' },
  plan: { model: 'gpt-6-sol', effort: 'high', mode: 'plan' },
  implement: { model: 'gpt-6-luna', effort: 'max', mode: 'default' },
  validate: { model: 'gpt-6-luna', effort: 'max', mode: 'default' },
  review: { model: 'gpt-6-sol', effort: 'high', mode: 'default' },
});

export const AUTH_STORAGE_CONFIG = 'cli_auth_credentials_store="file"';
export const DEFAULT_PERMISSION_CONFIG = 'default_permissions="delivery-plan"';
const SAFE_REASONING_EFFORTS = new Set(['none', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra']);
const SAFE_GPT6_IDENTIFIER = /^(?:[a-z0-9_-]+\/)?gpt-6-[a-z0-9]+(?:[._-][a-z0-9]+)*$/i;

export function modelForProfile(profile = 'planner') {
  const phase = {
    router: 'route', discovery: 'discovery', research: 'research', requirements: 'requirements',
    'architecture-decision': 'architecture', planner: 'plan', implementer: 'implement',
    validator: 'validate', coordinator: 'requirements', 'harness-reviewer': 'review',
  }[profile] ?? profile;
  return MODELS[phase] ?? MODELS.plan;
}

export function permissionForProfile(profile = 'planner') {
  return {
    router: 'delivery-plan', discovery: 'delivery-research', research: 'delivery-research',
    requirements: 'delivery-plan', 'architecture-decision': 'delivery-plan', planner: 'delivery-plan',
    implementer: 'delivery-edit', validator: 'delivery-review', coordinator: 'delivery-plan',
    'harness-reviewer': 'delivery-review',
  }[profile] ?? 'delivery-plan';
}

const CODEX_DIAGNOSTIC_HINTS = Object.freeze({
  missing_persisted_rollout: 'Codex has no persisted rollout for this thread yet.',
  default_permission_profile_missing: 'A default permission profile is required. Check the controller startup configuration.',
  workspace_routing_discovery_failed: 'workspace_routing_discovery_failed',
});

export function safeCodexDiagnosticCode(value) {
  const message = String(value);
  if (Object.hasOwn(CODEX_DIAGNOSTIC_HINTS, message)) return message;
  if (message.includes('no rollout found for thread id')) return 'missing_persisted_rollout';
  if (message.includes('config defines [permissions] profiles but does not set default_permissions')) return 'default_permission_profile_missing';
  if (message === 'workspace routing discovery failed') return 'workspace_routing_discovery_failed';
  return null;
}

export function safeCodexDiagnostic(value) {
  // Codex owns authentication. Its errors may contain arbitrary credentials,
  // including fragments whose labels were lost when stderr was truncated.
  // Publish only fixed hints, never a substring of the original diagnostic.
  const code = safeCodexDiagnosticCode(value);
  if (code) return CODEX_DIAGNOSTIC_HINTS[code];
  return 'Details withheld because Codex errors may contain credentials. Check the runner installation, authentication, and configuration.';
}

function appServerRequestError(method, serverError) {
  const error = new Error(`Codex ${method}: ${safeCodexDiagnostic(serverError?.message)}`);
  const data = serverError?.data && typeof serverError.data === 'object' && !Array.isArray(serverError.data)
    ? serverError.data
    : {};
  const codexErrorInfo = serverError?.codexErrorInfo ?? data.codexErrorInfo;
  const httpStatusCode = serverError?.httpStatusCode ?? data.httpStatusCode;
  if (codexErrorInfo !== undefined) Object.defineProperty(error, 'codexErrorInfo', {value: codexErrorInfo});
  if (httpStatusCode !== undefined) Object.defineProperty(error, 'httpStatusCode', {value: httpStatusCode});
  const codexDiagnostic = safeCodexDiagnosticCode(serverError?.message);
  if (codexDiagnostic) Object.defineProperty(error, 'codexDiagnostic', {value: codexDiagnostic});
  return error;
}

export function appServerFailure(code, signal, stderr = '') {
  const stopped = `Codex app-server stopped (${code ?? signal}).`;
  return String(stderr).trim() ? `${stopped} Diagnostic: ${safeCodexDiagnostic(stderr)}` : stopped;
}

function appServerFailureError(code, signal, stderr = '') {
  const error = new Error(appServerFailure(code, signal, stderr));
  const diagnosticCode = safeCodexDiagnosticCode(stderr);
  if (diagnosticCode) Object.defineProperty(error, 'codexDiagnostic', {value: diagnosticCode});
  return error;
}

export function quotaBoundary(response, now = Date.now() / 1000) {
  const mapped = response?.rateLimitsByLimitId;
  const mappedIsRecord = mapped == null || (typeof mapped === 'object' && !Array.isArray(mapped));
  const entries = mappedIsRecord && mapped
    ? Object.entries(mapped).map(([limitId, value]) => ({ limitId, value }))
    : [];
  if (response?.rateLimits != null) {
    const legacy = response.rateLimits;
    const legacyLimitId = typeof legacy.limitId === 'string' ? legacy.limitId : null;
    const mirrored = mappedIsRecord && entries.some(({ limitId, value }) => value === legacy
      || (legacyLimitId && (limitId === legacyLimitId || value?.limitId === legacyLimitId)
        && isDeepStrictEqual(value, legacy)));
    if (!mirrored) entries.push({ limitId: legacyLimitId ?? 'legacy', value: legacy });
  }
  const buckets = entries.map(({ value }, index) => ({ name: `bucket-${index + 1}`, value }));
  const windows = buckets.flatMap(({ name, value }) => ['primary', 'secondary'].flatMap((slot) => {
    const window = value && typeof value === 'object' ? value[slot] : null;
    if (window == null) {
      return slot === 'primary'
        ? [{ bucket: name, slot, usedPercent: null, windowDurationMins: null, resetsAt: null, valid: false }]
        : [];
    }
    if (typeof window !== 'object' || Array.isArray(window)) {
      return [{ bucket: name, slot, usedPercent: null, windowDurationMins: null, resetsAt: null, valid: false }];
    }
    const valid = Number.isFinite(window.usedPercent) && window.usedPercent >= 0 && window.usedPercent <= 100
      && Number.isFinite(window.windowDurationMins) && window.windowDurationMins > 0
      && Number.isFinite(window.resetsAt) && window.resetsAt > now;
    return [{
      bucket: name,
      slot,
      usedPercent: Number.isFinite(window.usedPercent) ? window.usedPercent : null,
      windowDurationMins: Number.isFinite(window.windowDurationMins) ? window.windowDurationMins : null,
      resetsAt: Number.isFinite(window.resetsAt) ? window.resetsAt : null,
      valid,
    }];
  }));
  const serverBlocks = buckets.map(({ name, value }) => ({
    bucket: name,
    rateLimitReached: Boolean(value?.rateLimitReachedType),
    spendControlReached: Boolean(value?.spendControlReached),
  }));
  const diagnostics = (reasonCode, triggerReasons = [], triggeringWindows = [], nextEligibleAt = null) => ({
    reasonCode,
    triggerReasons,
    windows,
    triggeringWindows,
    serverBlocks,
    nextEligibleAt,
  });
  const hasInvalidBucket = !mappedIsRecord || buckets.some(({ value }) => !value || typeof value !== 'object' || Array.isArray(value)
    || value.primary == null || typeof value.primary !== 'object' || Array.isArray(value.primary)
    || (value.secondary != null && (typeof value.secondary !== 'object' || Array.isArray(value.secondary))));
  const creditReasons = new Set();
  for (const { value } of buckets) {
    const credits = value?.credits;
    if (credits?.hasCredits === true) creditReasons.add(QUOTA_REASON.creditSpillover);
    else if (credits?.hasCredits !== false) creditReasons.add(QUOTA_REASON.creditTelemetryUnavailable);
    if (credits?.unlimited === true) creditReasons.add(QUOTA_REASON.unlimitedCredits);
    else if (credits?.unlimited !== false) creditReasons.add(QUOTA_REASON.creditTelemetryUnavailable);
  }
  const exhausted = windows.filter((window) => window.valid && window.usedPercent >= 98);
  const missingOrInvalidWindow = !windows.some((window) => window.windowDurationMins === 300) || windows.some((window) => !window.valid);
  const rateLimited = serverBlocks.some((bucket) => bucket.rateLimitReached);
  const spendControlled = serverBlocks.some((bucket) => bucket.spendControlReached);
  const triggerReasons = [
    ...(hasInvalidBucket ? [QUOTA_REASON.invalidBucket] : []),
    ...[QUOTA_REASON.creditSpillover, QUOTA_REASON.unlimitedCredits, QUOTA_REASON.creditTelemetryUnavailable]
      .filter((reasonCode) => creditReasons.has(reasonCode)),
    ...(missingOrInvalidWindow ? [QUOTA_REASON.missingOrInvalidWindow] : []),
    ...(exhausted.length ? [QUOTA_REASON.windowReserve] : []),
    ...(rateLimited ? [QUOTA_REASON.serverRateLimit] : []),
    ...(spendControlled ? [QUOTA_REASON.spendControl] : []),
  ];
  const blocked = triggerReasons.length > 0;
  const reasonCode = triggerReasons[0] ?? QUOTA_REASON.available;
  const reasons = {
    [QUOTA_REASON.invalidBucket]: 'Quota telemetry contains an invalid bucket.',
    [QUOTA_REASON.creditSpillover]: 'Spendable credits are available; subscription-only execution is required.',
    [QUOTA_REASON.unlimitedCredits]: 'Unlimited credits are available; subscription-only execution is required.',
    [QUOTA_REASON.creditTelemetryUnavailable]: 'Credit telemetry is missing or incomplete; subscription-only execution is required.',
    [QUOTA_REASON.missingOrInvalidWindow]: 'Quota telemetry is missing, invalid, or expired.',
    [QUOTA_REASON.windowReserve]: 'Codex allowance reached the finalization reserve.',
    [QUOTA_REASON.serverRateLimit]: 'The server reported a rate limit.',
    [QUOTA_REASON.spendControl]: 'The server reported a spend-control block.',
    [QUOTA_REASON.available]: 'Allowance available.',
  };
  const nextEligibleAt = exhausted.length && triggerReasons.length === 1 && triggerReasons[0] === QUOTA_REASON.windowReserve
    ? Math.max(...exhausted.map((window) => window.resetsAt))
    : null;
  const triggeringWindows = [
    ...exhausted,
    ...(missingOrInvalidWindow ? windows.filter((window) => !window.valid) : []),
  ];
  const validWindows = windows.filter((window) => window.valid);
  return {
    stop: blocked,
    reasonCode,
    reason: reasons[reasonCode],
    usedPercent: validWindows.length ? Math.max(...validWindows.map((window) => window.usedPercent)) : null,
    resetsAt: blocked ? nextEligibleAt : Math.max(...windows.map((window) => window.resetsAt)),
    windows: windows.filter((window) => window.valid).map((window) => ({
      bucketIndex: Number(window.bucket.slice('bucket-'.length)),
      slot: window.slot,
      durationMinutes: window.windowDurationMins,
      usedPercent: window.usedPercent,
      resetsAt: window.resetsAt,
    })),
    guardSignals: {
      windowThresholdReached: triggerReasons.includes(QUOTA_REASON.windowReserve),
      rateLimitReached: rateLimited,
      spendControlReached: spendControlled,
    },
    diagnostics: diagnostics(reasonCode, triggerReasons, triggeringWindows, nextEligibleAt),
  };
}

export function quotaTelemetryUnavailable() {
  const diagnostics = {
    reasonCode: QUOTA_REASON.telemetryUnavailable,
    triggerReasons: [QUOTA_REASON.telemetryUnavailable],
    windows: [],
    triggeringWindows: [],
    serverBlocks: [],
    nextEligibleAt: null,
  };
  return {
    stop: true,
    reasonCode: QUOTA_REASON.telemetryUnavailable,
    reason: 'Quota telemetry is unavailable.',
    diagnostics,
  };
}

export function formatQuotaDiagnostics(quota) {
  const windows = Array.isArray(quota?.windows)
    ? quota.windows.filter((window) => Number.isSafeInteger(window.bucketIndex)
      && ['primary', 'secondary'].includes(window.slot)
      && Number.isFinite(window.durationMinutes) && window.durationMinutes > 0
      && Number.isFinite(window.usedPercent) && window.usedPercent >= 0 && window.usedPercent <= 100
      && Number.isFinite(window.resetsAt))
    : [];
  const describeWindow = (window) => {
    const reset = new Date(window.resetsAt * 1000);
    const resetsAt = Number.isNaN(reset.getTime()) ? 'invalid' : reset.toISOString();
    return `bucket ${window.bucketIndex} ${window.slot}: ${window.durationMinutes}m at ${window.usedPercent}%, resets ${resetsAt}`;
  };
  const usage = Number.isFinite(quota?.usedPercent)
    ? `${quota.usedPercent}%`
    : Number.isFinite(quota?.highestWindowUsedPercent) ? `${quota.highestWindowUsedPercent}%` : 'unavailable';
  const guardSignals = quota?.guardSignals
    && ['windowThresholdReached', 'rateLimitReached', 'spendControlReached']
      .every((key) => typeof quota.guardSignals[key] === 'boolean')
    ? `window threshold=${quota.guardSignals.windowThresholdReached}; rate-limit=${quota.guardSignals.rateLimitReached}; spend-control=${quota.guardSignals.spendControlReached}`
    : 'unavailable';
  const reason = Object.values(QUOTA_REASON).includes(quota?.reasonCode) ? quota.reasonCode : 'unavailable';
  return `Quota diagnostics: stop reason ${reason}; highest-window usage ${usage}; windows ${windows.length ? windows.map(describeWindow).join('; ') : 'unavailable'}; guards ${guardSignals}.`;
}


export function verifyModels(models) {
  const requiredPairs = [...new Map(Object.values(MODELS).map(({ model, effort }) => [
    `${model}/${effort}`,
    { model, effort },
  ])).values()];
  const requiredModels = [...new Set(requiredPairs.map(({ model }) => model))];
  const catalogProfiles = requiredModels.map((model) => {
    // Check every exact model-list identifier; a first match may not carry all advertised efforts.
    const matchingEntries = models.filter((item) => item.model === model || item.id === model);
    const efforts = [...new Set(matchingEntries.flatMap((entry) => (
      entry.supportedReasoningEfforts
        ?.map((option) => option.reasoningEffort)
        .filter((effort) => SAFE_REASONING_EFFORTS.has(effort)) ?? []
    )))].sort();
    return { model, entries: matchingEntries.length, efforts };
  });
  const missingPairs = requiredPairs.filter(({ model, effort }) => (
    !catalogProfiles.find((profile) => profile.model === model)?.efforts.includes(effort)
  ));
  if (missingPairs.length > 0) {
    const summary = catalogProfiles.map(({ model, entries, efforts }) => (
      `${model}[entries=${entries},efforts=${efforts.join(',') || 'unlisted'}]`
    )).join(' | ');
    const advertisedGpt6Identifiers = [...new Set(models.flatMap((item) => [item.id, item.model]
      .filter((identifier) => typeof identifier === 'string' && identifier.length <= 120 && SAFE_GPT6_IDENTIFIER.test(identifier))
      .map((identifier) => identifier.toLowerCase())))].sort();
    throw new Error(
      `Codex model catalog is missing selected model-effort pairs: ${missingPairs.map(({ model, effort }) => `${model}/${effort}`).join(', ')}; catalog profiles: ${summary}; catalog total entries=${models.length}; advertised GPT-6 identifiers: ${advertisedGpt6Identifiers.slice(0, 20).join(', ') || 'none'}; no fallback is allowed.`,
    );
  }
}

function serverEnvironment(env = process.env) {
  const allowed = ['PATH', 'HOME', 'USER', 'LOGNAME', 'LANG', 'LC_ALL', 'TMPDIR', 'TEMP', 'TMP', 'CODEX_HOME', 'PNPM_HOME', 'SystemRoot'];
  return Object.fromEntries(allowed.filter((key) => env[key] !== undefined).map((key) => [key, env[key]]));
}

export function modelEnvironment(env = process.env, runtime) {
  const clean = serverEnvironment(env);
  for (const key of ['HOME', 'CODEX_HOME', 'TMPDIR', 'TEMP', 'TMP']) delete clean[key];
  return { ...clean, ...(runtime ? {
    HOME: path.join(runtime, 'home'), TMPDIR: path.join(runtime, 'tmp'),
    TEMP: path.join(runtime, 'tmp'), TMP: path.join(runtime, 'tmp'),
    XDG_CACHE_HOME: path.join(runtime, 'cache'), XDG_DATA_HOME: path.join(runtime, 'data'),
  } : {}) };
}

export function checkConfiguration(config) {
  for (const key of ['hooks', 'notify', 'model_instructions_file', 'experimental_compact_prompt_file',
    'openai_base_url', 'experimental_realtime_ws_base_url']) {
    if (config[key] != null && (!Array.isArray(config[key]) || config[key].length)) {
      throw new Error(`Unsafe Codex configuration: ${key}. Use a dedicated delivery login/configuration.`);
    }
  }
  if (config.chatgpt_base_url && !['https://chatgpt.com/backend-api/', 'https://chatgpt.com/backend-api'].includes(config.chatgpt_base_url)) {
    throw new Error('Custom ChatGPT endpoint configuration is not allowed for delivery.');
  }
  if ((config.model_provider && config.model_provider !== 'openai') || Object.keys(config.model_providers ?? {}).length) {
    throw new Error('Custom provider configuration is not allowed for delivery.');
  }
}

function runtimeFiles(env) {
  const files = [process.execPath];
  // On systemd hosts resolv.conf points outside the minimal /etc view.
  // Grant only this public resolver file and its canonical target.
  if (existsSync('/etc/resolv.conf')) files.push(realpathSync('/etc/resolv.conf'));
  if (env.PNPM_HOME) files.push(env.PNPM_HOME);
  for (const tool of ['codex', 'node', 'pnpm']) {
    const candidate = (env.PATH ?? '').split(path.delimiter).map((dir) => path.join(dir, tool)).find(existsSync);
    if (candidate) files.push(candidate, realpathSync(candidate));
  }
  return [...new Set(files)];
}

export function deliveryPermissions(readableFiles = [], runtime) {
  return Object.fromEntries(['plan', 'research', 'edit', 'verify', 'deps', 'review'].map((phase) => [`delivery-${phase}`, {
    extends: ':read-only',
    filesystem: {
      ':root': 'deny', ':minimal': 'read',
      ...Object.fromEntries(readableFiles.map((file) => [file, 'read'])),
      ...(runtime ? {[runtime]: 'write'} : {}),
      ':workspace_roots': { '.': ['plan', 'research', 'verify', 'review'].includes(phase) ? 'read' : 'write', '.git': 'read', '.codex': 'read' },
    },
    // A deny-all managed proxy preserves process-local IPC in the isolated
    // network namespace. The plain network=false seccomp mode blocks Node's
    // child-process socket operations (including captured stderr).
    network: {
      enabled: true, domains: {'registry.npmjs.org': phase === 'deps' ? 'allow' : 'deny'},
      allow_local_binding: false, allow_upstream_proxy: false,
    },
  }]));
}

function tomlValue(value) {
  if (typeof value !== 'object') return JSON.stringify(value);
  return `{ ${Object.entries(value).map(([key, child]) => `${JSON.stringify(key)} = ${tomlValue(child)}`).join(', ')} }`;
}

export class CodexClient extends EventEmitter {
  constructor({ command = 'codex', args = [], cwd, env = serverEnvironment(), runtime, readableFiles = [], timeoutMs = 30_000, approvedMcpServers = [] } = {}) {
    super();
    this.pending = new Map();
    this.nextId = 0;
    this.timeoutMs = timeoutMs;
    this.availableMcpServers = new Set(String(env.CODEX_MCP_SERVERS ?? '').split(',').map((name) => name.trim()).filter(Boolean));
    this.approvedMcpServers = new Set((Array.isArray(approvedMcpServers) ? approvedMcpServers : []).filter((name) => typeof name === 'string' && name.trim()));
    this.runtime = runtime ?? mkdtempSync(path.join(tmpdir(), 'codex-delivery-tools-'));
    for (const dir of ['home', 'tmp', 'cache', 'data']) mkdirSync(path.join(this.runtime, dir), {recursive:true, mode:0o700});
    this.processEnv = serverEnvironment(env);
    this.toolEnv = modelEnvironment(this.processEnv, this.runtime);
    this.permissions = deliveryPermissions([...runtimeFiles(this.processEnv), ...readableFiles], this.runtime);
    this.stderr = '';
    this.child = spawn(command, [...args, '-c', AUTH_STORAGE_CONFIG, '-c', DEFAULT_PERMISSION_CONFIG,
      '-c', `permissions=${tomlValue(this.permissions)}`,
      '-c', `shell_environment_policy=${tomlValue({inherit:'none', set:this.toolEnv})}`,
      '-c', 'allow_login_shell=false', '-c', 'features.plugins=false', '-c', 'features.apps=false',
      '-c', 'features.network_proxy=true',
      '-c', 'features.remote_plugin=false', 'app-server', '--listen', 'stdio://'], {
      cwd, env: this.processEnv, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true, detached: process.platform !== 'win32',
    });
    this.child.on('error', () => this.fail(new Error('Codex CLI could not start; check the runner installation.')));
    this.child.stderr.on('data', (chunk) => {
      this.stderr = `${this.stderr}${chunk.toString()}`.slice(-4000);
    });
    this.child.on('close', (code, signal) => this.fail(appServerFailureError(code, signal, this.stderr)));
    this.child.stdin.on('error', () => this.fail(new Error('Codex input pipe closed.')));
    this.lines = createInterface({ input: this.child.stdout });
    this.lines.on('line', (line) => {
      let message;
      try { message = JSON.parse(line); } catch { this.fail(new Error('Invalid Codex protocol response.')); return; }
      if (message.method) { this.emit('message', message); return; }
      const pending = this.pending.get(message.id);
      if (!pending) return;
      clearTimeout(pending.timer);
      this.pending.delete(message.id);
      if (message.error) pending.reject(appServerRequestError(pending.method, message.error));
      else pending.resolve(message.result);
    });
  }

  fail(error) {
    if (this.failure) return;
    this.failure = error;
    for (const pending of this.pending.values()) { clearTimeout(pending.timer); pending.reject(error); }
    this.pending.clear();
    this.emit('failure', error);
  }

  request(method, params = {}, timeoutMs = this.timeoutMs) {
    if (this.failure) return Promise.reject(this.failure);
    const id = ++this.nextId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Codex ${method} timed out.`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer, method });
      this.child.stdin.write(`${JSON.stringify({ id, method, params })}\n`);
    });
  }

  async exec(command, cwd, timeoutMs = 600_000, permissionProfile = 'delivery-verify') {
    const result = await this.request('command/exec', {
      command, cwd, permissionProfile, timeoutMs,
      outputBytesCap: 24_000, env: this.toolEnv,
    }, timeoutMs + 5000);
    if (result.exitCode !== 0) throw new Error(`${command.join(' ')} failed (${result.exitCode}):\n${result.stderr}\n${result.stdout}`);
    return result.stdout;
  }

  reply(id, result) {
    this.child.stdin.write(`${JSON.stringify({ id, result })}\n`);
  }

  async initialize() {
    await this.request('initialize', { clientInfo: { name: 'agentic_delivery', version: '1.0.0' }, capabilities: { experimentalApi: true } });
    this.child.stdin.write(`${JSON.stringify({ method: 'initialized' })}\n`);
  }

  async capabilities() {
    const { account } = await this.request('account/read', { refreshToken: false });
    if (account?.type !== 'chatgpt') throw new Error('Runner Codex must be signed in with ChatGPT; API billing is not allowed.');
    const models = [];
    let cursor;
    do {
      const page = await this.request('model/list', { includeHidden: true, ...(cursor ? { cursor } : {}) });
      models.push(...page.data);
      cursor = page.nextCursor;
    } while (cursor);
    verifyModels(models);
    const modes = await this.request('collaborationMode/list');
    if (!modes.data.some((item) => item.mode === 'plan')) throw new Error('Runner Codex must support actual Plan mode.');
    try {
      return quotaBoundary(await this.request('account/rateLimits/read'));
    } catch {
      return quotaTelemetryUnavailable();
    }
  }

  async threadConfig(cwd, developerInstructions = '', profile = 'planner') {
    const { config } = await this.request('config/read', { includeLayers: false, cwd });
    checkConfiguration(config);
    const mcpServers = Object.fromEntries(Object.keys(config?.mcp_servers ?? {}).map((name) => [name, {
      // The controller supplies only MCP servers declared by the selected
      // policy profiles. The runner inventory is a separate explicit gate;
      // desirable or model-supplied server names never become enabled.
      enabled: this.approvedMcpServers?.has(name) === true && this.availableMcpServers?.has(name) === true,
    }]));
    const selected = modelForProfile(profile);
    return {
      cwd, model: selected.model, modelProvider: 'openai', allowProviderModelFallback: false,
      permissions: permissionForProfile(profile), approvalPolicy: 'never',
      developerInstructions,
      config: {
        permissions: this.permissions, mcp_servers: mcpServers, web_search: 'disabled',
        features: { multi_agent: false, apps: false, plugins: false, remote_plugin: false, tool_suggest: false, network_proxy:true },
        allow_login_shell: false,
        shell_environment_policy: { inherit: 'none', set: this.toolEnv },
      },
    };
  }

  async startThread(cwd, developerInstructions = '', profile = 'planner') {
    const params = await this.threadConfig(cwd, developerInstructions, profile);
    return this.request('thread/start', {...params, ephemeral: false});
  }

  async resumeThread(cwd, sessionId, developerInstructions = '', profile = 'planner') {
    const params = await this.threadConfig(cwd, developerInstructions, profile);
    const { ephemeral: _ephemeral, ...resumeParams } = params;
    return this.request('thread/resume', {threadId: sessionId, ...resumeParams});
  }

  async thread(cwd, developerInstructions = '') {
    return this.startThread(cwd, developerInstructions);
  }

  close() {
    if (this.closing) return this.closing;
    this.lines.close();
    this.fail(new Error('Codex client closed.'));
    this.child.stdin.end();
    this.closing = this.terminate();
    return this.closing;
  }

  async terminate() {
    const signal = (name) => {
      try {
        if (process.platform !== 'win32' && this.child.pid) process.kill(-this.child.pid, name);
        else return this.child.kill(name);
        return true;
      } catch (error) { if (error.code === 'ESRCH') return false; throw error; }
    };
    if (!this.child.pid || !signal('SIGTERM')) return;
    await new Promise((resolve) => setTimeout(resolve, 200));
    // Also kill remaining descendants when the app-server leader has exited.
    signal('SIGKILL');
    for (let attempt = 0; attempt < 50; attempt++) {
      if (!signal(0)) return;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error('Codex process group did not stop; retain the account lock for operator inspection.');
  }
}
