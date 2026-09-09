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
  const stop = (reason, status = 'paused') => {
    if (stopped || settled) return;
    stopped = { status, reason, budget };
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
      stop(questions?.join('\n') || `Human input is required for ${message.method}.`, 'needs_input');
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
  const sessionDetails = state.sessionId ? [
    `Codex session ID: \`${state.sessionId}\``,
    `Continuation state: \`${state.status}\``,
    `Issue: \`#${state.issue}\``,
    '',
    'Manual recovery:',
    `\`codex resume ${state.sessionId}\``,
  ] : [];
  return [
    `## Continuation for source issue #${state.issue}`,
    `Reason: ${state.reason ?? 'Work remains.'}`,
    ...(state.shutdownError ? [`Shutdown warning: ${state.shutdownError}. The account lock requires operator inspection.`] : []),
    `Phase: ${state.phase}. Branch: ${state.branch ?? 'not created yet'}.`,
    ...sessionDetails,
    `Saved progress: ${state.lastProgress ?? 'Intake has not completed.'}`,
    '### Remaining tasks',
    ...(state.tasks?.length ? state.tasks : state.plan?.tasks ?? ['Complete intake and planning.', 'Implement, validate, and open the review pull request.']).map((task) => `- [ ] ${task}`),
    '### Follow-up prompt',
    `Continue source issue #${state.issue} from the saved ${state.phase} phase and existing working tree. Read its plan, questions, comments, and latest validation results. Preserve existing changes. Resolve unanswered questions before implementation. Use Sol High in Plan mode for incomplete planning and Luna Max for implementation. Check subscription quota before model execution. Do not merge or close the source issue.`,
    ...(awaitingHuman
      ? ['Post a plain trusted repository-owner comment with the human decision or answer to continue this waiting delivery run.']
      : ['After answering any questions and after the quota resets, comment `/codex resume` on this issue. An agent with repository write permission can also resume. A manual workflow dispatch with this issue number is equivalent.']),
    ...(state.budget?.resetsAt ? [`Reported quota reset: ${new Date(state.budget.resetsAt * 1000).toISOString()}.`] : []),
  ].join('\n\n');
}
