import { MODELS, quotaBoundary } from './codex-client.mjs';

const strings = { type: 'array', items: { type: 'string' } };
export function outcomeSchema(phase) {
  const properties = {
    status: { type: 'string', enum: phase === 'plan' ? ['ready', 'needs_input'] : ['complete', 'needs_input'] },
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

export function validateOutcome(phase, text) {
  let value;
  try { value = JSON.parse(text); } catch { throw new Error('Codex did not return a structured outcome.'); }
  for (const [key, schema] of Object.entries(outcomeSchema(phase).properties)) {
    if (!value || (schema.type === 'array' ? !Array.isArray(value[key]) || value[key].some((item) => typeof item !== 'string')
      : typeof value[key] !== 'string' || (schema.enum && !schema.enum.includes(value[key])))) {
      throw new Error(`Invalid structured outcome: ${key}.`);
    }
  }
  if (value.status !== 'needs_input' && value.questions.length) throw new Error('Unanswered questions prevent implementation or publication.');
  if (value.status === 'needs_input' && !value.questions.some((question) => question.trim())) throw new Error('A clarification outcome must include a question.');
  if (phase === 'implement' && value.status === 'complete' && value.tasks.length) throw new Error('Remaining tasks prevent publication.');
  if (!value.summary.trim() || (phase === 'plan' && value.status === 'ready' && (!value.plan.trim() || !value.tasks.length))) {
    throw new Error('The structured outcome is incomplete.');
  }
  return value;
}

const phaseName = (phase) => phase === 'plan' ? 'Plan' : phase === 'implement' ? 'Implement' : String(phase ?? 'Delivery');

function concise(value, limit = 1_200) {
  const text = String(value ?? '').replace(/\r\n?/g, '\n').trim();
  if (text.length <= limit) return text;
  const cut = text.slice(0, limit - 1);
  const boundary = Math.max(cut.lastIndexOf('\n'), cut.lastIndexOf('. '), cut.lastIndexOf(' '));
  return `${cut.slice(0, boundary > limit / 2 ? boundary + (cut[boundary] === '.' ? 1 : 0) : undefined).trimEnd()}…`;
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

export async function runTurn({ client, threadId, phase, prompt, onProgress, signal, timeoutMs = 20 * 60_000, pollMs = 15_000 }) {
  let budget;
  try { budget = quotaBoundary(await client.request('account/rateLimits/read')); }
  catch { return { status: 'paused', reason: 'Quota telemetry is unavailable.' }; }
  if (budget.stop) return { status: 'paused', reason: budget.reason, budget };
  if (signal?.aborted) return { status: 'paused', reason: 'Workflow cancelled.' };

  let turnId;
  let stopped;
  let settled = false;
  let finalText = '';
  let progress = Promise.resolve();
  let interruptTimer;
  let polling = false;
  let resolveResult;
  const closeClient = () => { Promise.resolve(client.close()).catch(() => {}); };
  const result = new Promise((resolve) => { resolveResult = resolve; });
  const finish = (value) => {
    if (settled) return;
    settled = true;
    clearInterval(pollTimer);
    clearTimeout(deadline);
    clearTimeout(interruptTimer);
    client.off('message', onMessage);
    client.off('failure', onFailure);
    signal?.removeEventListener('abort', onAbort);
    progress.then(() => resolveResult(value));
  };
  const stop = (reason, status = 'paused', questions = []) => {
    if (stopped || settled) return;
    stopped = { status, reason, budget, questions };
    interruptTimer = setTimeout(() => { closeClient(); finish(stopped); }, 5000);
    if (turnId) client.request('turn/interrupt', { threadId, turnId }).catch(() => { closeClient(); finish(stopped); });
  };
  const onAbort = () => stop('Workflow cancelled; saved work can be resumed.');
  const onFailure = () => finish(stopped ?? { status: 'paused', reason: 'Codex app-server disconnected.' });
  const onMessage = (message) => {
    const p = message.params ?? {};
    if (message.method === 'account/rateLimits/updated') {
      budget = quotaBoundary(p);
      if (budget.stop) stop(budget.reason);
      return;
    }
    if (p.threadId && p.threadId !== threadId) return;
    if (message.method === 'turn/started') turnId = p.turn.id;
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
      progress.then(() => finish(stopped ?? (p.turn.status === 'completed'
        ? { status: 'completed', text: finalText }
        : { status: 'paused', reason: `Codex turn ended with status ${p.turn.status}.` })));
    }
  };
  const pollTimer = setInterval(async () => {
    if (polling || stopped || settled) return;
    polling = true;
    try {
      budget = quotaBoundary(await client.request('account/rateLimits/read'));
      if (budget.stop) stop(budget.reason);
    } catch { stop('Quota telemetry became unavailable.'); }
    finally { polling = false; }
  }, pollMs);
  const deadline = setTimeout(() => stop('The bounded Codex turn time elapsed.'), timeoutMs);
  client.on('message', onMessage);
  client.on('failure', onFailure);
  signal?.addEventListener('abort', onAbort, { once: true });
  const selected = MODELS[phase];
  try {
    const response = await client.request('turn/start', {
      threadId, input: [{ type: 'text', text: prompt }],
      collaborationMode: { mode: selected.mode, settings: { model: selected.model, reasoning_effort: selected.effort, developer_instructions: null } },
      permissions: phase === 'plan' ? 'delivery-plan' : 'delivery-edit',
      approvalPolicy: 'never', serviceTierForTurn: 'default',
      outputSchema: outcomeSchema(phase),
    });
    turnId = response.turn.id;
    if (stopped && !settled) await client.request('turn/interrupt', { threadId, turnId });
  } catch (error) { finish(stopped ?? { status: 'paused', reason: error.message }); }
  return result;
}

export function continuation(state) {
  const awaitingHuman = state.status === 'awaiting-human';
  const quotaPause = /allowance|budget|credit|quota/i.test(state.reason ?? '');
  const questions = (state.questions?.length ? state.questions : state.plan?.questions ?? [])
    .filter((question) => typeof question === 'string' && question.trim());
  if (awaitingHuman && !questions.length && state.reason) questions.push(state.reason);
  const { summary: savedProgress } = progressData(state.lastProgress ?? 'Intake has not completed.');
  const tasks = state.tasks?.length
    ? state.tasks
    : state.plan?.tasks ?? ['Complete intake and planning.', 'Implement, validate, and open the review pull request.'];
  const sessionDetails = state.sessionId ? [
    `Codex session ID: \`${state.sessionId}\``,
    `Continuation state: \`${state.status}\``,
    `Issue: \`#${state.issue}\``,
    `Runner operator recovery: \`codex resume ${state.sessionId}\``,
  ] : [];
  const savedDetails = [
    '<details>',
    '<summary>Saved delivery details</summary>',
    '',
    `- Phase: **${phaseName(state.phase)}**`,
    `- Branch: \`${state.branch ?? 'not created yet'}\``,
    ...sessionDetails.map((line) => line ? `- ${line}` : ''),
    '',
    '### Latest progress',
    '',
    savedProgress,
    '',
    '### Remaining work',
    '',
    ...tasks.map((task) => `- [ ] ${task}`),
    '',
    '### Agent continuation prompt',
    '',
    `Continue source issue #${state.issue} from the saved ${state.phase} phase and existing working tree. Read its plan, questions, comments, and latest validation results. Preserve existing changes. Resolve unanswered questions before implementation. Use Sol High in Plan mode for incomplete planning and Luna Max for implementation. Check subscription quota before model execution. Do not merge or close the source issue.`,
    '',
    '</details>',
  ];
  if (awaitingHuman) return [
    '## Action required: answer Codex',
    `Codex is waiting for your input before it can continue **${phaseName(state.phase)}**.`,
    '',
    '### Questions',
    '',
    questions.map((question, index) => `${index + 1}. ${question}`).join('\n'),
    '',
    '**What to do:** Reply with your answers in a new comment. A plain owner comment continues this waiting delivery run.',
    '',
    ...savedDetails,
  ].join('\n');
  return [
    '## Delivery paused: recovery required',
    'No decision is requested from you.',
    '',
    `**Why it stopped:** ${state.reason ?? 'Work remains.'}`,
    ...(state.shutdownError ? [`Shutdown warning: ${state.shutdownError}. The account lock requires operator inspection.`] : []),
    '',
    `**What to do:** ${quotaPause ? 'After the reported quota reset, ' : 'After the cause is resolved, '}comment \`/codex resume\` on this issue. Manual workflow dispatch remains available for recovery.`,
    ...(quotaPause && state.budget?.resetsAt ? ['', `Reported quota reset: ${new Date(state.budget.resetsAt * 1000).toISOString()}.`] : []),
    '',
    ...savedDetails,
  ].join('\n');
}
