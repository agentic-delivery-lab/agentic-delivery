import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { createInterface } from 'node:readline';
import { existsSync, realpathSync, mkdirSync, mkdtempSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';

export const MODELS = Object.freeze({
  plan: { model: 'gpt-5.6-sol', effort: 'high', mode: 'plan' },
  implement: { model: 'gpt-5.6-luna', effort: 'max', mode: 'default' },
});

export const AUTH_STORAGE_CONFIG = 'cli_auth_credentials_store="file"';
export const DEFAULT_PERMISSION_CONFIG = 'default_permissions="delivery-plan"';

function safeCodexDiagnostic(value) {
  // Codex owns authentication. Its errors may contain arbitrary credentials,
  // including fragments whose labels were lost when stderr was truncated.
  // Publish only fixed hints, never a substring of the original diagnostic.
  if (String(value).includes('no rollout found for thread id')) {
    return 'Codex has no persisted rollout for this thread yet.';
  }
  if (String(value).includes('config defines [permissions] profiles but does not set default_permissions')) {
    return 'A default permission profile is required. Check the controller startup configuration.';
  }
  return 'Details withheld because Codex errors may contain credentials. Check the runner installation, authentication, and configuration.';
}

export function appServerFailure(code, signal, stderr = '') {
  const stopped = `Codex app-server stopped (${code ?? signal}).`;
  return String(stderr).trim() ? `${stopped} Diagnostic: ${safeCodexDiagnostic(stderr)}` : stopped;
}

export function quotaBoundary(response, now = Date.now() / 1000) {
  const buckets = Object.values(response?.rateLimitsByLimitId ?? {});
  if (response?.rateLimits) buckets.push(response.rateLimits);
  if (buckets.some((bucket) => !bucket || typeof bucket !== 'object' || !bucket.primary)) {
    return { stop: true, reason: 'Quota telemetry contains an invalid bucket.' };
  }
  if (buckets.some((bucket) => bucket.credits?.hasCredits !== false || bucket.credits?.unlimited !== false)) {
    return { stop: true, reason: 'Credit spillover is possible or credit telemetry is unavailable; subscription-only execution is required.' };
  }
  const windows = buckets.flatMap((bucket) => [bucket.primary, bucket.secondary].filter(Boolean));
  if (!windows.some((window) => window.windowDurationMins === 300)
      || windows.some((window) => !Number.isFinite(window.usedPercent)
        || window.usedPercent < 0 || window.usedPercent > 100
        || !Number.isFinite(window.windowDurationMins) || window.windowDurationMins <= 0
        || !Number.isFinite(window.resetsAt) || window.resetsAt <= now)) {
    return { stop: true, reason: 'Quota telemetry is missing, invalid, or expired.' };
  }
  const exhausted = windows.filter((window) => window.usedPercent >= 98);
  const blocked = buckets.some((bucket) => bucket.rateLimitReachedType || bucket.spendControlReached);
  return {
    stop: exhausted.length > 0 || blocked,
    reason: exhausted.length || blocked ? 'Codex allowance reached the finalization reserve.' : 'Allowance available.',
    usedPercent: Math.max(...windows.map((window) => window.usedPercent)),
    resetsAt: Math.max(...(exhausted.length ? exhausted : windows).map((window) => window.resetsAt)),
  };
}

export function verifyModels(models) {
  for (const { model, effort } of Object.values(MODELS)) {
    const match = models.find((item) => (item.model ?? item.id) === model);
    if (!match?.supportedReasoningEfforts?.some((item) => item.reasoningEffort === effort)) {
      throw new Error(`Codex must support ${model} with ${effort} effort; no fallback is allowed.`);
    }
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
  return Object.fromEntries(['plan', 'edit', 'verify', 'deps'].map((phase) => [`delivery-${phase}`, {
    extends: ':read-only',
    filesystem: {
      ':root': 'deny', ':minimal': 'read',
      ...Object.fromEntries(readableFiles.map((file) => [file, 'read'])),
      ...(runtime ? {[runtime]: 'write'} : {}),
      ':workspace_roots': { '.': ['plan', 'verify'].includes(phase) ? 'read' : 'write', '.git': 'read', '.codex': 'read' },
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
  constructor({ command = 'codex', args = [], cwd, env = serverEnvironment(), runtime, readableFiles = [], timeoutMs = 30_000 } = {}) {
    super();
    this.pending = new Map();
    this.nextId = 0;
    this.timeoutMs = timeoutMs;
    this.runtime = runtime ?? mkdtempSync(path.join(tmpdir(), 'codex-delivery-tools-'));
    for (const dir of ['home', 'tmp', 'cache', 'data']) mkdirSync(path.join(this.runtime, dir), {recursive:true, mode:0o700});
    this.toolEnv = modelEnvironment(env, this.runtime);
    this.permissions = deliveryPermissions([...runtimeFiles(env), ...readableFiles], this.runtime);
    this.stderr = '';
    this.child = spawn(command, [...args, '-c', AUTH_STORAGE_CONFIG, '-c', DEFAULT_PERMISSION_CONFIG,
      '-c', `permissions=${tomlValue(this.permissions)}`,
      '-c', `shell_environment_policy=${tomlValue({inherit:'none', set:this.toolEnv})}`,
      '-c', 'allow_login_shell=false', '-c', 'features.plugins=false', '-c', 'features.apps=false',
      '-c', 'features.network_proxy=true',
      '-c', 'features.remote_plugin=false', 'app-server', '--listen', 'stdio://'], {
      cwd, env, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true, detached: process.platform !== 'win32',
    });
    this.child.on('error', () => this.fail(new Error('Codex CLI could not start; check the runner installation.')));
    this.child.stderr.on('data', (chunk) => {
      this.stderr = `${this.stderr}${chunk.toString()}`.slice(-4000);
    });
    this.child.on('close', (code, signal) => this.fail(new Error(appServerFailure(code, signal, this.stderr))));
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
      if (message.error) pending.reject(new Error(`Codex ${pending.method}: ${safeCodexDiagnostic(message.error.message)}`));
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
    return quotaBoundary(await this.request('account/rateLimits/read'));
  }

  async threadConfig(cwd, developerInstructions = '') {
    const { config } = await this.request('config/read', { includeLayers: false, cwd });
    checkConfiguration(config);
    const mcpServers = Object.fromEntries(Object.keys(config?.mcp_servers ?? {}).map((name) => [name, { enabled: false }]));
    return {
      cwd, model: MODELS.plan.model, modelProvider: 'openai', allowProviderModelFallback: false,
      permissions: 'delivery-plan', approvalPolicy: 'never',
      developerInstructions,
      config: {
        permissions: this.permissions, mcp_servers: mcpServers, web_search: 'disabled',
        features: { multi_agent: false, apps: false, plugins: false, remote_plugin: false, tool_suggest: false, network_proxy:true },
        allow_login_shell: false,
        shell_environment_policy: { inherit: 'none', set: this.toolEnv },
      },
    };
  }

  async startThread(cwd, developerInstructions = '') {
    const params = await this.threadConfig(cwd, developerInstructions);
    return this.request('thread/start', {...params, ephemeral: false});
  }

  async resumeThread(cwd, sessionId, developerInstructions = '') {
    const params = await this.threadConfig(cwd, developerInstructions);
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
