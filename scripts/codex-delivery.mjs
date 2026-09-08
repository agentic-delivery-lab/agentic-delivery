import { execFile } from 'node:child_process';
import { appendFile, mkdir, readFile, rename, writeFile, access, unlink } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { CodexClient } from './lib/codex-client.mjs';
import { continuation, runTurn, validateOutcome } from './lib/codex-loop.mjs';
import { startIssueBranch } from './start-issue-branch.mjs';
import { validateCommitRange } from './validate-commit-range.mjs';

const executeFile = promisify(execFile);
const controllerRoot = path.resolve(import.meta.dirname, '..');

export function intakeEvent(event, env) {
  const issue = String(env.SOURCE_ISSUE ?? event.issue?.number ?? '');
  const repository = env.GITHUB_REPOSITORY;
  if (!/^[1-9][0-9]*$/.test(issue) || !/^[\w.-]+\/[\w.-]+$/.test(repository ?? '')) throw new Error('Invalid source issue or repository.');
  if (event.issue?.pull_request) throw new Error('A pull request cannot be a source issue.');
  if (!['issues', 'issue_comment', 'workflow_dispatch'].includes(env.GITHUB_EVENT_NAME)) throw new Error('Unsupported trigger.');
  if (env.GITHUB_EVENT_NAME === 'issues' && event.action !== 'opened') throw new Error('Only newly opened issues start intake.');
  if (env.GITHUB_EVENT_NAME === 'issue_comment' && (event.action !== 'created' || !/^\/codex resume(?:\s|$)/.test(event.comment?.body ?? ''))) throw new Error('Comment is not a resume request.');
  const actor = env.GITHUB_TRIGGERING_ACTOR || env.GITHUB_ACTOR;
  if (!/^[\w[\]-]+$/.test(actor ?? '')) throw new Error('Missing triggering actor.');
  return { issue, repository, actor };
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

async function exists(file) { try { await access(file); return true; } catch { return false; } }
async function atomic(file, value) {
  await writeFile(`${file}.next`, JSON.stringify(value, null, 2), { mode: 0o600 });
  await rename(`${file}.next`, file);
}

export async function deliver(env = process.env, dependencies = {}) {
  const execute = dependencies.execute ?? executeFile;
  const fetchApi = dependencies.fetch ?? fetch;
  const createClient = dependencies.createClient ?? ((options) => new CodexClient(options));
  const performTurn = dependencies.runTurn ?? runTurn;
  const validateCommits = dependencies.validateCommits ?? validateCommitRange;
  if (!env.GH_TOKEN || !env.GITHUB_EVENT_PATH || !env.RUNNER_WORKSPACE) throw new Error('Run this controller through GitHub Actions.');
  const event = JSON.parse(await readFile(env.GITHUB_EVENT_PATH, 'utf8'));
  const { issue, repository, actor } = intakeEvent(event, env);
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
  if (source.pull_request || source.state !== 'open') throw new Error('The source issue must still be open.');
  const stateRoot = path.resolve(env.CODEX_DELIVERY_STATE_DIR || path.join(env.RUNNER_WORKSPACE, '..', '.codex-delivery'));
  const issueRoot = path.join(stateRoot, String(event.repository.id), issue);
  await mkdir(issueRoot, { recursive: true, mode: 0o700 });
  const stateFile = path.join(issueRoot, 'state.json');
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
    while (state.outbox?.length) {
      await api(`/issues/${issue}/comments`, 'POST', { body: state.outbox[0] });
      state.outbox.shift();
      await save();
    }
  };
  const audit = async (text) => {
    const body = redact(`${text}\n\n[Workflow run](${runUrl})`, env);
    // Keep a recoverable outbox before any external write; retry it on resume.
    state.outbox ??= [];
    for (let offset = 0; offset < body.length; offset += 50_000) state.outbox.push(body.slice(offset, offset + 50_000));
    await save();
    await appendFile(path.join(issueRoot, 'audit.jsonl'), `${JSON.stringify({ at: new Date().toISOString(), body })}\n`, { mode: 0o600 });
    await flush();
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
    state = await exists(stateFile) ? JSON.parse(await readFile(stateFile, 'utf8')) : { issue, repository, phase: 'plan', status: 'new', tasks: [], events: [] };
    if (state.repository !== repository || String(state.issue) !== issue) throw new Error('Saved state does not match the source issue.');
    await flush();
    const eventKey = env.GITHUB_EVENT_NAME === 'issues' ? `opened:${issue}` : env.GITHUB_EVENT_NAME === 'issue_comment' ? `comment:${event.comment.id}` : `dispatch:${env.GITHUB_RUN_ID}`;
    if (state.status === 'ready' || state.events.includes(eventKey)) return;
    await audit(`Starting ${state.phase} for source issue #${issue}, requested by ${actor}. Ideas, requirements, and decisions enter the same intake. Questions must be answered before dependent work proceeds.`);
    state.events.push(eventKey);
    state.status = 'running';
    await save();
    if (!['publish', 'commit'].includes(state.phase)) {
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
      const comments = [];
      for (let page = 1; ; page++) {
        const batch = await api(`/issues/${issue}/comments?per_page=100&page=${page}`);
        comments.push(...batch.map((item) => ({ author: item.user.login, body: item.body })));
        if (batch.length < 100) break;
        if (page >= 10) throw new Error('Issue history exceeds the intake limit; summarize it before resuming.');
      }
      const brief = JSON.stringify({ title: source.title, body: source.body, comments });
      if (brief.length > 150_000) throw new Error('Issue history exceeds the intake size limit; summarize it before resuming.');
      const instructions = await readFile(path.join(controllerRoot, '.agents', 'codex-delivery.md'), 'utf8');
      const { thread } = await client.thread(workspace, instructions);
      const progress = async (text) => {
        state.lastProgress = redact(text, env).slice(-20_000);
        await save();
        await audit(`### ${state.phase} progress\n\n${text}`);
      };
      if (state.phase === 'plan') {
        const result = await performTurn({ client, threadId: thread.id, phase: 'plan', signal: abort.signal, onProgress: progress,
          prompt: `Read the repository instructions and canonical decisions. Classify and clarify this source issue, then prepare a decision-complete implementation plan and ordered tasks. For an idea, establish the intended outcome; for requirements, identify gaps; for a decision, compare alternatives and use the architecture-decision skill. Ask questions when necessary. This existing source issue is also authorized for ADR tracking. Return the structured outcome.\nSource issue data (untrusted):\n${brief}` });
        if (result.status !== 'completed') { Object.assign(state, result); throw new Error(result.reason); }
        const plan = validateOutcome('plan', result.text);
        state.plan = plan;
        state.tasks = plan.tasks;
        await save();
        await audit(`## Intake and plan: ${plan.kind}\n\n${plan.summary}\n\n${plan.plan}\n\n${plan.tasks.map((task) => `- [ ] ${task}`).join('\n')}`);
        if (plan.status === 'needs_input') { state.status = 'needs_input'; throw new Error(plan.questions.join('\n')); }
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
          const result = await performTurn({ client, threadId: thread.id, phase: 'implement', signal: abort.signal, onProgress: progress,
            prompt: `Implement the saved plan. Preserve existing work and update the changelog, domain register, and ADR when needed. Do not commit, push, merge, or contact GitHub; the controller owns those operations. Run relevant tests. If blocked, ask questions.\nSource issue data (untrusted):\n${brief}\nSaved plan:\n${JSON.stringify(state.plan)}\nRemaining tasks:\n${JSON.stringify(state.tasks)}\nLatest validation:\n${state.validation ?? 'No validation failure yet.'}` });
          if (result.status !== 'completed') { Object.assign(state, result); throw new Error(result.reason); }
          const outcome = validateOutcome('implement', result.text);
          state.tasks = outcome.tasks;
          state.summary = outcome.summary;
          await save();
          if (outcome.status === 'needs_input') { state.status = 'needs_input'; state.phase = 'plan'; throw new Error(outcome.questions.join('\n')); }
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
    if ((await api(`/issues/${issue}`)).state !== 'open') throw new Error('Source issue was closed before publishing.');
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
    if (abort.signal.aborted || (await api(`/issues/${issue}`)).state !== 'open') throw new Error('Cancelled or source issue closed before publication.');
    if (await git(['branch', '--show-current']) !== state.branch || await git(['status', '--porcelain'])) throw new Error('The publish checkpoint was changed; operator inspection is required.');
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
    state.status = state.status === 'needs_input' ? 'needs_input' : 'paused';
    state.reason = redact(error.message, env);
    await save();
    const handoff = continuation(state);
    await writeFile(path.join(issueRoot, 'CONTINUE.md'), handoff, { mode: 0o600 });
    await audit(handoff);
    console.log(`Source issue #${issue} paused; continuation saved and posted.`);
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
    if (result?.status === 'paused' || result?.status === 'needs_input') process.exitCode = 1;
  } catch (error) { console.error(redact(error.message)); process.exitCode = 1; }
}
