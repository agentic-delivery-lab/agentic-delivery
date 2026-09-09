import { execFile } from 'node:child_process';
import { appendFile, mkdir, readFile, rename, writeFile, access, unlink } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import { CodexClient } from './lib/codex-client.mjs';
import { continuation, formatPlanComment, formatProgressComment, runTurn, validateOutcome } from './lib/codex-loop.mjs';
import { startIssueBranch } from './start-issue-branch.mjs';
import { validateCommitRange } from './validate-commit-range.mjs';
import { validateBranchName } from './validate-branch-name.mjs';

const executeFile = promisify(execFile);
const controllerRoot = path.resolve(import.meta.dirname, '..');
const STATE_VERSION = 2;
const PROGRESS_COMMENT_INTERVAL_MS = 5 * 60_000;
const SESSION_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function commentId(value) {
  const id = String(value ?? '');
  if (!/^[1-9][0-9]*$/.test(id)) throw new Error('Issue comment ID is invalid.');
  return id;
}

function canonicalSessionId(value) {
  if (typeof value !== 'string' || !SESSION_ID_PATTERN.test(value)) throw new Error('Codex session ID is invalid.');
  return value;
}

function compareCommentIds(left, right) {
  return BigInt(left) === BigInt(right) ? 0 : BigInt(left) < BigInt(right) ? -1 : 1;
}

function trustedOwnerComment(event, repository) {
  const comment = event.comment;
  const owner = event.repository?.owner?.login ?? repository.split('/')[0];
  const user = comment?.user;
  if (user?.login !== owner || user?.type === 'Bot' || comment?.author_association !== 'OWNER') {
    throw new Error('Issue comments must come from the trusted repository owner.');
  }
  return {
    id: commentId(comment.id),
    body: typeof comment.body === 'string' ? comment.body : '',
    isResumeCommand: comment.body?.trim() === '/codex resume',
  };
}

export function intakeEvent(event, env) {
  const issue = String(env.SOURCE_ISSUE ?? event.issue?.number ?? '');
  const repository = env.GITHUB_REPOSITORY;
  if (!/^[1-9][0-9]*$/.test(issue) || !/^[\w.-]+\/[\w.-]+$/.test(repository ?? '')) throw new Error('Invalid source issue or repository.');
  if (event.repository?.full_name && event.repository.full_name !== repository) throw new Error('Event repository does not match the configured repository.');
  if (event.issue?.pull_request) throw new Error('A pull request cannot be a source issue.');
  if (!['issues', 'issue_comment', 'workflow_dispatch'].includes(env.GITHUB_EVENT_NAME)) throw new Error('Unsupported trigger.');
  if (env.GITHUB_EVENT_NAME === 'issues' && event.action !== 'opened') throw new Error('Only newly opened issues start intake.');
  let comment;
  if (env.GITHUB_EVENT_NAME === 'issue_comment') {
    if (event.action !== 'created') throw new Error('Only newly created issue comments enter intake.');
    if (event.issue?.number !== undefined && String(event.issue.number) !== issue) throw new Error('Comment issue number does not match SOURCE_ISSUE.');
    comment = trustedOwnerComment(event, repository);
  }
  const actor = comment ? event.comment.user.login : (env.GITHUB_TRIGGERING_ACTOR || env.GITHUB_ACTOR);
  if (!/^[\w[\]-]+$/.test(actor ?? '')) throw new Error('Missing triggering actor.');
  return { issue, repository, actor, comment };
}

export function redact(text, env = process.env) {
  let value = String(text);
  for (const key of ['GH_TOKEN', 'GITHUB_TOKEN', 'OPENAI_API_KEY']) if (env[key]) value = value.split(env[key]).join('[redacted]');
  return value.replace(/(?:github_pat_|gh[pousr]_|sk-)[A-Za-z0-9_-]{15,}/g, '[redacted]');
}

export function checkPublicationText(title, summary = '') {
  if (typeof title !== 'string' || !title.trim() || title.length > 120 || /[\r\n\x00-\x1f]/.test(title)) {
    throw new Error('The publication title must be a single line of at most 120 characters.');
  }
  const plain = `${title}\n${summary}`.replace(/[*_`]/g, '');
  if (/\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\s*:?\s+(?:[\w.-]+\/[\w.-]+)?#\d+|\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\s*:?\s+https:\/\/github\.com\//i.test(plain)) {
    throw new Error('Model publication text must not contain issue-closing directives.');
  }
}

export function deliveryExitCode(status) {
  return status === 'paused' ? 1 : 0;
}

async function exists(file) { try { await access(file); return true; } catch { return false; } }
async function atomic(file, value) {
  await writeFile(`${file}.next`, JSON.stringify(value, null, 2), { mode: 0o600 });
  await rename(`${file}.next`, file);
}

async function readSavedState(file, issue, repository) {
  const contents = await readFile(file, 'utf8');
  try {
    const value = JSON.parse(contents);
    const strings = (items) => Array.isArray(items) && items.every((item) => typeof item === 'string');
    const hash = (item) => typeof item === 'string' && /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(item);
    const legacy = value?.version === undefined;
    const status = value?.status === 'needs_input' ? 'awaiting-human' : value?.status;
    if (value?.repository !== repository || String(value?.issue) !== issue
      || (!legacy && value.version !== STATE_VERSION)
      || !['plan','branch','implement','verify','commit','publish'].includes(value.phase)
      || !['new','running','paused','awaiting-human','ready'].includes(status)
      || !strings(value.events) || !strings(value.tasks)
      || (value.questions !== undefined && !strings(value.questions))
      || (value.outbox !== undefined && !strings(value.outbox))
      || (value.auditCommentIds !== undefined && (!Array.isArray(value.auditCommentIds)
        || !value.auditCommentIds.every((id) => Number.isSafeInteger(id) && id > 0)))
      || (value.consumedCommentIds !== undefined && (!Array.isArray(value.consumedCommentIds)
        || !value.consumedCommentIds.every((id) => /^[1-9][0-9]*$/.test(String(id)))))
      || (value.sessionStarted !== undefined && typeof value.sessionStarted !== 'boolean')
      || (value.sessionStarted === false && value.sessionId !== undefined)
      || (value.legacySessionReconstruction !== undefined && typeof value.legacySessionReconstruction !== 'boolean')
      || (value.progressCommentAt !== undefined && (!Number.isFinite(value.progressCommentAt) || value.progressCommentAt < 0))
      || (value.progressCommentPhase !== undefined && !['plan','implement'].includes(value.progressCommentPhase))
      || (value.sessionId !== undefined && (typeof value.sessionId !== 'string' || !SESSION_ID_PATTERN.test(value.sessionId)))
      || (value.waitingCommentId !== undefined && !/^(?:0|[1-9][0-9]*)$/.test(String(value.waitingCommentId)))) throw new Error();
    if (value.branch !== undefined) {
      validateBranchName(value.branch);
      if (!value.branch.split('/')[1].startsWith(`issue-${issue}-`)) throw new Error();
    }
    if (value.plan !== undefined) validateOutcome('plan', JSON.stringify(value.plan));
    if (value.phase !== 'plan' && (!value.branch || !hash(value.base) || value.plan?.status !== 'ready')) throw new Error();
    if (['commit','publish'].includes(value.phase) && !hash(value.validatedTree)) throw new Error();
    const migrated = {
      ...value,
      version: STATE_VERSION,
      status,
      consumedCommentIds: value.consumedCommentIds?.map(String) ?? [],
      sessionStarted: value.sessionStarted ?? value.sessionId !== undefined,
      legacySessionReconstruction: value.legacySessionReconstruction === true || (legacy && value.sessionId === undefined),
    };
    if (migrated.status === 'awaiting-human' && migrated.waitingCommentId === undefined) {
      migrated.waitingCommentId = String(Math.max(0, ...(value.auditCommentIds ?? [])));
    }
    return migrated;
  } catch {
    throw new Error('Invalid saved state; preserve the issue directory for operator inspection.');
  }
}

export async function deliver(env = process.env, dependencies = {}) {
  const execute = dependencies.execute ?? executeFile;
  const fetchApi = dependencies.fetch ?? fetch;
  const createClient = dependencies.createClient ?? ((options) => new CodexClient(options));
  const performTurn = dependencies.runTurn ?? runTurn;
  const validateCommits = dependencies.validateCommits ?? validateCommitRange;
  if (!env.GH_TOKEN || !env.GITHUB_EVENT_PATH || !env.RUNNER_WORKSPACE) throw new Error('Run this controller through GitHub Actions.');
  const event = JSON.parse(await readFile(env.GITHUB_EVENT_PATH, 'utf8'));
  const { issue, repository, actor, comment } = intakeEvent(event, env);
  const endpoint = `https://api.github.com/repos/${repository}`;
  const api = async (route, method = 'GET', body) => {
    const response = await fetchApi(`${endpoint}${route}`, {
      method, headers: { Authorization: `Bearer ${env.GH_TOKEN}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'Content-Type': 'application/json' },
      ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) throw new Error(`GitHub ${method} ${route} failed (${response.status}).`);
    return response.status === 204 ? null : response.json();
  };
  const permission = await api(`/collaborators/${encodeURIComponent(actor)}/permission`);
  if (!['admin', 'maintain', 'write'].includes(permission.permission)) throw new Error('Source issue execution requires repository write permission.');
  const source = await api(`/issues/${issue}`);
  if (source.pull_request) throw new Error('A pull request cannot be a source issue.');
  if (source.state !== 'open') {
    if (env.GITHUB_EVENT_NAME === 'issue_comment') return {status:'ignored', reason:'The source issue is inactive.'};
    throw new Error('The source issue must still be open.');
  }
  const stateRoot = path.resolve(env.CODEX_DELIVERY_STATE_DIR || path.join(env.RUNNER_WORKSPACE, '..', '.codex-delivery'));
  const issueRoot = path.join(stateRoot, String(event.repository.id), issue);
  const stateFile = path.join(issueRoot, 'state.json');
  const stateWasSaved = await exists(stateFile);
  if (env.GITHUB_EVENT_NAME === 'issue_comment' && !stateWasSaved) {
    return {status:'ignored', reason:'No saved continuation state exists for this issue.'};
  }
  await mkdir(issueRoot, { recursive: true, mode: 0o700 });
  const workspace = path.join(issueRoot, 'workspace');
  let state;
  const runUrl = `https://github.com/${repository}/actions/runs/${env.GITHUB_RUN_ID}`;
  let writes = Promise.resolve();
  const save = () => {
    const snapshot = structuredClone(state);
    writes = writes.catch(() => {}).then(() => atomic(stateFile, snapshot));
    return writes;
  };
  const flush = async () => {
    const postedIds = [];
    while (state.outbox?.length) {
      const posted = await api(`/issues/${issue}/comments`, 'POST', { body: state.outbox[0] });
      (state.auditCommentIds ??= []).push(posted.id);
      postedIds.push(String(posted.id));
      state.outbox.shift();
      await save();
    }
    return postedIds;
  };
  const audit = async (text) => {
    const body = redact(`${text}\n\n[Workflow run](${runUrl})`, env);
    // Keep a recoverable outbox before any external write; retry it on resume.
    state.outbox ??= [];
    for (let offset = 0; offset < body.length; offset += 50_000) state.outbox.push(body.slice(offset, offset + 50_000));
    await save();
    await appendFile(path.join(issueRoot, 'audit.jsonl'), `${JSON.stringify({ at: new Date().toISOString(), body })}\n`, { mode: 0o600 });
    return flush();
  };
  const readBrief = async (excludedCommentId) => {
    const current = await api(`/issues/${issue}`);
    if (current.state !== 'open' || current.pull_request) throw new Error('The source issue must still be open.');
    const ownComments = new Set((state.auditCommentIds ?? []).map(String));
    const comments = [];
    for (let page = 1; ; page++) {
      const batch = await api(`/issues/${issue}/comments?per_page=100&page=${page}`);
      comments.push(...batch.filter((item) => {
        const login = String(item.user?.login ?? '');
        const bot = item.user?.type === 'Bot' || login.endsWith('[bot]') || login === 'github-actions';
        return !ownComments.has(String(item.id)) && String(item.id) !== String(excludedCommentId ?? '')
          && item.body?.trim() !== '/codex resume' && !bot;
      })
        .map((item) => ({ id:item.id, author:item.user.login, body:item.body })));
      if (batch.length < 100) break;
      if (page >= 10) throw new Error('Issue history exceeds the intake limit; summarize it before resuming.');
    }
    const brief = JSON.stringify({ title:current.title, body:current.body, comments });
    if (brief.length > 150_000) throw new Error('Issue history exceeds the intake size limit; summarize it before resuming.');
    return brief;
  };
  const digest = (brief) => createHash('sha256').update(brief).digest('hex');
  const requireCurrentBrief = async (brief) => {
    if (state.sourceDigest !== digest(brief)) {
      state.phase = 'plan';
      state.tasks = ['Review the changed source issue and discussion, then update the saved plan.', ...(state.tasks ?? [])];
      await save();
      throw new Error('Source issue requirements or discussion changed, or the saved snapshot is missing. Resume planning before continuing; existing files are preserved.');
    }
  };
  const lockFile = path.join(stateRoot, 'account.lock');
  let lock;
  try { lock = await import('node:fs/promises').then(({ open }) => open(lockFile, 'wx', 0o600)); }
  catch (error) {
    if (error.code !== 'EEXIST') throw error;
    await api(`/issues/${issue}/comments`, 'POST', { body: 'Codex execution is already locked on this runner. After the active run finishes, comment `/codex resume`. If a run was killed, an operator must inspect the saved lock and confirm no Codex process is active before removing it.' });
    return;
  }
  let client;
  const abort = new AbortController();
  const cancel = () => { abort.abort(); client?.close().catch(() => {}); };
  process.once('SIGTERM', cancel);
  process.once('SIGINT', cancel);
  const overall = setTimeout(cancel, 45 * 60_000);
  const gitEnv = {
    ...env, GIT_TERMINAL_PROMPT: '0', GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null',
    GIT_CONFIG_COUNT: '2', GIT_CONFIG_KEY_0: 'http.https://github.com/.extraheader',
    GIT_CONFIG_VALUE_0: `AUTHORIZATION: basic ${Buffer.from(`x-access-token:${env.GH_TOKEN}`).toString('base64')}`,
    GIT_CONFIG_KEY_1: 'core.hooksPath', GIT_CONFIG_VALUE_1: '/dev/null',
  };
  const git = async (args) => (await execute('git', ['-C', workspace, ...args], { env: gitEnv, timeout: 120_000, maxBuffer: 8_000_000 })).stdout.trim();
  try {
    await lock.writeFile(JSON.stringify({ runUrl, issue, pid: process.pid }));
    state = stateWasSaved ? await readSavedState(stateFile, issue, repository) : {
      version: STATE_VERSION, issue, repository, phase: 'plan', status: 'new', tasks: [], events: [], consumedCommentIds: [], sessionStarted: false,
    };
    const priorStatus = state.status;
    const canStartInitialSession = !stateWasSaved
      || (priorStatus === 'paused' && state.phase === 'plan' && !state.plan && state.sessionStarted === false && !state.sessionId);
    await flush();
    if (stateWasSaved && state.legacySessionReconstruction && state.sessionId === undefined) await save();
    const eventKey = env.GITHUB_EVENT_NAME === 'issues' ? `opened:${issue}` : env.GITHUB_EVENT_NAME === 'issue_comment' ? `comment:${comment.id}` : `dispatch:${env.GITHUB_RUN_ID}`;
    if (state.status === 'ready' || state.status === 'running' || state.events.includes(eventKey)
      || (comment && state.consumedCommentIds.includes(comment.id))) return {status:'ignored', reason:'This delivery event is already complete or in progress.'};
    if (env.GITHUB_EVENT_NAME === 'issue_comment') {
      if (state.status === 'new') return {status:'ignored', reason:'An issue comment cannot start a new delivery task.'};
      if (state.status === 'paused' && !comment.isResumeCommand) return {status:'ignored', reason:'Only a bare /codex resume recovers a technical pause.'};
      if (state.status === 'awaiting-human') {
        if (comment.isResumeCommand || !comment.body.trim()) return {status:'ignored', reason:'A waiting state requires a human continuation comment.'};
        if (compareCommentIds(comment.id, state.waitingCommentId ?? '0') <= 0) return {status:'ignored', reason:'The comment is at or before the waiting boundary.'};
      }
      if (!['paused','awaiting-human'].includes(state.status)) return {status:'ignored', reason:'The saved state is not eligible for issue-comment continuation.'};
    }
    state.events.push(eventKey);
    if (comment) state.consumedCommentIds.push(comment.id);
    state.status = 'running';
    await save();
    await audit(`Starting ${state.phase} for source issue #${issue}, requested by ${actor}. Ideas, requirements, and decisions enter the same intake. Questions must be answered before dependent work proceeds.`);
    if (!['publish', 'commit'].includes(state.phase)) {
      if (stateWasSaved && !state.sessionId && !state.legacySessionReconstruction && !canStartInitialSession
        && ['plan','branch','implement'].includes(state.phase)) {
        throw new Error('Saved Codex session ID is missing; refusing to start an unrelated replacement thread.');
      }
      client = createClient({ cwd: controllerRoot, readableFiles:[controllerRoot], runtime:path.join(issueRoot, 'tools') });
      await client.initialize();
      state.budget = await client.capabilities();
      if (state.budget.stop && state.phase !== 'verify') throw new Error(state.budget.reason);
      if (!(await exists(workspace))) {
        await execute('git', ['clone', '--branch', 'main', `https://github.com/${repository}.git`, workspace], { env: gitEnv, timeout: 120_000 });
        state.base = await git(['rev-parse', 'HEAD']);
        await save();
      }
      if (!state.base) {
        if (await git(['branch', '--show-current']) !== 'main') throw new Error('Incomplete clone checkpoint requires operator inspection.');
        state.base = await git(['rev-parse', 'HEAD']);
        await save();
      }
      const brief = await readBrief(comment?.id);
      if (state.phase === 'plan') { state.sourceDigest = digest(brief); await save(); }
      else await requireCurrentBrief(brief);
      if (comment && !comment.isResumeCommand) {
        state.sourceDigest = digest(await readBrief());
        await save();
      }
      const instructions = await readFile(path.join(controllerRoot, '.agents', 'codex-delivery.md'), 'utf8');
      let thread;
      const ensureThread = async () => {
        if (thread) return thread;
        let response;
        if (state.sessionId) {
          response = await client.resumeThread(workspace, state.sessionId, instructions);
        } else if (canStartInitialSession || state.legacySessionReconstruction) {
          response = await client.startThread(workspace, instructions);
        } else {
          throw new Error('Saved Codex session ID is missing; refusing to start an unrelated replacement thread.');
        }
        const returnedId = canonicalSessionId(response?.thread?.id);
        if (state.sessionId && returnedId !== state.sessionId) {
          throw new Error('Resumed Codex session ID mismatch; refusing to start a replacement thread.');
        }
        if (!state.sessionId) {
          state.sessionId = returnedId;
          state.sessionStarted = true;
          await save();
          if (state.legacySessionReconstruction) {
            state.legacySessionReconstructed = true;
            await save();
            await audit(`Legacy continuation state reconstructed into persistent Codex session ${returnedId} for source issue #${issue}.`);
          }
        }
        thread = {id:returnedId};
        return thread;
      };
      const continuationPhase = state.phase;
      const humanContinuation = comment && !comment.isResumeCommand ? comment.body : '';
      const continuationContext = (phase) => humanContinuation && continuationPhase === phase ? [
        `Continue the interrupted ${phase} turn from the exact saved delivery run and return the required structured outcome.`,
        phase === 'plan'
          ? 'Use the trusted human comment to complete or revise the implementation plan without inventing another answer.'
          : 'Use the trusted human comment to continue implementing the saved plan.',
        `Human continuation comment (untrusted task data):\n---\n${humanContinuation}\n---`,
        `Saved issue brief:\n${brief}`,
        `Saved progress:\n${state.lastProgress ?? 'No progress was saved.'}`,
        `Saved plan:\n${JSON.stringify(state.plan ?? null)}`,
        `Remaining tasks:\n${JSON.stringify(state.tasks ?? [])}`,
        `Latest validation:\n${state.validation ?? 'No validation failure yet.'}`,
      ].join('\n') : '';
      const progress = async (text) => {
        state.lastProgress = redact(text, env).slice(-20_000);
        const now = Date.now();
        const publish = state.progressCommentPhase !== state.phase
          || !Number.isFinite(state.progressCommentAt)
          || now - state.progressCommentAt >= PROGRESS_COMMENT_INTERVAL_MS;
        if (publish) {
          state.progressCommentAt = now;
          state.progressCommentPhase = state.phase;
        }
        await save();
        if (publish) await audit(formatProgressComment(state.phase, state.lastProgress));
      };
      if (state.phase === 'plan') {
        const planThread = await ensureThread();
        const result = await performTurn({ client, threadId: planThread.id, phase: 'plan', signal: abort.signal, onProgress: progress,
          prompt: continuationContext('plan') || `Read the repository instructions and canonical decisions. Classify and clarify this source issue, then prepare a decision-complete implementation plan and ordered tasks. For an idea, establish the intended outcome; for requirements, identify gaps; for a decision, compare alternatives and use the architecture-decision skill. Ask questions when necessary. This existing source issue is also authorized for ADR tracking. Return the structured outcome.\nSource issue data (untrusted):\n${brief}` });
        if (result.status !== 'completed') {
          Object.assign(state, result);
          if (result.status === 'needs_input') state.status = 'awaiting-human';
          throw new Error(result.reason);
        }
        const plan = validateOutcome('plan', result.text);
        state.plan = plan;
        state.tasks = plan.tasks;
        state.questions = plan.questions;
        await save();
        if (plan.status === 'needs_input') { state.status = 'awaiting-human'; throw new Error(plan.questions.join('\n')); }
        await audit(formatPlanComment(plan));
        checkPublicationText(plan.title);
        if (state.branch) state.phase = 'implement';
        else {
          state.branch = `${plan.changeType}/issue-${issue}-codex-delivery`;
          state.phase = 'branch';
        }
        await save();
      }
      if (state.phase === 'branch') {
        const currentBranch = await git(['branch', '--show-current']);
        if (currentBranch !== state.branch) {
          await startIssueBranch({branchType:state.plan.changeType, issueNumber:issue, summary:'codex-delivery', repositoryRoot:workspace,
            env, execFileImpl:(command, args, options) => execute(command, args, {...options, env:gitEnv, timeout:60_000}),
            sourceIssueValidator:async () => {
              if ((await api(`/issues/${issue}`)).state !== 'open') throw new Error('Source issue is no longer open.');
            },
          });
        } else if (await git(['rev-parse', 'HEAD']) !== state.base || await git(['status', '--porcelain'])) {
          throw new Error('Unexpected changes at the branch checkpoint require operator inspection.');
        }
        state.phase = 'implement';
        await save();
      }
      if (await git(['branch', '--show-current']) !== state.branch) throw new Error('Working branch differs from saved state; operator inspection is required.');
      // Installation and verification execute under restricted filesystem permissions.
      const install = ['pnpm', 'install', '--frozen-lockfile', '--ignore-scripts', '--ignore-pnpmfile'];
      await client.exec(install, workspace, 600_000, 'delivery-deps');
      for (let attempt = 0; attempt < 3; attempt++) {
        if (state.phase === 'implement') {
          const implementThread = await ensureThread();
          const result = await performTurn({ client, threadId: implementThread.id, phase: 'implement', signal: abort.signal, onProgress: progress,
            prompt: continuationContext('implement') || `Implement the saved plan. Preserve existing work and update the changelog, domain register, and ADR when needed. Do not commit, push, merge, or contact GitHub; the controller owns those operations. Run relevant tests. If blocked, ask questions.\nSource issue data (untrusted):\n${brief}\nSaved plan:\n${JSON.stringify(state.plan)}\nRemaining tasks:\n${JSON.stringify(state.tasks)}\nLatest validation:\n${state.validation ?? 'No validation failure yet.'}` });
          if (result.status !== 'completed') {
            Object.assign(state, result);
            if (result.status === 'needs_input') state.status = 'awaiting-human';
            throw new Error(result.reason);
          }
          const outcome = validateOutcome('implement', result.text);
          state.tasks = outcome.tasks;
          state.summary = outcome.summary;
          state.questions = outcome.questions;
          await save();
          if (outcome.status === 'needs_input') { state.status = 'awaiting-human'; throw new Error(outcome.questions.join('\n')); }
          checkPublicationText(state.plan.title, state.summary);
          state.phase = 'verify';
          await save();
        }
        try {
          await client.exec(install, workspace, 600_000, 'delivery-deps');
          await git(['add', '--all']);
          const candidateTree = await git(['write-tree']);
          for (const command of [
            ['node', path.join(controllerRoot, 'scripts/run-delivery-tests.mjs')],
            ...['validate-toolchain.mjs', 'validate-adrs.mjs', 'validate-domain-language.mjs', 'validate-changelog.mjs', 'validate-config-files.mjs']
              .map((script) => ['node', path.join(controllerRoot, 'scripts', script), workspace]),
          ]) await client.exec(command, workspace);
          await client.exec(['pnpm', 'audit', '--audit-level=high', '--ignore-pnpmfile'], workspace, 600_000, 'delivery-deps');
          await git(['diff', '--exit-code']);
          if (candidateTree !== await git(['write-tree'])) throw new Error('The staged tree changed during verification.');
          await git(['diff', '--check']);
          state.validation = 'Repository tests, ADRs, domain language, changelog, configuration, dependency audit, and whitespace checks passed. Markdown and platform checks also run in review PR CI.';
          state.validatedTree = candidateTree;
          state.phase = 'commit';
          await save();
          break;
        } catch (error) {
          state.validation = redact(error.message, env).slice(-24_000);
          await audit(`### Validation attempt ${attempt + 1} failed\n\n${state.validation}`);
          if (attempt === 2) throw new Error('Three validation attempts failed; review the saved diagnostics before resuming.');
          state.phase = 'implement';
          await save();
        }
      }
    }
    // Stop every owned model/tool process before committing the verified tree.
    await client?.close();
    if (state.phase === 'commit') {
    if (abort.signal.aborted) throw new Error('Workflow cancelled before publishing.');
    await requireCurrentBrief(await readBrief());
    // Git metadata is read-only to model tools. Publish only the recorded head.
    if (await git(['branch', '--show-current']) !== state.branch) throw new Error('Refusing to publish an unexpected branch.');
    await git(['diff', '--exit-code']);
    if (await git(['write-tree']) !== state.validatedTree || await git(['ls-files', '--others', '--exclude-standard'])) {
      throw new Error('The verified tree changed before commit; operator inspection is required.');
    }
    const changes = await git(['status', '--porcelain']);
    if (changes) {
      await execute('node', [path.join(controllerRoot, 'scripts/validate-pull-request-title.mjs')], { cwd: controllerRoot, env: { ...env, PR_TITLE: state.plan.title }, timeout: 30_000 });
      await git(['-c', 'user.name=github-actions[bot]', '-c', 'user.email=41898282+github-actions[bot]@users.noreply.github.com', '-c', 'commit.gpgsign=false', 'commit', '-m', state.plan.title]);
    }
    state.phase = 'publish';
    await save();
    }
    checkPublicationText(state.plan.title, state.summary);
    if (abort.signal.aborted) throw new Error('Cancelled before publication.');
    await requireCurrentBrief(await readBrief());
    if (await git(['branch', '--show-current']) !== state.branch || await git(['status', '--porcelain'])) throw new Error('The publish checkpoint was changed; operator inspection is required.');
    if (await git(['write-tree']) !== state.validatedTree) throw new Error('The publish checkpoint no longer matches the verified tree; operator inspection is required.');
    await validateCommits({base:state.base, head:'HEAD', repositoryRoot:workspace, toolingRoot:controllerRoot});
    if (!await git(['diff', '--name-only', `${state.base}...HEAD`])) throw new Error('No repository change is ready for a review pull request.');
    await git(['push', 'origin', `HEAD:refs/heads/${state.branch}`]);
    const existing = await api(`/pulls?state=open&head=${encodeURIComponent(`${repository.split('/')[0]}:${state.branch}`)}&base=main`);
    const body = `## Summary\n\n${state.summary}\n\nCloses #${issue}\n\n## Verification\n\n${state.validation}\n\nThe source issue contains intake, the plan, progress, and any clarification or continuation history. Human review and merge authorization remain required.\n\n[Workflow run](${runUrl})`;
    const pr = existing[0] ? await api(`/pulls/${existing[0].number}`, 'PATCH', { title: state.plan.title, body })
      : await api('/pulls', 'POST', { title: state.plan.title, head: state.branch, base: 'main', body });
    state.pr = pr.html_url;
    state.status = 'ready';
    state.tasks = [];
    await save();
    await audit(`## Review pull request ready\n\n${state.pr}\n\n${state.validation}\n\nA human may need to select **Approve workflows to run** for CI created by the workflow token. Review and merge remain human actions.`);
  } catch (error) {
    if (!state) throw error;
    await client?.close().catch((failure) => { state.shutdownError = redact(failure.message, env); });
    const awaitingHuman = state.status === 'awaiting-human';
    state.status = awaitingHuman ? 'awaiting-human' : 'paused';
    state.reason = redact(error.message, env);
    await save();
    const handoff = continuation(state);
    await writeFile(path.join(issueRoot, 'CONTINUE.md'), handoff, { mode: 0o600 });
    try {
      const postedIds = await audit(handoff);
      if (awaitingHuman) {
        const boundary = postedIds.at(-1);
        if (!boundary) throw new Error('The awaiting-human boundary comment was not posted.');
        state.waitingCommentId = boundary;
        await save();
      }
    } catch (communicationError) {
      state.status = 'paused';
      state.reason = redact(communicationError.message, env);
      await save();
      throw communicationError;
    }
    console.log(`Source issue #${issue} ${awaitingHuman ? 'awaiting human input' : 'paused'}; continuation saved and posted.`);
    return {status:state.status, reason:state.reason};
  } finally {
    clearTimeout(overall);
    process.off('SIGTERM', cancel);
    process.off('SIGINT', cancel);
    // If shutdown cannot be confirmed, deliberately retain the account lock.
    try { await client?.close(); await writes; }
    finally { await lock.close(); }
    await unlink(lockFile);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const result = await deliver();
    process.exitCode = deliveryExitCode(result?.status);
  } catch (error) { console.error(redact(error.message)); process.exitCode = 1; }
}
