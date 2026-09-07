import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { createInterface } from 'node:readline';

export const MODELS = Object.freeze({
  plan: { model: 'gpt-5.6-sol', effort: 'high', mode: 'plan' },
  implement: { model: 'gpt-5.6-luna', effort: 'max', mode: 'default' },
});

export function quotaBoundary(response, now = Date.now() / 1000) {
  const buckets = Object.values(response?.rateLimitsByLimitId ?? {});
  if (response?.rateLimits) buckets.push(response.rateLimits);
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

export function modelEnvironment(env = process.env) {
  const allowed = ['PATH', 'HOME', 'USER', 'LOGNAME', 'LANG', 'LC_ALL', 'TMPDIR', 'TEMP', 'TMP', 'CODEX_HOME', 'PNPM_HOME', 'SystemRoot'];
  return Object.fromEntries(allowed.filter((key) => env[key] !== undefined).map((key) => [key, env[key]]));
}

export function deliveryPermissions() {
  return Object.fromEntries(['plan', 'edit'].map((phase) => [`delivery-${phase}`, {
    extends: phase === 'plan' ? ':read-only' : ':workspace',
    filesystem: {
      ':root': 'deny', ':minimal': 'read', ':tmpdir': 'deny', ':slash_tmp': 'deny',
      ':workspace_roots': { '.': phase === 'plan' ? 'read' : 'write', '.git': 'read', '.codex': 'read' },
    },
    network: { enabled: false },
  }]));
}

export class CodexClient extends EventEmitter {
  constructor({ command = 'codex', args = [], cwd, env = modelEnvironment(), timeoutMs = 30_000 } = {}) {
    super();
    this.pending = new Map();
    this.nextId = 0;
    this.timeoutMs = timeoutMs;
    this.child = spawn(command, [...args, 'app-server', '--listen', 'stdio://'], {
      cwd, env, stdio: ['pipe', 'pipe', 'ignore'], windowsHide: true,
    });
    this.child.on('error', () => this.fail(new Error('Codex CLI could not start; check the runner installation.')));
    this.child.on('exit', () => this.fail(new Error('Codex app-server stopped.')));
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
      if (message.error) pending.reject(new Error(`Codex ${pending.method}: ${message.error.message}`));
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

  request(method, params = {}) {
    if (this.failure) return Promise.reject(this.failure);
    const id = ++this.nextId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Codex ${method} timed out.`));
      }, this.timeoutMs);
      this.pending.set(id, { resolve, reject, timer, method });
      this.child.stdin.write(`${JSON.stringify({ id, method, params })}\n`);
    });
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

  async thread(cwd, developerInstructions = '') {
    const { config } = await this.request('config/read', { includeLayers: false });
    const mcpServers = Object.fromEntries(Object.keys(config?.mcp_servers ?? {}).map((name) => [name, { enabled: false }]));
    return this.request('thread/start', {
      cwd, model: MODELS.plan.model, allowProviderModelFallback: false,
      permissions: 'delivery-plan', approvalPolicy: 'never', ephemeral: true,
      developerInstructions, environments: [],
      config: {
        permissions: deliveryPermissions(), mcp_servers: mcpServers, web_search: 'disabled',
        features: { multi_agent: false, apps: false, plugins: false },
        shell_environment_policy: { inherit: 'none', set: modelEnvironment() },
      },
    });
  }

  close() {
    this.lines.close();
    this.fail(new Error('Codex client closed.'));
    this.child.stdin.end();
    this.child.kill();
  }
}
