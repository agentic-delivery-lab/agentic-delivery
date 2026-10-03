import { MODELS, quotaBoundary, quotaTelemetryUnavailable } from './codex-client.mjs';
import { QUOTA_STOP_PHASE } from './quota-diagnostics.mjs';

const strings = { type: 'array', items: { type: 'string' } };
const REFINEMENT_WORK_TYPES = ['bug', 'feature', 'task', 'architecture', 'implementation', 'validation'];
export function outcomeSchema(phase) {
  if (phase === 'refine') return {
    type: 'object',
    additionalProperties: false,
    required: ['status', 'summary', 'workType', 'questions', 'refinedGoal', 'audience', 'requirements', 'constraints', 'acceptanceCriteria', 'affectedContexts', 'unresolvedDecisions', 'workItems'],
    properties: {
      status: { type: 'string', enum: ['needs_input', 'refined'] },
      summary: { type: 'string' },
      workType: { type: ['string', 'null'], enum: [...REFINEMENT_WORK_TYPES, null] },
      questions: strings,
      refinedGoal: { type: 'string' },
      audience: { type: 'string' },
      requirements: strings,
      constraints: strings,
      acceptanceCriteria: strings,
      affectedContexts: strings,
      unresolvedDecisions: strings,
      workItems: { type: 'array', maxItems: 10, items: {
        type: 'object', additionalProperties: false,
        required: ['key', 'kind', 'title', 'goal', 'acceptanceCriteria', 'dependencies'],
        properties: {
          key: { type: 'string', pattern: '^[a-z0-9]+(?:-[a-z0-9]+)*$' },
          kind: { type: 'string', enum: ['research', 'specification', 'architecture', 'task', 'bug', 'implementation', 'validation'] },
          title: { type: 'string' },
          goal: { type: 'string' },
          acceptanceCriteria: strings,
          dependencies: strings,
        },
      } },
    },
  };
  if (phase === 'review') return {
    type: 'object',
    additionalProperties: false,
    required: ['status', 'summary', 'affectedAdrs', 'affectedContexts', 'findings', 'evidenceGaps'],
    properties: {
      status: { type: 'string', enum: ['aligned', 'findings', 'inconclusive'] },
      summary: { type: 'string' },
      affectedAdrs: { type: 'array', items: { type: 'string' } },
      affectedContexts: { type: 'array', items: { type: 'string' } },
      findings: { type: 'array', items: {
        type: 'object', additionalProperties: false,
        required: ['category', 'severity', 'statement', 'evidence', 'recommendedAction'],
        properties: {
          category: { type: 'string' },
          severity: { type: 'string', enum: ['concern', 'advisory'] },
          statement: { type: 'string' },
          evidence: { type: 'array', items: { type: 'string' } },
          recommendedAction: { type: 'string' },
        },
      } },
      evidenceGaps: { type: 'array', items: { type: 'string' } },
    },
  };
  const properties = {
    status: { type: 'string', enum: phase === 'plan' ? ['ready', 'needs_input'] : ['continue', 'complete', 'needs_input'] },
    summary: { type: 'string' }, tasks: strings, questions: strings,
    ...(phase === 'plan' ? {
      kind: { type: 'string', enum: ['idea', 'requirements', 'decision', 'mixed'] },
      plan: { type: 'string' },
      changeType: { type: 'string', enum: ['build', 'chore', 'ci', 'docs', 'feat', 'fix', 'perf', 'refactor', 'revert', 'style', 'test'] },
      title: { type: 'string' },
    } : {}),
  };
  return { type: 'object', additionalProperties: false, required: Object.keys(properties), properties };
}

export function orchestrationOutcomeSchema(phase, stages = []) {
  const strings = { type: 'array', maxItems: 50, items: { type: 'string', maxLength: 2_000 } };
  return {
    type: 'object',
    additionalProperties: false,
    required: ['status', 'summary', 'evidence', 'inferences', 'uncertainties', 'recommendations', 'questions', 'nextStage'],
    properties: {
      status: { type: 'string', enum: ['complete', 'needs_input', 'blocked'] },
      summary: { type: 'string', minLength: 1, maxLength: 2_000 },
      evidence: strings,
      inferences: strings,
      uncertainties: strings,
      recommendations: strings,
      questions: { ...strings, maxItems: 3 },
      nextStage: { type: ['string', 'null'], enum: [...stages, null] },
      requirements: strings,
      acceptanceCriteria: strings,
      affectedContexts: strings,
      unresolvedDecisions: strings,
      alternatives: strings,
      drivers: strings,
      consequences: strings,
      adr: { type: ['string', 'null'], maxLength: 100_000 },
      checks: strings,
    },
  };
}

export function validateOrchestrationOutcome(text) {
  let value;
  try { value = JSON.parse(text); } catch { throw new Error('Codex did not return a structured orchestration outcome.'); }
  const allowed = ['status', 'summary', 'evidence', 'inferences', 'uncertainties', 'recommendations', 'questions', 'nextStage',
    'requirements', 'acceptanceCriteria', 'affectedContexts', 'unresolvedDecisions', 'alternatives', 'drivers', 'consequences', 'adr', 'checks'];
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some((key) => !allowed.includes(key))) throw new Error('Invalid orchestration outcome: unexpected property.');
  if (!['complete', 'needs_input', 'blocked'].includes(value.status) || typeof value.summary !== 'string' || !value.summary.trim()) throw new Error('Invalid orchestration outcome: status or summary.');
  for (const key of allowed.filter((key) => key !== 'status' && key !== 'summary' && key !== 'nextStage' && key !== 'adr')) {
    if (value[key] !== undefined && (!Array.isArray(value[key]) || value[key].some((item) => typeof item !== 'string' || !item.trim()))) throw new Error(`Invalid orchestration outcome: ${key}.`);
  }
  value.questions ??= [];
  if (value.questions.length > 3) throw new Error('An orchestration outcome may ask at most three focused questions.');
  if (value.status === 'needs_input' && value.questions.length === 0) throw new Error('A clarification orchestration outcome must include a focused question.');
  if (value.nextStage !== null && (typeof value.nextStage !== 'string' || !value.nextStage.trim())) throw new Error('Invalid orchestration outcome: nextStage.');
  if (value.adr !== undefined && value.adr !== null && (typeof value.adr !== 'string' || !value.adr.trim())) throw new Error('Invalid orchestration outcome: adr.');
  return value;
}

export function validateOutcome(phase, text) {
  let value;
  try { value = JSON.parse(text); } catch { throw new Error('Codex did not return a structured outcome.'); }
  for (const [key, schema] of Object.entries(outcomeSchema(phase).properties)) {
    if (!value || (schema.type === 'array' ? !Array.isArray(value[key]) || value[key].some((item) => typeof item !== 'string')
      : typeof value[key] !== 'string' || (schema.enum && !schema.enum.includes(value[key])))) {
      throw new Error(`Invalid structured outcome: ${key}.`);
    }
  }
  const reject = (message) => {
    const error = new Error(message);
    error.outcome = value;
    throw error;
  };
  if (value.status !== 'needs_input' && value.questions.length) reject('Unanswered questions prevent implementation or publication.');
  if (value.status === 'needs_input' && !value.questions.some((question) => question.trim())) reject('A clarification outcome must include a question.');
  if (phase === 'implement' && value.status === 'continue' && !value.tasks.some((task) => task.trim())) reject('A continuation outcome must include a remaining task.');
  if (phase === 'implement' && value.status === 'complete' && value.tasks.length) reject('Remaining tasks prevent publication.');
  if (!value.summary.trim() || (phase === 'plan' && value.status === 'ready' && (!value.plan.trim() || !value.tasks.length))) {
    reject('The structured outcome is incomplete.');
  }
  return value;
}

export function validateRefinementOutcome(text) {
  let value;
  try { value = JSON.parse(text); } catch { throw new Error('Codex did not return a structured refinement outcome.'); }
  const allowedKeys = new Set(['status', 'summary', 'workType', 'questions', 'refinedGoal', 'audience', 'requirements', 'constraints', 'acceptanceCriteria', 'affectedContexts', 'unresolvedDecisions', 'workItems']);
  const requiredStrings = ['summary', 'refinedGoal', 'audience'];
  const requiredArrays = ['questions', 'requirements', 'constraints', 'acceptanceCriteria', 'affectedContexts', 'unresolvedDecisions', 'workItems'];
  if (!value || typeof value !== 'object' || !['needs_input', 'refined'].includes(value.status)) throw new Error('Invalid refinement outcome: status.');
  if (Object.keys(value).some((key) => !allowedKeys.has(key))) throw new Error('Invalid refinement outcome: unexpected property.');
  if (value.workType !== null && !REFINEMENT_WORK_TYPES.includes(value.workType)) throw new Error('Invalid refinement outcome: workType.');
  for (const key of requiredStrings) if (typeof value[key] !== 'string') throw new Error(`Invalid refinement outcome: ${key}.`);
  if (!value.summary.trim()) throw new Error('Invalid refinement outcome: summary.');
  for (const key of requiredArrays) if (!Array.isArray(value[key]) || (key !== 'workItems' && value[key].some((item) => typeof item !== 'string'))) throw new Error(`Invalid refinement outcome: ${key}.`);
  if (value.questions.some((question) => typeof question !== 'string' || !question.trim())) throw new Error('Invalid refinement outcome: questions.');
  if (value.questions.length > 3) throw new Error('A refinement outcome may ask at most three focused questions.');
  if (value.workItems.length > 10) throw new Error('A refinement outcome may create at most ten work items.');
  const keys = new Set();
  for (const item of value.workItems) {
    if (Object.keys(item ?? {}).some((key) => !['key', 'kind', 'title', 'goal', 'acceptanceCriteria', 'dependencies'].includes(key))) throw new Error(`Invalid refinement work item: unexpected property.`);
    if (!item || typeof item !== 'object' || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(item.key ?? '')
      || !['research', 'specification', 'architecture', 'task', 'bug', 'implementation', 'validation'].includes(item.kind)
      || typeof item.title !== 'string' || !item.title.trim() || item.title.length > 120 || /[\r\n\x00-\x1f]/.test(item.title) || typeof item.goal !== 'string' || !item.goal.trim()
      || !Array.isArray(item.acceptanceCriteria) || item.acceptanceCriteria.length === 0 || item.acceptanceCriteria.some((criterion) => typeof criterion !== 'string' || !criterion.trim())
      || !Array.isArray(item.dependencies) || item.dependencies.some((dependency) => typeof dependency !== 'string')) throw new Error(`Invalid refinement work item: ${item?.key ?? 'unknown'}.`);
    if (keys.has(item.key)) throw new Error(`Duplicate refinement work item: ${item.key}.`);
    keys.add(item.key);
  }
  for (const item of value.workItems) for (const dependency of item.dependencies) if (!keys.has(dependency)) throw new Error(`Unknown refinement dependency: ${dependency}.`);
  const visiting = new Set();
  const visited = new Set();
  const visit = (key) => {
    if (visiting.has(key)) throw new Error('Refinement work-item dependencies must be acyclic.');
    if (visited.has(key)) return;
    visiting.add(key);
    const item = value.workItems.find((candidate) => candidate.key === key);
    for (const dependency of item.dependencies) visit(dependency);
    visiting.delete(key);
    visited.add(key);
  };
  for (const item of value.workItems) visit(item.key);
  if (value.status === 'needs_input' && value.questions.length === 0) throw new Error('A clarification outcome must include a focused question.');
  if (value.status === 'refined' && value.questions.length) throw new Error('A refined outcome must not leave clarification questions unanswered.');
  if (value.status === 'refined' && (!value.workType || !value.refinedGoal.trim() || !value.audience.trim() || value.acceptanceCriteria.length === 0)) throw new Error('A refined outcome must include a work type, goal, audience, and acceptance criteria.');
  return value;
}

const phaseName = (phase) => phase === 'refine' ? 'Refinement' : phase === 'research' ? 'Research' : phase === 'requirements' ? 'Requirements' : phase === 'architecture' ? 'Architecture decision' : phase === 'plan' ? 'Plan' : phase === 'implement' ? 'Implement' : phase === 'validate' ? 'Validation' : phase === 'review' ? 'Architecture review' : String(phase ?? 'Delivery');

function concise(value, limit = 1_200) {
  const text = String(value ?? '').replace(/\r\n?/g, '\n').trim();
  if (text.length <= limit) return text;
  const cut = text.slice(0, limit - 1);
  const boundary = Math.max(cut.lastIndexOf('\n'), cut.lastIndexOf('. '), cut.lastIndexOf(' '));
  return `${cut.slice(0, boundary > limit / 2 ? boundary + (cut[boundary] === '.' ? 1 : 0) : undefined).trimEnd()}…`;
}

function quoteMarkdown(value, limit = 24_000) {
  return concise(value, limit).split('\n').map((line) => `> ${line}`).join('\n');
}

function progressData(text) {
  try {
    const value = JSON.parse(text);
    if (value && typeof value === 'object') {
      return {
        summary: typeof value.summary === 'string' && value.summary.trim()
          ? concise(value.summary, 700)
          : 'Progress was saved to the delivery state.',
        tasks: Array.isArray(value.tasks) ? value.tasks.filter((task) => typeof task === 'string' && task.trim()) : [],
      };
    }
  } catch {}
  if (/^\s*[\[{]/.test(String(text))) return { summary: 'Progress was saved to the delivery state.', tasks: [] };
  return { summary: concise(text), tasks: [] };
}

export function formatProgressComment(phase, text) {
  const { summary, tasks } = progressData(text);
  const next = tasks.slice(0, 3);
  return [
    `### Progress update: ${phaseName(phase)}`,
    summary || 'Work is continuing.',
    ...(next.length ? ['**Next**', next.map((task) => `- ${concise(task, 300)}`).join('\n')] : []),
    ...(tasks.length > next.length ? [`_${tasks.length - next.length} more ${tasks.length - next.length === 1 ? 'task' : 'tasks'} saved in the delivery state._`] : []),
  ].join('\n\n');
}

function cleanPlan(plan) {
  return String(plan ?? '')
    .replace(/^\s*<proposed_plan>\s*/i, '')
    .replace(/\s*<\/proposed_plan>\s*$/i, '')
    .trim();
}

export function formatPlanComment(plan) {
  return [
    '## Plan complete',
    concise(plan.summary),
    '<details>',
    '<summary>View implementation plan and tasks</summary>',
    '',
    cleanPlan(plan.plan),
    '',
    '### Tasks',
    ...plan.tasks.map((task) => `- [ ] ${task}`),
    '',
    '</details>',
  ].join('\n');
}

export function formatRefinementComment(outcome) {
  const lines = ['## Refined goal', outcome.summary, '', `**Work type:** ${outcome.workType}`, `**Goal:** ${outcome.refinedGoal}`, `**Audience:** ${outcome.audience}`, '', '**Acceptance criteria**', ...outcome.acceptanceCriteria.map((item) => `- ${item}`)];
  if (outcome.requirements.length) lines.push('', '**Requirements**', ...outcome.requirements.map((item) => `- ${item}`));
  if (outcome.constraints.length) lines.push('', '**Constraints**', ...outcome.constraints.map((item) => `- ${item}`));
  if (outcome.unresolvedDecisions.length) lines.push('', '**Unresolved decisions**', ...outcome.unresolvedDecisions.map((item) => `- ${item}`));
  if (outcome.workItems.length) lines.push('', '**Conditional work items**', ...outcome.workItems.map((item) => `- \`${item.key}\` (${item.kind}): ${item.title}`));
  return lines.join('\n');
}

const CODEX_TURN_ERROR_CODES = new Set([
  'bad_request', 'context_window_exceeded', 'cyber_policy', 'flex_unavailable',
  'http_connection_failed', 'internal_server_error', 'misalignment_policy_violation',
  'other', 'rate_limit_exceeded', 'response_stream_connection_failed',
  'response_stream_disconnected', 'response_too_many_failed_attempts', 'sandbox_error',
  'server_overloaded', 'session_budget_exceeded', 'thread_rollback_failed',
  'too_many_denials', 'unauthorized', 'usage_limit_exceeded',
]);

function normalizedCodexErrorCode(value) {
  if (typeof value !== 'string' || !/^[A-Za-z][A-Za-z0-9_]*$/.test(value)) return null;
  const normalized = value.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase();
  return CODEX_TURN_ERROR_CODES.has(normalized) ? normalized : null;
}

function safeTurnError(error) {
  if (!error || typeof error !== 'object' || Array.isArray(error)) return null;
  // App-server messages and additional details may contain credentials. Publish
  // only a known protocol code, a validated HTTP status, or a fixed hint.
  const info = error.codexErrorInfo;
  const candidates = typeof info === 'string'
    ? [info]
    : info && typeof info === 'object' && !Array.isArray(info)
      ? [info.type, info.code, ...Object.keys(info)]
      : [];
  const code = candidates.map(normalizedCodexErrorCode).find(Boolean);
  const infoKey = info && typeof info === 'object' && !Array.isArray(info)
    ? Object.keys(info).find((key) => normalizedCodexErrorCode(key) === code)
    : null;
  const nested = infoKey ? info[infoKey] : null;
  const status = [error.httpStatusCode, info?.httpStatusCode, nested?.httpStatusCode]
    .find((value) => Number.isSafeInteger(value) && value >= 100 && value <= 599);
  const diagnostic = error.message === 'workspace routing discovery failed'
    ? 'workspace_routing_discovery_failed'
    : null;
  const details = [
    ...(code ? [`codex_error=${code}`] : []),
    ...(diagnostic ? [`diagnostic=${diagnostic}`] : []),
    ...(status ? [`http_status=${status}`] : []),
  ];
  return details.length ? details.join(', ') : null;
}

function turnFailureReason(status, diagnostic) {
  const safeStatus = ['failed', 'interrupted', 'completed'].includes(status) ? status : 'unknown';
  const details = diagnostic
    ? ` (${diagnostic})`
    : safeStatus === 'failed' ? ' (safe error details unavailable)' : '';
  return `Codex turn ended with status ${safeStatus}.${details}`;
}

export async function runTurn({ client, threadId, phase, prompt, onProgress, signal, schema = outcomeSchema(phase), stallTimeoutMs = 20 * 60_000, pollMs = 15_000 }) {
  let budget;
  try { budget = quotaBoundary(await client.request('account/rateLimits/read')); }
  catch { budget = quotaTelemetryUnavailable(); }
  if (budget.stop) return { status: 'paused', reason: budget.reason, budget, stopPhase: QUOTA_STOP_PHASE.preflight };
  if (signal?.aborted) return { status: 'paused', reason: 'Workflow cancelled.' };

  let turnId;
  let stopped;
  let settled = false;
  let finalText = '';
  let lastTurnError;
  let progress = Promise.resolve();
  let interruptTimer;
  let stallTimer;
  let polling = false;
  let resolveResult;
  const closeClient = () => { Promise.resolve(client.close()).catch(() => {}); };
  const result = new Promise((resolve) => { resolveResult = resolve; });
  const finish = (value) => {
    if (settled) return;
    settled = true;
    clearInterval(pollTimer);
    clearTimeout(interruptTimer);
    clearTimeout(stallTimer);
    client.off('message', onMessage);
    client.off('failure', onFailure);
    signal?.removeEventListener('abort', onAbort);
    progress.then(() => resolveResult(value));
  };
  const stop = (reason, status = 'paused', questions = [], stopPhase) => {
    if (stopped || settled) return;
    stopped = { status, reason, budget, questions, ...(stopPhase ? { stopPhase } : {}) };
    interruptTimer = setTimeout(() => { closeClient(); finish(stopped); }, 5000);
    if (turnId) client.request('turn/interrupt', { threadId, turnId }).catch(() => { closeClient(); finish(stopped); });
  };
  const recordActivity = () => {
    if (stopped || settled) return;
    clearTimeout(stallTimer);
    stallTimer = setTimeout(() => stop('The Codex turn produced no activity within the stall timeout.'), stallTimeoutMs);
  };
  const checkBudget = async () => {
    if (polling || stopped || settled) return;
    polling = true;
    try {
      budget = quotaBoundary(await client.request('account/rateLimits/read'));
      if (budget.stop) stop(budget.reason, 'paused', [], turnId ? QUOTA_STOP_PHASE.activeTurn : QUOTA_STOP_PHASE.preflight);
    } catch {
      budget = quotaTelemetryUnavailable();
      stop(budget.reason, 'paused', [], turnId ? QUOTA_STOP_PHASE.activeTurn : QUOTA_STOP_PHASE.preflight);
    }
    finally { polling = false; }
  };
  const onAbort = () => stop('Workflow cancelled; saved work can be resumed.');
  const onFailure = () => finish(stopped ?? {
    status: 'paused',
    reason: lastTurnError
      ? `Codex app-server disconnected after a turn error (${lastTurnError}).`
      : 'Codex app-server disconnected.',
  });
  const onMessage = (message) => {
    const p = message.params ?? {};
    if (message.method === 'account/rateLimits/updated') {
      // Notifications may be sparse. Read the complete snapshot before making
      // a subscription-budget decision.
      void checkBudget();
      return;
    }
    if (p.threadId && p.threadId !== threadId) return;
    const messageTurnId = p.turnId ?? p.turn?.id;
    if (turnId && messageTurnId && messageTurnId !== turnId) return;
    if (message.method === 'turn/started') turnId = p.turn.id;
    if (p.threadId === threadId && message.method !== 'turn/completed') recordActivity();
    // Ignore retrying or uncorrelated notifications so a stale error cannot
    // be reported as the terminal reason for this turn.
    const correlatedTurn = turnId !== undefined && turnId !== null
      && messageTurnId !== undefined && messageTurnId !== null
      && messageTurnId === turnId;
    if (message.method === 'error' && p.error && correlatedTurn && p.willRetry !== true) {
      lastTurnError = safeTurnError(p.error) ?? lastTurnError;
    }
    if (message.id !== undefined && message.method) {
      turnId ??= p.turnId;
      const questions = p.questions?.map((q) => `${q.question}${q.options?.length ? ` Options: ${q.options.map((o) => `${o.label}: ${o.description}`).join('; ')}` : ''}`);
      stop(questions?.join('\n') || `Human input is required for ${message.method}.`, 'needs_input', questions ?? []);
    }
    if (message.method === 'item/completed' && p.item?.type === 'agentMessage') {
      if (p.item.phase === 'final_answer' || p.item.phase == null) finalText = p.item.text;
      progress = progress.then(() => onProgress(p.item.text)).catch(() => stop('The mandatory issue audit trail could not be saved.'));
    }
    if (message.method === 'turn/completed') {
      // Wait for mandatory progress publication before considering the turn complete.
      const diagnostic = safeTurnError(p.turn?.error) ?? lastTurnError;
      progress.then(() => finish(stopped ?? (p.turn.status === 'completed'
        ? { status: 'completed', text: finalText }
        : { status: 'paused', reason: turnFailureReason(p.turn.status, diagnostic) })));
    }
  };
  const pollTimer = setInterval(checkBudget, pollMs);
  client.on('message', onMessage);
  client.on('failure', onFailure);
  signal?.addEventListener('abort', onAbort, { once: true });
  const selected = MODELS[phase];
  if (!selected) throw new Error(`Unsupported model phase: ${phase}.`);
  try {
    const response = await client.request('turn/start', {
      threadId, input: [{ type: 'text', text: prompt }],
      collaborationMode: { mode: selected.mode, settings: { model: selected.model, reasoning_effort: selected.effort, developer_instructions: null } },
      permissions: ['route', 'refine', 'plan', 'requirements', 'architecture'].includes(phase)
        ? (phase === 'research' ? 'delivery-research' : 'delivery-plan')
        : phase === 'research' ? 'delivery-research'
          : phase === 'implement' ? 'delivery-edit' : 'delivery-review',
      approvalPolicy: 'never', serviceTierForTurn: 'default',
      outputSchema: schema,
    });
    turnId = response.turn.id;
    recordActivity();
    if (stopped && !settled) await client.request('turn/interrupt', { threadId, turnId });
  } catch (error) {
    finish(stopped ?? {
      status: 'paused',
      reason: turnFailureReason('failed', safeTurnError(error)),
    });
  }
  return result;
}

export function continuation(state) {
  const awaitingHuman = state.status === 'awaiting-human';
  const quotaPause = /allowance|budget|credit|quota/i.test(state.reason ?? '');
  const questions = (state.questions?.length ? state.questions : state.plan?.questions ?? [])
    .filter((question) => typeof question === 'string' && question.trim());
  if (awaitingHuman && !questions.length && state.reason) questions.push(state.reason);
  if (awaitingHuman) return [
    '## Action required',
    `**Stopped at:** ${phaseName(state.phase)}`,
    `**Why:** ${phaseName(state.phase)} needs your answer to continue.`,
    '**Answer:**',
    questions.map((question, index) => `${index + 1}. ${question}`).join('\n'),
    '**Next:** Reply with the answers. Do not change lifecycle fields or governance metadata.',
  ].join('\n');
  const validation = state.phase === 'verify' && state.validation
    ? `\n\n**Latest check failure:**\n${quoteMarkdown(state.validation, 1_200)}`
    : '';
  const next = quotaPause
    ? `Rerun the failed workflow after ${state.budget?.resetsAt ? new Date(state.budget.resetsAt * 1000).toISOString() : 'the quota resets'}.`
    : 'Fix the reported cause, then rerun the failed workflow.';
  return [
    '## Delivery paused',
    `**Stopped at:** ${phaseName(state.phase)}`,
    `**Why:** ${concise(state.reason ?? 'The workflow could not continue.', 700)}${validation}`,
    `**Next:** ${next} Do not change lifecycle fields or post a continuation comment.`,
  ].join('\n\n');
}
