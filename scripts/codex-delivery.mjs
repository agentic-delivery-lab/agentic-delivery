// agentic-primitive: {"id":"codex-delivery-controller","kind":"state-machine","enforcement":"deterministic","adrs":["ADR-0009","ADR-0012","ADR-0015"],"domains":["agentic-delivery-governance"]}
import { execFile } from 'node:child_process';
import { appendFile, mkdir, mkdtemp, readdir, readFile, rename, rm, symlink, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import { CodexClient } from './lib/codex-client.mjs';
import { continuation, formatPlanComment, formatProgressComment, formatRefinementComment, orchestrationOutcomeSchema, runTurn, validateOrchestrationOutcome, validateOutcome, validateRefinementOutcome } from './lib/codex-loop.mjs';
import { classifyIssue } from './lib/issue-routing.mjs';
import { loadLifecycleConfig } from './issue-intake.mjs';
import { startIssueBranch } from './start-issue-branch.mjs';
import { validateCommitRange } from './validate-commit-range.mjs';
import { validateBranchName } from './validate-branch-name.mjs';
import { deterministicReview, validateEvidenceRecord } from './lib/architecture-review.mjs';
import { validateTransition } from './lib/lifecycle-transitions.mjs';
import { appConfiguration, GithubAppTokenProvider } from './lib/github-app.mjs';
import { bodyDigest } from './lib/agent-invocation.mjs';
import { bindIssueMetadataConfig, githubGraphqlApi, readIssueControlPlane, setIssueFields, setIssueType, validateOrganizationIssueFields } from './lib/issue-field-api.mjs';
import { issueMetadata, issueFieldMutation, validateFieldMutation } from './lib/issue-metadata.mjs';
import { patternById, selectOrchestration } from './lib/orchestration-policy.mjs';

const executeFile = promisify(execFile);
const controllerRoot = path.resolve(import.meta.dirname, '..');
const STATE_VERSION = 3;
const PROGRESS_COMMENT_INTERVAL_MS = 5 * 60_000;
const OVERALL_TIMEOUT_MS = 5.5 * 60 * 60_000;
const SESSION_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const STAGE_TARGETS = Object.freeze({
  'needs-triage': { stage: 'intake', readiness: 'not-ready' },
  // Needs information is an orthogonal readiness gate. It must not move an
  // implementation back to Intake or erase its current lifecycle position.
  'needs-info': { stage: null, readiness: 'needs-info' },
  requirements: { stage: 'definition', readiness: 'not-ready' },
  decomposing: { stage: 'definition', readiness: 'waiting' },
  'decision-needed': { stage: 'decision', readiness: 'needs-info' },
  investigating: { stage: 'discovery', readiness: 'working' },
  parked: { stage: 'parked', readiness: 'waiting' },
  'ready-for-plan': { stage: 'planning', readiness: 'ready' },
  'ready-for-agent': { stage: 'execution', readiness: 'ready' },
  'in-progress': { stage: 'execution', readiness: 'working' },
  review: { stage: 'validation', readiness: 'awaiting-human' },
  coordinating: { stage: 'acceptance', readiness: 'waiting' },
  acceptance: { stage: 'acceptance', readiness: 'awaiting-human' },
  done: { stage: 'done', readiness: 'awaiting-human' },
});

function stageTarget(target) {
  return STAGE_TARGETS[target] ?? { stage: target, readiness: undefined };
}

function deliveryPhases() {
  return ['refine', 'research', 'requirements', 'architecture', 'plan', 'implement', 'validate', 'coordinate', 'branch', 'verify', 'commit', 'publish'];
}

function profileForPhase(phase) {
  return {
    refine: 'discovery', research: 'research', requirements: 'requirements', architecture: 'architecture-decision',
    plan: 'planner', implement: 'implementer', validate: 'validator', coordinate: 'coordinator',
  }[phase] ?? 'planner';
}

function orchestrationPatternForRoute(route, phase, workType) {
  if (route === 'refine' && phase === 'coordinate') return 'parent-coordination';
  if (route === 'refine' && !workType) return null;
  if (route === 'resume' || route === 'manual') {
    return {
      refine: workType ? 'idea-discovery' : null,
      research: 'research-only', requirements: 'requirements', architecture: 'architecture-decision',
      plan: 'implementation-fresh', implement: 'implementation-continuation', validate: 'validation-only',
      coordinate: 'parent-coordination',
    }[phase] ?? null;
  }
  return {
    refine: 'idea-discovery', research: 'research-only', requirements: 'requirements', architecture: 'architecture-decision',
    plan: 'implementation-fresh', implement: 'implementation-existing-plan', validate: 'validation-only', coordinate: 'parent-coordination',
  }[route] ?? null;
}

function stageToControllerTarget(stage, phase) {
  const fallback = { research: 'requirements', requirements: 'requirements', architecture: 'decision-needed', validate: 'acceptance' }[phase];
  return {
    intake: 'needs-triage', discovery: 'investigating', definition: 'requirements', decision: 'decision-needed',
    planning: 'ready-for-plan', execution: 'ready-for-agent', validation: 'review', acceptance: 'acceptance',
    parked: 'parked', done: 'done',
  }[stage] ?? fallback;
}

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
  const user = comment?.user;
  if (!user?.login || user.type === 'Bot' || user.login.endsWith('[bot]') || comment?.author_association === 'BOT') {
    throw new Error('Issue comments must come from a non-bot repository user.');
  }
  return {
    id: commentId(comment.id),
    body: typeof comment.body === 'string' ? comment.body : '',
  };
}

export function intakeEvent(event, env) {
  const issue = String(env.SOURCE_ISSUE ?? event.issue?.number ?? '');
  const repository = env.GITHUB_REPOSITORY;
  if (!/^[1-9][0-9]*$/.test(issue) || !/^[\w.-]+\/[\w.-]+$/.test(repository ?? '')) throw new Error('Invalid source issue or repository.');
  if (event.repository?.full_name && event.repository.full_name !== repository) throw new Error('Event repository does not match the configured repository.');
  if (event.issue?.pull_request) throw new Error('A pull request cannot be a source issue.');
  if (!['issues', 'issue_comment', 'workflow_dispatch', 'workflow_call'].includes(env.GITHUB_EVENT_NAME)) throw new Error('Unsupported trigger.');
  if (env.GITHUB_EVENT_NAME === 'issues'
    && !['opened', 'edited', 'reopened', 'labeled', 'unlabeled', 'typed', 'untyped', 'closed'].includes(event.action)) throw new Error('Unsupported issue activity.');
  let comment;
  if (env.GITHUB_EVENT_NAME === 'issue_comment' || event.comment) {
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
  const secrets = ['GH_TOKEN', 'PUBLISH_TOKEN', 'GITHUB_TOKEN', 'OPENAI_API_KEY', 'CODEX_DELIVERY_APP_PRIVATE_KEY']
    .map((key) => env[key]).filter(Boolean).sort((left, right) => right.length - left.length);
  for (const secret of secrets) value = value.split(secret).join('[redacted]');
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

function evidenceMarker(evidence) {
  return `<!-- codex-delivery-evidence:v1\n${JSON.stringify(evidence)}\n-->`;
}

function singleLine(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

export function formatPullRequestBody({ issue, repository, plan, summary, validation, runUrl, evidence }) {
  return `## Summary

${summary}

## Source

- Source issue: Closes #${issue}

## Plan

- Implementation plan: Issue #${issue} saved plan — ${singleLine(plan.plan)}
- Plan deviations: No material deviations were reported; reviewers must compare the diff with the saved plan.

## Changes

- ${singleLine(summary)}

## Verification

${validation}

## Evidence

The source issue contains intake, planning, progress, and continuation history. This record connects the revision to the delivery run, Codex session, architecture context, and validation checkpoint.

[Workflow run](${runUrl})

${evidenceMarker(evidence)}

## Risk and delivery

- Risk level and impact: Human review is required; assess the diff and reported checks before merge.
- Security and privacy: Review changes to permissions, dependencies, workflows, credentials, and sensitive-data handling.
- Breaking changes and compatibility: Review the diff and source issue for compatibility impact before merge.
- Deployment or migration: Merge through the repository review workflow and follow any change-specific guidance in the source issue.
- Rollback: Revert the merge commit unless the source issue documents a safer change-specific rollback.
- Dependencies and follow-up work: Track unresolved dependencies or follow-up work in the source issue.

## Review guidance

- Review focus: Saved-plan alignment, verification evidence, architecture impact, and delivery risk.
- Suggested review order: Source issue and plan, diff, verification evidence, then risk and rollback.
- Out of scope: Merge authorization, source-issue closure, and release creation remain human decisions.

## Author checklist

- [x] I reviewed my own diff and removed accidental or unrelated changes.
- [x] The source issue, implementation plan, and any deviations are recorded above.
- [x] Verification evidence is complete, and failures or skipped checks are explained.
- [x] Tests, documentation, release notes, and operational guidance are updated where needed.
- [x] Security, privacy, compatibility, deployment, and rollback effects are assessed.
- [x] This pull request contains no secrets, unnecessary personal data, or sensitive logs.`;
}

async function evidenceCheckpoint(auditFile) {
  try {
    const source = await readFile(auditFile, 'utf8');
    return {
      entryCount: source.split(/\r?\n/).filter(Boolean).length,
      sha256: createHash('sha256').update(source).digest('hex'),
    };
  } catch {
    return { entryCount: 0, sha256: createHash('sha256').update('').digest('hex') };
  }
}

export function deliveryExitCode(status) {
  return status === 'paused' ? 1 : 0;
}

function failureRecoverability(error, operation) {
  const message = String(error?.message ?? '');
  if (/invalid saved state|operator inspection|unexpected changes|verified tree changed|session id mismatch|unrelated replacement/i.test(message)) {
    return 'operator-inspection';
  }
  if (/quota|allowance|telemetry|timeout|timed out|network|GitHub .* failed \(5\d\d\)|app-server stopped/i.test(message)) {
    return 'retryable';
  }
  return operation === 'publish' || operation === 'commit' ? 'operator-inspection' : 'owner-action';
}

async function exists(file) { try { await import('node:fs/promises').then(({ access }) => access(file)); return true; } catch { return false; } }
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
      || (!legacy && ![2, STATE_VERSION].includes(value.version))
      || !deliveryPhases().includes(value.phase)
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
      || (value.progressCommentPhase !== undefined && !['refine','research','requirements','architecture','plan','implement','validate'].includes(value.progressCommentPhase))
      || (value.sessionId !== undefined && (typeof value.sessionId !== 'string' || !SESSION_ID_PATTERN.test(value.sessionId)))
      || (value.waitingCommentId !== undefined && !/^(?:0|[1-9][0-9]*)$/.test(String(value.waitingCommentId)))
      || (value.execution !== undefined && (!value.execution || typeof value.execution !== 'object'
        || !['idle', 'running', 'paused', 'awaiting-human', 'completed'].includes(value.execution.status)
        || (value.execution.operation !== null && typeof value.execution.operation !== 'string')
        || (value.execution.run !== null && (!value.execution.run || !/^\d+$/.test(String(value.execution.run.id ?? ''))
          || !/^\d+$/.test(String(value.execution.run.attempt ?? '')) || typeof value.execution.run.url !== 'string'))
        || (value.execution.lastFailure !== null && (!value.execution.lastFailure
          || typeof value.execution.lastFailure.operation !== 'string'
          || typeof value.execution.lastFailure.runId !== 'string'
          || typeof value.execution.lastFailure.reason !== 'string'
          || !['retryable', 'owner-action', 'operator-inspection'].includes(value.execution.lastFailure.recoverability)))))) throw new Error();
    if (value.branch !== undefined) {
      validateBranchName(value.branch);
      if (!value.branch.split('/')[1].startsWith(`issue-${issue}-`)) throw new Error();
    }
    if (value.refined !== undefined) validateRefinementOutcome(JSON.stringify(value.refined));
    if (value.plan !== undefined) validateOutcome('plan', JSON.stringify(value.plan));
    if (!['refine', 'research', 'requirements', 'architecture', 'plan', 'validate', 'coordinate'].includes(value.phase) && (!value.branch || !hash(value.base) || value.plan?.status !== 'ready')) throw new Error();
    if (['commit','publish'].includes(value.phase) && !hash(value.validatedTree)) throw new Error();
    const migrated = {
      ...value,
      version: STATE_VERSION,
      status,
      execution: value.execution ?? {
        status: status === 'ready' ? 'completed' : status === 'running' ? 'running' : status,
        operation: value.phase,
        run: null,
        lastFailure: value.reason ? { operation: value.phase, runId: '', reason: value.reason, recoverability: 'owner-action' } : null,
      },
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
  if (!env.PUBLISH_TOKEN && !(env.CODEX_DELIVERY_APP_ID && env.CODEX_DELIVERY_APP_PRIVATE_KEY)) throw new Error('Publication credential is missing. Configure the repository-scoped GitHub App credentials.');
  const event = JSON.parse(await readFile(env.GITHUB_EVENT_PATH, 'utf8'));
  const context = intakeEvent(event, env);
  let { issue, repository, actor, comment } = context;
  const endpoint = `https://api.github.com/repos/${repository}`;
  const api = async (route, method = 'GET', body, token = env.GH_TOKEN) => {
    const response = await fetchApi(`${endpoint}${route}`, {
      method, headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2026-03-10', 'Content-Type': 'application/json' },
      ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) throw new Error(`GitHub ${method} ${route} failed (${response.status}).`);
    return response.status === 204 ? null : response.json();
  };
  const appProvider = env.CODEX_DELIVERY_APP_ID && env.CODEX_DELIVERY_APP_PRIVATE_KEY
    ? new GithubAppTokenProvider({ repository, ...appConfiguration(env), permissions: { contents: 'write', issues: 'write', pull_requests: 'write', workflows: 'write' } })
    : null;
  const publicationToken = async () => appProvider ? appProvider.token() : env.PUBLISH_TOKEN;
  const publishApi = async (route, method = 'GET', body) => api(route, method, body, await publicationToken());
  if (env.INVOCATION_EVENT === 'true') {
    const sourceKind = String(env.INVOCATION_SOURCE_KIND ?? '');
    const sourceId = commentId(env.INVOCATION_COMMENT_ID || env.INVOCATION_REVIEW_ID);
    const route = sourceKind === 'issue_comment' || sourceKind === 'pull_request_comment'
      ? `/issues/${sourceKind === 'pull_request_comment' ? commentId(env.INVOCATION_PULL_REQUEST_NUMBER) : issue}/comments/${sourceId}`
      : sourceKind === 'pull_request_review'
        ? `/pulls/${commentId(env.INVOCATION_PULL_REQUEST_NUMBER)}/reviews/${sourceId}`
        : `/pulls/comments/${sourceId}`;
    const current = await api(route);
    const body = String(current?.body ?? '');
    if (env.INVOCATION_BODY_DIGEST && bodyDigest(body) !== env.INVOCATION_BODY_DIGEST) throw new Error('The invocation comment changed after preflight; start a new tagged invocation.');
    const currentActor = String(current?.user?.login ?? '');
    if (!currentActor || currentActor !== env.INVOCATION_ACTOR) throw new Error('The invocation actor no longer matches the source comment.');
    comment = { id: sourceId, body };
    actor = currentActor;
  }
  const deliveryRoute = env.INTAKE_ROUTE
    || (comment || env.GITHUB_EVENT_NAME === 'workflow_dispatch' ? 'resume' : 'manual');
  if (!['refine', 'research', 'requirements', 'architecture', 'plan', 'implement', 'resume', 'validate', 'manual', 'coordinate'].includes(deliveryRoute)) throw new Error('Invalid intake route.');
  const internalCoordination = deliveryRoute === 'coordinate' && actor === 'github-actions[bot]';
  const allowlistedBotInvocation = env.INVOCATION_EVENT === 'true'
    && env.INVOCATION_ACTOR_KIND === 'external-bot'
    && env.INVOCATION_AUTHORIZED === 'true';
  const permission = internalCoordination || allowlistedBotInvocation
    ? { permission: 'write' }
    : await api(`/collaborators/${encodeURIComponent(actor)}/permission`);
  if (!['admin', 'maintain', 'write'].includes(permission.permission)) {
    throw new Error('Source issue execution requires repository write permission.');
  }
  const lifecycleConfig = bindIssueMetadataConfig(await loadLifecycleConfig(controllerRoot), env.ISSUE_FIELD_BINDINGS_JSON || {});
  const orchestrationAvailability = {
    capabilities: ['repository-read', 'repository-write', 'deterministic-validation'],
    mcp: String(env.CODEX_MCP_SERVERS ?? '').split(',').map((name) => name.trim()).filter(Boolean)
      .map((name) => ({ name, available: true })),
    skills: Object.keys(lifecycleConfig.orchestration.skills ?? {}),
  };
  const sourceRest = await api(`/issues/${issue}`);
  let graphql = dependencies.graphql;
  const useGraphql = Boolean(graphql || env.GITHUB_GRAPHQL === 'true' || env.GITHUB_ACTIONS === 'true');
  if (useGraphql && !graphql) graphql = githubGraphqlApi({ token: env.GH_TOKEN, fetchImpl: fetchApi });
  const readControlPlane = dependencies.readControlPlane ?? readIssueControlPlane;
  const readTrustedControlPlane = async ({ issueNumber = issue } = {}) => {
    const value = await readControlPlane({ graphql, repository, issueNumber, organization: repository.split('/')[0] });
    const fieldContract = validateOrganizationIssueFields({ config: lifecycleConfig, organizationIssueFields: value.organizationIssueFields });
    if (!fieldContract.valid) throw new Error(`Required organization issue fields are not ready: ${fieldContract.errors.join(' ')}`);
    return value;
  };
  let source = sourceRest;
  if (graphql) {
    source = { ...sourceRest, ...(await readTrustedControlPlane()), labels: sourceRest.labels ?? [] };
  }
  if (source.pull_request) throw new Error('A pull request cannot be a source issue.');
  if (source.state !== 'open') {
    if (comment) return {status:'ignored', reason:'The source issue is inactive.'};
    throw new Error('The source issue must still be open.');
  }
  const deliveryMetadataSafe = (metadata) => {
    const blockedGovernance = metadata.workType === 'architecture' ? [] : metadata.governance
      .filter((label) => lifecycleConfig.readiness.blocking_governance.includes(label));
    return Boolean(metadata.workType)
      && metadata.workTypeSource === 'native'
      && metadata.fieldAuthority === 'organization-issue-field'
      && metadata.fieldPresence?.lifecycleStage === true
      && metadata.fieldPresence?.readiness === true
      && !(metadata.invalidFields?.length > 0)
      && !metadata.conflict?.length
      && !metadata.stateConflict
      && lifecycleConfig.readiness.delivery_types.includes(metadata.workType)
      && !(metadata.missingFields?.length > 0)
      && ['planning', 'execution', 'validation'].includes(metadata.lifecycleStage)
      && ['ready', 'working', 'awaiting-human'].includes(metadata.readiness)
      && blockedGovernance.length === 0;
  };
  const stateRoot = path.resolve(env.CODEX_DELIVERY_STATE_DIR || path.join(env.RUNNER_WORKSPACE, '..', '.codex-delivery'));
  const repositoryKey = event.repository?.id !== undefined && /^\d+$/.test(String(event.repository.id))
    ? String(event.repository.id)
    : repository.replace('/', '_');
  const issueRoot = path.join(stateRoot, repositoryKey, issue);
  const stateFile = path.join(issueRoot, 'state.json');
  const stateWasSaved = await exists(stateFile);
  if (comment && !stateWasSaved) {
    return {status:'ignored', reason:'No saved continuation state exists for this issue.'};
  }
  await mkdir(issueRoot, { recursive: true, mode: 0o700 });
  const workspace = path.join(issueRoot, 'workspace');
  const codexHome = path.join(issueRoot, 'codex-home');
  const authBridge = path.join(codexHome, 'auth.json');
  const serviceAuth = path.join(env.CODEX_AUTH_HOME || '/var/lib/github-runner/.codex', 'auth.json');
  let runTools;
  const runHome = path.join(issueRoot, 'run-home');
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
    await appendFile(path.join(issueRoot, 'audit.jsonl'), `${JSON.stringify({
      schemaVersion: 1,
      type: 'delivery-audit',
      at: new Date().toISOString(),
      sourceIssue: Number(issue),
      repository,
      phase: state.phase,
      status: state.status,
      body,
    })}\n`, { mode: 0o600 });
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
        return !ownComments.has(String(item.id)) && String(item.id) !== String(excludedCommentId ?? '') && !bot;
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
  let transitionState;
  const requireCurrentBrief = async (brief) => {
    if (state.sourceDigest !== digest(brief)) {
      state.phase = 'plan';
      state.planDigest = null;
      state.planInvalidatedReason = 'The source issue or conversation changed.';
      state.tasks = ['Review the changed source issue and discussion, then update the saved plan.', ...(state.tasks ?? [])];
      await save();
      await transitionState('ready-for-plan');
      throw new Error('Source issue requirements or discussion changed, or the saved snapshot is missing. Resume planning before continuing; existing files are preserved.');
    }
  };
  const lockFile = path.join(stateRoot, 'account.lock');
  let lock;
  try { lock = await import('node:fs/promises').then(({ open }) => open(lockFile, 'wx', 0o600)); }
  catch (error) {
    if (error.code !== 'EEXIST') throw error;
    await api(`/issues/${issue}/comments`, 'POST', { body: 'Delivery is already running. No action is needed. If the linked run is no longer active, an operator must clear the stale runner lock and rerun the workflow. Do not change lifecycle fields or post another continuation comment.' });
    return;
  }
  runTools = await mkdtemp(path.join(issueRoot, 'run-tools-'));
  for (const entry of await readdir(issueRoot, { withFileTypes: true })) {
    if (entry.name.startsWith('run-tools-') && path.join(issueRoot, entry.name) !== runTools) {
      await rm(path.join(issueRoot, entry.name), { recursive: true, force: true });
    }
  }
  await rm(runHome, { recursive: true, force: true }).catch(() => {});
  await unlink(authBridge).catch(() => {});
  let client;
  const abort = new AbortController();
  const cancel = () => { abort.abort(); client?.close().catch(() => {}); };
  process.once('SIGTERM', cancel);
  process.once('SIGINT', cancel);
  const overall = setTimeout(cancel, OVERALL_TIMEOUT_MS);
  const gitEnv = (token) => {
    const { GH_TOKEN: _ghToken, GITHUB_TOKEN: _githubToken, PUBLISH_TOKEN: _publishToken,
      OPENAI_API_KEY: _openAiKey, CODEX_DELIVERY_APP_PRIVATE_KEY: _privateKey, ...safeEnv } = env;
    return {
      ...safeEnv,
      GIT_TERMINAL_PROMPT: '0', GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null',
      GIT_CONFIG_COUNT: '2', GIT_CONFIG_KEY_0: 'http.https://github.com/.extraheader',
      GIT_CONFIG_VALUE_0: `AUTHORIZATION: basic ${Buffer.from(`x-access-token:${token}`).toString('base64')}`,
      GIT_CONFIG_KEY_1: 'core.hooksPath', GIT_CONFIG_VALUE_1: '/dev/null',
    };
  };
  const git = async (args, options = {}) => {
    const token = options.publish ? await publicationToken() : env.GH_TOKEN;
    return (await execute('git', ['-C', workspace, ...args], { env: gitEnv(token), timeout: 120_000, maxBuffer: 8_000_000 })).stdout.trim();
  };
  try {
    await lock.writeFile(JSON.stringify({ runUrl, issue, pid: process.pid }));
    const initialPhase = {
      refine: 'refine', research: 'research', requirements: 'requirements', architecture: 'architecture',
      plan: 'plan', implement: 'implement', validate: 'validate', coordinate: 'coordinate',
    }[deliveryRoute] ?? 'plan';
    state = stateWasSaved ? await readSavedState(stateFile, issue, repository) : {
      version: STATE_VERSION, issue, repository, phase: initialPhase, status: 'new', execution: { status: 'idle', operation: null, run: null, lastFailure: null }, tasks: [], events: [], consumedCommentIds: [], sessionStarted: false, planDigest: null,
    };
    const priorStatus = state.status;
    const canStartInitialSession = !stateWasSaved
      || (priorStatus === 'paused' && state.phase === 'plan' && !state.plan && state.sessionStarted === false && !state.sessionId);
    await flush();
    if (stateWasSaved && state.legacySessionReconstruction && state.sessionId === undefined) await save();
    const eventKey = comment
      ? `comment:${comment.id}`
      : event.issue && event.action
        ? `${event.action}:${issue}`
        : `dispatch:${env.GITHUB_RUN_ID}`;
    const coordinateRetry = state.phase === 'coordinate' && state.status === 'ready'
      && (deliveryRoute === 'resume' || deliveryRoute === 'manual' || deliveryRoute === 'coordinate');
    const refinementWave = state.phase === 'coordinate' && state.status === 'ready' && deliveryRoute === 'refine';
    const coordinationContinuation = coordinateRetry || refinementWave;
    if ((state.status === 'ready' && !coordinationContinuation) || state.status === 'running' || state.events.includes(eventKey)
      || (comment && state.consumedCommentIds.includes(comment.id))) return {status:'ignored', reason:'This delivery event is already complete or in progress.'};
    if (comment && !coordinationContinuation) {
      if (state.status === 'new') return {status:'ignored', reason:'An issue comment cannot start a new delivery task.'};
      if (state.status === 'awaiting-human') {
        if (!comment.body.trim()) return {status:'ignored', reason:'A waiting state requires an answer.'};
        if (compareCommentIds(comment.id, state.waitingCommentId ?? '0') <= 0) return {status:'ignored', reason:'The comment is at or before the waiting boundary.'};
      }
      if (!['paused','awaiting-human'].includes(state.status)) return {status:'ignored', reason:'The saved state is not eligible for issue-comment continuation.'};
    }
    transitionState = async (target, allowedCurrentStates, childDependencies = []) => {
      let current = await api(`/issues/${issue}`);
      if (graphql) {
        current = { ...current, ...(await readTrustedControlPlane()), labels: current.labels ?? [] };
      }
      if (current.state !== 'open' || current.pull_request) throw new Error('The source issue must still be open.');
      const currentMetadata = classifyIssue({ issue: current, config: lifecycleConfig, available: orchestrationAvailability });
      const targetValue = stageTarget(target);
      const targetStage = targetValue.stage ?? currentMetadata.lifecycleStage;
      const allowedStages = allowedCurrentStates?.map((value) => stageTarget(value).stage);
      if (allowedStages && !allowedStages.includes(currentMetadata.lifecycleStage)) {
        throw new Error(`The source issue is at lifecycle stage ${currentMetadata.lifecycleStage ?? 'unknown'}; it cannot transition to ${target}.`);
      }
      const transition = validateTransition({
        config: lifecycleConfig,
        from: currentMetadata.lifecycleStage,
        to: targetStage,
        workType: currentMetadata.workType,
        governance: currentMetadata.governance,
        issueState: current.state,
        dependencies: childDependencies,
      });
      if (!transition.allowed) throw new Error(`Lifecycle transition rejected: ${transition.reasons.join(' ')}`);
      const targetMetadata = classifyIssue({ issue: current, config: lifecycleConfig, requestedStage: targetStage, requestedReadiness: targetValue.readiness, available: orchestrationAvailability });
      if (target === 'ready-for-plan' && (!targetMetadata.readinessGate.ok || targetMetadata.lifecycleStage !== targetStage)) {
        throw new Error(`Lifecycle transition rejected: ${targetMetadata.readinessGate.reasons.join(' ')}`);
      }
      if (['ready-for-agent', 'in-progress', 'review'].includes(target) && !deliveryMetadataSafe({ ...currentMetadata, readiness: targetValue.readiness })) {
        throw new Error('The source issue no longer satisfies the implementation readiness contract.');
      }
      const values = {};
      if (targetValue.stage && currentMetadata.lifecycleStage !== targetValue.stage) values.lifecycle_stage = targetValue.stage;
      if (targetValue.readiness && currentMetadata.readiness !== targetValue.readiness) values.readiness = targetValue.readiness;
      for (const [field, value] of Object.entries(values)) {
        const mutation = validateFieldMutation({ config: lifecycleConfig, issueState: current.state, field, from: field === 'lifecycle_stage' ? currentMetadata.lifecycleStage : currentMetadata.readiness, to: value, workType: currentMetadata.workType, governance: currentMetadata.governance, actor: 'controller', dependencies: childDependencies });
        if (!mutation.allowed) throw new Error(`Issue field transition rejected: ${mutation.reasons.join(' ')}`);
      }
      if (graphql && current.id && Object.keys(values).length) {
        await setIssueFields({ graphql, issueId: current.id, config: lifecycleConfig, values, actor: 'controller' });
      }
      if (graphql) {
        const observed = { ...await api(`/issues/${issue}`), ...(await readTrustedControlPlane()) };
        const observedMetadata = classifyIssue({ issue: observed, config: lifecycleConfig, available: orchestrationAvailability });
        if (observedMetadata.lifecycleStage !== targetStage || (targetValue.readiness && observedMetadata.readiness !== targetValue.readiness)) {
          throw new Error(`Lifecycle field transition to ${target} was not observed after the GitHub field update.`);
        }
      }
      state.workState = { lifecycleStage: targetStage, readiness: targetValue.readiness ?? currentMetadata.readiness, observedAt: new Date().toISOString(), source: graphql ? 'github-issue-field' : 'runner-observation' };
      await save();
    };
    const requireDeliveryMetadata = async (allowedStates) => {
      let current = await api(`/issues/${issue}`);
      if (graphql) {
        current = { ...current, ...(await readTrustedControlPlane()) };
      }
      if (current.state !== 'open' || current.pull_request) throw new Error('The source issue must still be open.');
      const currentMetadata = classifyIssue({ issue: current, config: lifecycleConfig, available: orchestrationAvailability });
      const allowedStages = allowedStates?.map((value) => stageTarget(value).stage);
      if (allowedStages && !allowedStages.includes(currentMetadata.lifecycleStage)) {
        throw new Error(`The source issue is at lifecycle stage ${currentMetadata.lifecycleStage ?? 'unknown'}; it cannot continue ${state.phase}.`);
      }
      if (!deliveryMetadataSafe(currentMetadata)) {
        throw new Error('The source issue no longer satisfies the delivery readiness contract.');
      }
      return currentMetadata;
    };
    let metadataSource = await api(`/issues/${issue}`);
    if (graphql) {
      metadataSource = { ...metadataSource, ...(await readTrustedControlPlane()) };
    }
    if (metadataSource.state !== 'open' || metadataSource.pull_request) throw new Error('The source issue must still be open.');
    let metadata = classifyIssue({ issue: metadataSource, config: lifecycleConfig, mode: deliveryRoute === 'resume' ? 'resume' : 'event', available: orchestrationAvailability });
    const policyContext = {
      issueType: metadata.workType,
      lifecycleStage: metadata.lifecycleStage,
      readiness: metadata.readiness,
      governance: metadata.governance,
      trigger: env.INVOCATION_EVENT === 'true'
        ? 'agent-invocation'
        : comment ? 'comment' : deliveryRoute === 'manual' || env.GITHUB_EVENT_NAME === 'workflow_dispatch' ? 'manual' : 'issue',
      lineage: { isRoot: !metadataSource.parent, parent: metadataSource.parent ?? null, children: state.childIssues ?? metadataSource.subIssues ?? [] },
      plan: { exists: state.plan?.status === 'ready', valid: state.plan?.status === 'ready' && Boolean(state.planDigest ?? state.sourceDigest), digest: state.planDigest ?? state.sourceDigest ?? null, scopeChanged: state.planInvalidatedReason != null },
      session: { exists: Boolean(state.sessionId), resumable: Boolean(state.sessionId) && state.status !== 'new', id: state.sessionId ?? null },
      execution: state.execution ?? { status: 'idle', operation: state.phase },
      capabilities: ['repository-read', 'repository-write', 'deterministic-validation'],
      mcp: env.CODEX_MCP_SERVERS ? String(env.CODEX_MCP_SERVERS).split(',').filter(Boolean).map((name) => ({ name, available: true })) : [],
    };
    const orchestration = selectOrchestration({ policy: lifecycleConfig.orchestration, context: policyContext });
    const approvedMcpServers = [...new Set((orchestration.profiles ?? []).flatMap((profile) => profile.mcp ?? []))];
    state.orchestration = {
      policyVersion: lifecycleConfig.orchestration.version,
      pattern: orchestration.pattern,
      status: orchestration.status,
      profiles: orchestration.steps,
      requiredCapabilities: orchestration.requiredCapabilities,
      approvedMcpServers,
      availableMcpServers: orchestration.availableMcp ?? [],
    };
    if (deliveryRoute === 'implement' && (orchestration.status !== 'authorized' || orchestration.pattern !== 'implementation-existing-plan')) {
      throw new Error(`Implementation requires a valid unchanged plan; ${orchestration.reason}`);
    }
    if (deliveryRoute === 'resume' && state.phase === 'implement' && (orchestration.status !== 'authorized' || orchestration.pattern !== 'implementation-continuation')) {
      throw new Error(`Exact implementation continuation is not authorized; ${orchestration.reason}`);
    }
    if (refinementWave) {
      await transitionState('requirements', ['coordinating']);
      state.phase = 'refine';
      await save();
    }
    const savedRecovery = state.status !== 'new' || state.phase !== 'plan' || state.events.length > 0;
    if (state.phase === 'plan') {
      let planningIssue = await api(`/issues/${issue}`);
      if (graphql) {
        planningIssue = { ...planningIssue, ...(await readTrustedControlPlane()) };
      }
      if (planningIssue.state !== 'open' || planningIssue.pull_request) throw new Error('The source issue must still be open.');
      metadata = classifyIssue({ issue: planningIssue, config: lifecycleConfig, mode: deliveryRoute === 'resume' ? 'resume' : 'event', available: orchestrationAvailability });
      if (metadata.workTypeSource !== 'native') {
        throw new Error('The source issue is not ready for planning: a supported native organization issue type must be assigned before a new Plan run.');
      }
      if (!['planning', 'intake'].includes(metadata.lifecycleStage) || (metadata.lifecycleStage === 'intake' && metadata.readiness !== 'needs-info')) {
        throw new Error(`The source issue is not ready for planning: it is at lifecycle stage ${metadata.lifecycleStage ?? 'unknown'}; planning requires Planning or an explicit Needs information recovery.`);
      }
      const planningClarificationRecovery = savedRecovery
        && deliveryRoute === 'resume'
        && state.status === 'awaiting-human'
        && metadata.readiness === 'needs-info';
      const readinessBlockers = metadata.readinessGate.reasons.filter((reason) => !reason.startsWith('The issue is at lifecycle stage ')
        && !(planningClarificationRecovery && reason.startsWith('Delivery readiness is ')));
      if (readinessBlockers.length > 0) {
        throw new Error(`The source issue is not ready for planning: ${readinessBlockers.join(' ')}`);
      }
      if (!savedRecovery && !metadata.readinessGate.ok) {
        throw new Error('The source issue is not ready for planning; the Lifecycle Stage and Delivery Readiness fields must authorize planning after intake gates are cleared.');
      }
      if (savedRecovery && deliveryRoute !== 'resume' && metadata.route !== 'plan') {
        throw new Error('A saved planning run requires the explicit recovery route.');
      }
    }
    if (state.phase === 'implement') {
      const clarificationRecovery = savedRecovery && deliveryRoute === 'resume' && metadata.readiness === 'needs-info';
      const clarificationSafe = clarificationRecovery
        && Boolean(metadata.workType)
        && lifecycleConfig.readiness.delivery_types.includes(metadata.workType)
        && !metadata.conflict?.length
        && !metadata.stateConflict
        && !(metadata.missingFields?.length > 0)
        && !metadata.governance.some((label) => lifecycleConfig.readiness.blocking_governance.includes(label));
      if ((!['execution'].includes(metadata.lifecycleStage) && !clarificationRecovery)
        || (!deliveryMetadataSafe(metadata) && !clarificationSafe)) {
        throw new Error('The source issue is not authorized for implementation.');
      }
    }
    if (state.phase === 'branch' && (metadata.lifecycleStage !== 'execution' || !deliveryMetadataSafe(metadata))) {
      throw new Error('The source issue is not authorized to create the implementation branch.');
    }
    if (state.phase === 'verify' && (metadata.lifecycleStage !== 'execution' || !deliveryMetadataSafe(metadata))) {
      throw new Error('The source issue is not authorized for verification.');
    }
    if (state.phase === 'commit' && (metadata.lifecycleStage !== 'execution' || !deliveryMetadataSafe(metadata))) {
      throw new Error('The source issue is not authorized for commit.');
    }
    if (state.phase === 'publish' && (!['execution', 'validation'].includes(metadata.lifecycleStage) || !deliveryMetadataSafe(metadata))) {
      throw new Error('The source issue is not authorized for publication.');
    }
    const expectedPattern = orchestrationPatternForRoute(deliveryRoute, state.phase, metadata.workType);
    if (expectedPattern && (orchestration.status !== 'authorized' || orchestration.pattern !== expectedPattern)) {
      throw new Error(`The requested delivery route is not authorized by the orchestration policy; ${orchestration.reason}`);
    }
    if (state.phase === 'coordinate') {
      if (metadata.lifecycleStage === 'acceptance') {
        state.execution = { ...(state.execution ?? {}), status: 'completed', operation: 'coordinate', run: { id: String(env.GITHUB_RUN_ID ?? ''), attempt: String(env.GITHUB_RUN_ATTEMPT ?? '1'), url: runUrl }, lastFailure: null };
        state.status = 'ready';
        state.tasks = [];
        await save();
        return { status: 'ready' };
      }
      const children = await Promise.all((state.childIssues ?? []).map(async (child) => {
        let issueValue = await api(`/issues/${child.number}`);
        if (graphql) issueValue = { ...issueValue, ...(await readTrustedControlPlane({ issueNumber: child.number })), labels: issueValue.labels ?? [] };
        return { ...child, state: classifyIssue({ issue: issueValue, config: lifecycleConfig, available: orchestrationAvailability }).state };
      }));
      const incomplete = children.filter((child) => child.state !== 'done');
      if (!incomplete.length && children.length) {
        await transitionState('acceptance', ['coordinating'], children);
        state.execution = { ...(state.execution ?? {}), status: 'completed', operation: 'coordinate', run: { id: String(env.GITHUB_RUN_ID ?? ''), attempt: String(env.GITHUB_RUN_ATTEMPT ?? '1'), url: runUrl }, lastFailure: null };
        state.status = 'ready';
        state.tasks = [];
        await save();
        await audit('## Child work complete\n\nAll required child issues are complete. The lineage root is now awaiting human acceptance; Codex will not close it.');
        return { status: 'ready' };
      }
      state.execution = { ...(state.execution ?? {}), status: 'completed', operation: 'coordinate', run: { id: String(env.GITHUB_RUN_ID ?? ''), attempt: String(env.GITHUB_RUN_ATTEMPT ?? '1'), url: runUrl }, lastFailure: null };
      state.status = 'ready';
      state.tasks = incomplete.map((child) => `${child.key}: waiting for child issue #${child.number} (${child.state})`);
      await save();
      return { status: 'ready' };
    }
    state.events.push(eventKey);
    if (comment) state.consumedCommentIds.push(comment.id);
    state.status = 'running';
    state.execution = {
      ...(state.execution ?? {}),
      status: 'running',
      operation: state.phase,
      run: { id: String(env.GITHUB_RUN_ID ?? ''), attempt: String(env.GITHUB_RUN_ATTEMPT ?? '1'), url: runUrl },
      lastFailure: null,
    };
    await save();
    await audit(`Starting ${state.phase} for source issue #${issue}, requested by ${actor}. Ideas, requirements, and decisions enter the same intake. Questions must be answered before dependent work proceeds.`);
    const needsModel = !['publish', 'commit', 'coordinate'].includes(state.phase) || refinementWave;
    if (needsModel) {
      if (stateWasSaved && !state.sessionId && !state.legacySessionReconstruction && !canStartInitialSession
        && ['plan','branch','implement'].includes(state.phase)) {
        throw new Error('Saved Codex session ID is missing; refusing to start an unrelated replacement thread.');
      }
      await mkdir(codexHome, { recursive: true, mode: 0o700 });
      await mkdir(runHome, { recursive: true, mode: 0o700 });
      if (!(await exists(authBridge)) && await exists(serviceAuth)) await symlink(serviceAuth, authBridge);
      const codexEnvironment = { ...env, HOME: runHome, CODEX_HOME: codexHome, CODEX_AUTH_HOME: undefined };
      client = createClient({ cwd: controllerRoot, env: codexEnvironment, readableFiles:[controllerRoot], runtime:runTools, approvedMcpServers });
      await client.initialize();
      state.budget = await client.capabilities();
      if (state.budget.stop && state.phase !== 'verify') throw new Error(state.budget.reason);
      if (!(await exists(workspace))) {
        await execute('git', ['clone', '--branch', 'main', `https://github.com/${repository}.git`, workspace], { env: gitEnv(env.GH_TOKEN), timeout: 120_000 });
        state.base = await git(['rev-parse', 'HEAD']);
        await save();
      }
      if (!state.base) {
        if (await git(['branch', '--show-current']) !== 'main') throw new Error('Incomplete clone checkpoint requires operator inspection.');
        state.base = await git(['rev-parse', 'HEAD']);
        await save();
      }
      const brief = await readBrief(comment?.id);
      if (['refine', 'plan'].includes(state.phase)) { state.sourceDigest = digest(brief); await save(); }
      else await requireCurrentBrief(brief);
      if (comment) {
        state.sourceDigest = digest(await readBrief());
        await save();
      }
      const instructions = `${await readFile(path.join(controllerRoot, '.agents', 'codex-delivery.md'), 'utf8')}

Controller lifecycle extension: a non-bot repository writer whose GitHub permission is
admin, maintain, or write may answer an awaiting-human refinement or implementation
question. Continue the exact saved session and issue conversation; do not require the
legacy owner-only rule in the base instruction file.`;
      let thread;
      const ensureThread = async () => {
        if (thread) return thread;
        let response;
        if (state.sessionId) {
          response = await client.resumeThread(workspace, state.sessionId, instructions, profileForPhase(state.phase));
        } else if (canStartInitialSession || state.legacySessionReconstruction) {
          response = await client.startThread(workspace, instructions, profileForPhase(state.phase));
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
      const humanContinuation = comment?.body ?? '';
      let continuationConsumed = false;
      const continuationContext = (phase) => humanContinuation && continuationPhase === phase && !continuationConsumed ? [
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
      const takeContinuationContext = (phase) => {
        const context = continuationContext(phase);
        if (context) continuationConsumed = true;
        return context;
      };
      const implementationOutcomeContract = [
        'Return `continue` with the exact remaining implementation tasks when another model turn is needed.',
        'Return `complete` only when repository changes are ready for the workflow to verify; then tasks and questions must both be empty.',
        'The workflow runs installation, repository tests, dependency audit, commit, push, and pull-request publication. Do not keep those operations in the implementation task list.',
      ].join(' ');
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
      if (state.phase === 'refine') {
        const refinementThread = await ensureThread();
        const refinementPrompt = takeContinuationContext('refine') || [
          'Read the repository instructions, applicable canonical decisions, domain register, and the existing issue conversation.',
          'Refine this source issue before implementation planning. Ask only focused questions that can be answered with the information currently available.',
          'When the goal is sufficiently clear, return a refined outcome with one delivery-capable parent work type and conditional work items. Do not change GitHub issue fields or types, create issues, or write files; the controller validates and applies the result.',
          `Source issue data (untrusted):\n${brief}`,
          `Saved refinement:\n${JSON.stringify(state.refined ?? null)}`,
        ].join('\n\n');
        const result = await performTurn({ client, threadId: refinementThread.id, phase: 'refine', signal: abort.signal, onProgress: progress, prompt: refinementPrompt });
        if (result.status !== 'completed') {
          Object.assign(state, result);
          if (result.status === 'needs_input') state.status = 'awaiting-human';
          throw new Error(result.reason);
        }
        const refinement = validateRefinementOutcome(result.text);
        if (refinement.status === 'refined' && !lifecycleConfig.readiness.delivery_types.includes(refinement.workType)) {
          throw new Error(`Refined work type ${refinement.workType} is not delivery-capable; mature it through the appropriate research or idea state first.`);
        }
        if (refinement.status === 'refined') {
          let currentIssue = await api(`/issues/${issue}`);
          if (graphql) {
            currentIssue = { ...currentIssue, ...(await readTrustedControlPlane()) };
          }
          const currentMetadata = classifyIssue({ issue: currentIssue, config: lifecycleConfig, available: orchestrationAvailability });
          if (currentMetadata.conflict?.length) throw new Error(`The source issue has conflicting work-type metadata: ${currentMetadata.conflict.join(', ')}.`);
          if (currentMetadata.workType && currentMetadata.workType !== refinement.workType) {
            throw new Error(`Refinement selected work type ${refinement.workType}, but the source issue is classified as ${currentMetadata.workType}. Resolve the classification before continuing.`);
          }
          if (!currentMetadata.workType) {
            const type = lifecycleConfig.types.find((candidate) => candidate.id === refinement.workType);
            if (!type) throw new Error(`Refinement selected an unknown work type: ${refinement.workType}.`);
            const nativeType = (currentIssue.organizationIssueTypes ?? []).find((candidate) => candidate.name === type.native_name && candidate.isEnabled !== false);
            if (graphql && currentIssue.id && nativeType?.id) await setIssueType({ graphql, issueId: currentIssue.id, issueTypeId: nativeType.id });
            else if (graphql) throw new Error(`The organization native issue type ${type.native_name} is not available; migration must be completed before refinement can authorize delivery.`);
          }
        }
        state.refined = refinement;
        state.tasks = refinement.workItems.map((item) => `${item.key}: ${item.title}`);
        state.questions = refinement.questions;
        await save();
        if (refinement.status === 'needs_input') {
          await transitionState('needs-info');
          state.status = 'awaiting-human';
          throw new Error(refinement.questions.join('\n'));
        }
        await audit(formatRefinementComment(refinement));
        if (refinement.workItems.length > 1) {
          await transitionState('decomposing');
          const typeForKind = new Map([
            ['research', 'research'], ['specification', 'requirements'], ['requirements', 'requirements'], ['architecture', 'architecture'],
            ['task', 'task'], ['bug', 'bug'], ['implementation', 'implementation'], ['validation', 'validation'],
          ]);
          const childPlans = refinement.workItems.map((item) => {
            const childType = lifecycleConfig.types.find((candidate) => candidate.id === typeForKind.get(item.kind)) ?? lifecycleConfig.types.find((candidate) => candidate.id === 'task');
            const nativeType = graphql
              ? (metadataSource.organizationIssueTypes ?? []).find((candidate) => candidate.name === childType.native_name && candidate.isEnabled !== false)
              : null;
            if (graphql && !nativeType?.id) throw new Error(`The organization native issue type ${childType.native_name} is not available; provision it before decomposing the source issue.`);
            return { item, childType, nativeType };
          });
          const childIssues = [];
          for (const { item, childType, nativeType } of childPlans) {
            const marker = `<!-- codex-lineage:v1 parent=${issue} key=${item.key} -->`;
            const body = [marker, '', `Parent issue: #${issue}`, `Work item: ${item.key}`, `Kind: ${item.kind}`, '', `## Goal\n\n${item.goal}`, '', '## Acceptance criteria', ...item.acceptanceCriteria.map((criterion) => `- ${criterion}`), ...(item.dependencies.length ? ['', '## Dependencies', ...item.dependencies.map((dependency) => `- ${dependency}`)] : [])].join('\n');
            const existing = [];
            for (let page = 1; page <= 10; page += 1) {
              const batch = await publishApi(page === 1 ? '/issues?state=all&per_page=100' : `/issues?state=all&per_page=100&page=${page}`);
              if (!Array.isArray(batch)) break;
              existing.push(...batch);
              if (batch.length < 100) break;
            }
            const match = existing.find((candidate) => typeof candidate.body === 'string' && candidate.body.includes(marker));
            const child = match ?? await publishApi('/issues', 'POST', {
              title: item.title,
              body,
              labels: [],
            });
            if (graphql && child.id) {
              const childControl = await readTrustedControlPlane({ issueNumber: child.number });
              if (childControl.issueType && childControl.issueType.name !== childType.native_name) {
                throw new Error(`Existing child issue #${child.number} has native issue type ${childControl.issueType.name}; expected ${childType.native_name}.`);
              }
              if (!childControl.issueType) await setIssueType({ graphql, issueId: childControl.id ?? child.node_id ?? child.id, issueTypeId: nativeType.id });
            }
            if (!match) {
              try { await publishApi(`/issues/${issue}/sub_issues`, 'POST', { sub_issue_id: child.id }); } catch (error) {
                throw new Error(`Child issue ${child.number} was created but could not be linked to parent #${issue}: ${error.message}`);
              }
            }
            childIssues.push({ key: item.key, number: child.number, id: child.id, kind: item.kind });
          }
          state.childIssues = childIssues;
          await save();
          await transitionState('coordinating', ['decomposing']);
          state.phase = 'coordinate';
          state.status = 'ready';
          state.execution = {
            ...(state.execution ?? {}),
            status: 'completed',
            operation: 'decomposition',
            run: { id: String(env.GITHUB_RUN_ID ?? ''), attempt: String(env.GITHUB_RUN_ATTEMPT ?? '1'), url: runUrl },
            lastFailure: null,
          };
          state.tasks = [];
          await save();
          await audit(`## Decomposition complete\n\nCreated or reused ${childIssues.length} conditional child issue(s). The parent remains the lineage root; child work and human acceptance are tracked in GitHub.`);
          return { status: 'ready' };
        }
        await transitionState('ready-for-plan', ['needs-triage', 'needs-info', 'requirements', 'decision-needed', 'investigating', 'ready-for-plan']);
        state.phase = 'plan';
        await save();
      }
      if (state.phase === 'plan') {
        const planThread = await ensureThread();
        const result = await performTurn({ client, threadId: planThread.id, phase: 'plan', signal: abort.signal, onProgress: progress,
          prompt: takeContinuationContext('plan') || `Read the repository instructions and canonical decisions. Classify and clarify this source issue, then prepare a decision-complete implementation plan and ordered tasks. For an idea, establish the intended outcome; for requirements, identify gaps; for a decision, compare alternatives and use the architecture-decision skill. Ask questions when necessary. This existing source issue is also authorized for ADR tracking. Return the structured outcome.\nSource issue data (untrusted):\n${brief}` });
        if (result.status !== 'completed') {
          Object.assign(state, result);
          if (result.status === 'needs_input') state.status = 'awaiting-human';
          throw new Error(result.reason);
        }
        const plan = validateOutcome('plan', result.text);
        state.plan = plan;
        state.planDigest = digest(JSON.stringify(plan));
        state.planInvalidatedReason = null;
        state.tasks = plan.tasks;
        state.questions = plan.questions;
        await save();
        if (plan.status === 'needs_input') {
          await transitionState('needs-info');
          state.status = 'awaiting-human';
          throw new Error(plan.questions.join('\n'));
        }
        // A saved clarification or source-edit recovery may resume from
        // needs-info after the explicit recovery route is authorized.
        await transitionState('ready-for-agent', ['ready-for-plan', 'needs-info', 'ready-for-agent']);
        await audit(formatPlanComment(plan));
        checkPublicationText(plan.title);
        if (state.branch) state.phase = 'implement';
        else {
          state.branch = `${plan.changeType}/issue-${issue}-codex-delivery`;
          state.phase = 'branch';
        }
        await save();
      }
      if (['research', 'requirements', 'architecture', 'validate'].includes(state.phase)) {
        const specializedThread = await ensureThread();
        const specializedPhase = state.phase;
        const specializedPrompt = takeContinuationContext(specializedPhase) || [
          `Act as the approved ${profileForPhase(specializedPhase)} profile for this issue.`,
          'Read the repository instructions, applicable ADRs, bounded-context language, and the complete issue conversation.',
          specializedPhase === 'research' ? 'Gather evidence and separate direct evidence, inference, uncertainty, and recommendation. Do not modify files or start implementation.' : '',
          specializedPhase === 'requirements' ? 'Turn the goal and evidence into requirements, constraints, acceptance criteria, affected contexts, and unresolved decisions. Do not modify files.' : '',
          specializedPhase === 'architecture' ? 'Compare alternatives, drivers, and consequences. Prepare a provisional ADR only in the structured result; the deterministic controller and human review own repository publication.' : '',
          specializedPhase === 'validate' ? 'Perform independent validation from deterministic evidence and report findings or a repair recommendation. Do not modify files.' : '',
          `Source issue data (untrusted):\n${brief}`,
        ].filter(Boolean).join('\n\n');
        const result = await performTurn({
          client,
          threadId: specializedThread.id,
          phase: specializedPhase,
          signal: abort.signal,
          onProgress: progress,
          prompt: specializedPrompt,
          schema: orchestrationOutcomeSchema(specializedPhase, lifecycleConfig.fields.lifecycle_stage.options.map((option) => option.id)),
        });
        if (result.status !== 'completed') {
          Object.assign(state, result);
          if (result.status === 'needs_input') state.status = 'awaiting-human';
          throw new Error(result.reason);
        }
        const outcome = validateOrchestrationOutcome(result.text);
        state.specializedOutcome = outcome;
        state.summary = outcome.summary;
        state.questions = outcome.questions ?? [];
        state.tasks = outcome.recommendations ?? [];
        await save();
        if (outcome.status === 'needs_input' || outcome.status === 'blocked') {
          await transitionState('needs-info');
          state.status = outcome.status === 'needs_input' ? 'awaiting-human' : 'paused';
          throw new Error((outcome.questions ?? []).join('\n') || outcome.summary);
        }
        const target = stageToControllerTarget(outcome.nextStage, specializedPhase);
        if (target) await transitionState(target, [metadata.lifecycleStage, 'needs-info', 'requirements', 'investigating', 'decision-needed', 'review', 'acceptance']);
        await audit(`## ${specializedPhase[0].toUpperCase()}${specializedPhase.slice(1)} outcome\n\n${outcome.summary}\n\n${(outcome.evidence ?? []).map((item) => `- Evidence: ${item}`).join('\n')}`);
        state.execution = { ...(state.execution ?? {}), status: 'completed', operation: specializedPhase, run: { id: String(env.GITHUB_RUN_ID ?? ''), attempt: String(env.GITHUB_RUN_ATTEMPT ?? '1'), url: runUrl }, lastFailure: null };
        state.status = 'ready';
        await save();
        return { status: 'ready' };
      }
      if (state.phase === 'branch') {
        const currentBranch = await git(['branch', '--show-current']);
        if (currentBranch !== state.branch) {
          await startIssueBranch({branchType:state.plan.changeType, issueNumber:issue, summary:'codex-delivery', repositoryRoot:workspace,
            env, execFileImpl:(command, args, options) => execute(command, args, {...options, env:gitEnv(env.GH_TOKEN), timeout:60_000}),
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
      let validationAttempts = 0;
      while (['implement', 'verify'].includes(state.phase)) {
        while (state.phase === 'implement') {
          await transitionState('in-progress', ['ready-for-agent', 'in-progress', 'needs-info']);
          const implementThread = await ensureThread();
          const resumeContext = takeContinuationContext('implement');
          const result = await performTurn({ client, threadId: implementThread.id, phase: 'implement', signal: abort.signal, onProgress: progress,
            prompt: `${resumeContext || `Implement the saved plan. Preserve existing work and update the changelog, domain register, and ADR when needed. Do not commit, push, merge, or contact GitHub; the controller owns those operations. Run focused tests that help implementation. If blocked, ask questions.\nSource issue data (untrusted):\n${brief}\nSaved plan:\n${JSON.stringify(state.plan)}\nRemaining implementation tasks:\n${JSON.stringify(state.tasks)}\nLatest validation:\n${state.validation ?? 'No validation failure yet.'}`}\n\nImplementation outcome contract: ${implementationOutcomeContract}` });
          if (result.status !== 'completed') {
            Object.assign(state, result);
            if (result.status === 'needs_input') state.status = 'awaiting-human';
            throw new Error(result.reason);
          }
          let outcome;
          try { outcome = validateOutcome('implement', result.text); }
          catch (error) {
            if (error.outcome) {
              state.tasks = error.outcome.tasks;
              state.summary = error.outcome.summary;
              state.questions = error.outcome.questions;
              await save();
            }
            throw error;
          }
          state.tasks = outcome.tasks;
          state.summary = outcome.summary;
          state.questions = outcome.questions;
          await save();
          if (outcome.status === 'needs_input') {
            await transitionState('needs-info');
            state.status = 'awaiting-human';
            throw new Error(outcome.questions.join('\n'));
          }
          if (outcome.status === 'continue') continue;
          checkPublicationText(state.plan.title, state.summary);
          state.phase = 'verify';
          await save();
        }
        await requireDeliveryMetadata(['in-progress']);
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
          validationAttempts++;
          state.validation = redact(error.message, env).slice(-24_000);
          await audit(`### Validation attempt ${validationAttempts} failed\n\n${state.validation}`);
          if (validationAttempts === 3) {
            throw new Error('Repository validation failed three times. Fix the latest error shown below before resuming.');
          }
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
      await requireDeliveryMetadata(['in-progress']);
      await git(['diff', '--exit-code']);
      if (await git(['write-tree']) !== state.validatedTree || await git(['ls-files', '--others', '--exclude-standard'])) {
        throw new Error('The verified tree changed before commit; operator inspection is required.');
      }
      const changes = await git(['status', '--porcelain']);
      if (changes) {
        const { GH_TOKEN: _ghToken, GITHUB_TOKEN: _githubToken, PUBLISH_TOKEN: _publishToken,
          OPENAI_API_KEY: _openAiKey, CODEX_DELIVERY_APP_PRIVATE_KEY: _privateKey, ...safeControllerEnv } = env;
        await execute('node', [path.join(controllerRoot, 'scripts/validate-pull-request-title.mjs')], { cwd: controllerRoot, env: { ...safeControllerEnv, PR_TITLE: state.plan.title }, timeout: 30_000 });
        await git(['-c', 'user.name=github-actions[bot]', '-c', 'user.email=41898282+github-actions[bot]@users.noreply.github.com', '-c', 'commit.gpgsign=false', 'commit', '-m', state.plan.title]);
      }
      state.phase = 'publish';
      await save();
    }
    checkPublicationText(state.plan.title, state.summary);
    if (abort.signal.aborted) throw new Error('Cancelled before publication.');
    await requireDeliveryMetadata(['in-progress', 'review']);
    await requireCurrentBrief(await readBrief());
    if (await git(['branch', '--show-current']) !== state.branch || await git(['status', '--porcelain'])) throw new Error('The publish checkpoint was changed; operator inspection is required.');
    if (await git(['write-tree']) !== state.validatedTree) throw new Error('The publish checkpoint no longer matches the verified tree; operator inspection is required.');
    await validateCommits({base:state.base, head:'HEAD', repositoryRoot:workspace, toolingRoot:controllerRoot});
    if (!await git(['diff', '--name-only', `${state.base}...HEAD`])) throw new Error('No repository change is ready for a review pull request.');
    await git(['push', 'origin', `HEAD:refs/heads/${state.branch}`], { publish: true });
    const existing = await publishApi(`/pulls?state=open&head=${encodeURIComponent(`${repository.split('/')[0]}:${state.branch}`)}&base=main`);
    const revision = await git(['rev-parse', 'HEAD']);
    let architecture;
    if (await exists(path.join(workspace, 'docs/architecture/harness-review.yml'))) {
      architecture = await deterministicReview({
        repositoryRoot: workspace,
        base: state.base,
        head: revision,
        eventPath: undefined,
      });
    } else {
      // Legacy/minimal fixtures may not carry the review baseline. Preserve the
      // delivery evidence projection while recording that architecture mapping
      // was unavailable; the dedicated PR review fails closed when its baseline
      // is missing.
      architecture = {
        status: 'inconclusive',
        affectedAdrs: [],
        affectedContexts: [],
        checks: [{ id: 'architecture-baseline', status: 'not-applicable', message: 'No harness review map is present in this repository revision.', evidence: [] }],
      };
    }
    const officialAdrs = (await git(['ls-tree', '-r', '--name-only', state.base, '--', 'docs/decisions']))
      .split(/\r?\n/).filter((file) => /^docs\/decisions\/\d{4}-.*\.md$/.test(file)).map((file) => `ADR-${file.slice(15, 19)}`);
    const provisionalAdrs = (await git(['ls-files', 'docs/decisions']))
      .split(/\r?\n/).filter((file) => /^docs\/decisions\/\d{4}-.*\.md$/.test(file)).map((file) => `ADR-${file.slice(15, 19)}`);
    const evidence = {
      schemaVersion: 1,
      producer: 'codex-delivery',
      repository,
      sourceIssue: { number: Number(issue), url: `https://github.com/${repository}/issues/${issue}` },
      deliveryRun: { id: String(env.GITHUB_RUN_ID ?? '0'), attempt: String(env.GITHUB_RUN_ATTEMPT ?? '1'), url: runUrl },
      revision: { branch: state.branch, commit: revision, tree: state.validatedTree },
      codexSession: { id: state.sessionId },
      modelTurns: [
        ...(state.refined ? [{ phase: 'refine', model: 'gpt-5.6-sol', effort: 'high', mode: 'plan' }] : []),
        { phase: 'plan', model: 'gpt-5.6-sol', effort: 'high', mode: 'plan' },
        { phase: 'implement', model: 'gpt-5.6-luna', effort: 'max', mode: 'default' },
      ],
      architectureContext: {
        officialAdrs: [...new Set(officialAdrs)].sort(),
        provisionalAdrs: [...new Set(provisionalAdrs)].sort(),
        affectedAdrs: architecture.affectedAdrs,
        boundedContexts: architecture.affectedContexts,
      },
      validation: { status: 'passed', summary: state.validation },
      telemetry: {
        ...(Number.isFinite(state.budget?.usedPercent) ? { maxUsedPercent: state.budget.usedPercent } : {}),
        subscriptionOnly: state.budget?.stop === false,
        capturedAt: new Date().toISOString(),
      },
      auditCheckpoint: { stateVersion: STATE_VERSION, ...(await evidenceCheckpoint(path.join(issueRoot, 'audit.jsonl'))) },
    };
    const evidenceValidation = validateEvidenceRecord(evidence, {
      repository,
      issueNumber: Number(issue),
      head: revision,
    });
    if (!evidenceValidation.valid) {
      throw new Error(`Delivery evidence contract is invalid: ${evidenceValidation.errors.join('; ')}`);
    }
    state.evidence = evidence;
    await save();
    const body = formatPullRequestBody({
      issue,
      repository,
      plan: state.plan,
      summary: state.summary,
      validation: state.validation,
      runUrl,
      evidence,
    });
    const pr = existing[0] ? await publishApi(`/pulls/${existing[0].number}`, 'PATCH', { title: state.plan.title, body })
      : await publishApi('/pulls', 'POST', { title: state.plan.title, head: state.branch, base: 'main', body });
    await transitionState('review', ['in-progress', 'review']);
    state.pr = pr.html_url;
    state.status = 'ready';
    state.execution = {
      ...(state.execution ?? {}),
      status: 'completed',
      operation: 'publish',
      run: { id: String(env.GITHUB_RUN_ID ?? ''), attempt: String(env.GITHUB_RUN_ATTEMPT ?? '1'), url: runUrl },
      lastFailure: null,
    };
    state.tasks = [];
    await save();
    await audit(`## Review pull request ready\n\n${state.pr}\n\n${state.validation}\n\nRequired checks have been requested. Review and merge remain human actions.`);
  } catch (error) {
    if (!state) throw error;
    await client?.close().catch((failure) => { state.shutdownError = redact(failure.message, env); });
    const awaitingHuman = state.status === 'awaiting-human';
    const failedOperation = state.phase;
    state.status = awaitingHuman ? 'awaiting-human' : 'paused';
    state.reason = redact(error.message, env);
    state.execution = {
      ...(state.execution ?? {}),
      status: awaitingHuman ? 'awaiting-human' : 'paused',
      operation: failedOperation,
      run: { id: String(env.GITHUB_RUN_ID ?? ''), attempt: String(env.GITHUB_RUN_ATTEMPT ?? '1'), url: runUrl },
      lastFailure: awaitingHuman ? null : {
        operation: failedOperation,
        runId: String(env.GITHUB_RUN_ID ?? ''),
        reason: state.reason,
        recoverability: failureRecoverability(error, failedOperation),
        at: new Date().toISOString(),
      },
    };
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
    finally {
      await appProvider?.revoke();
      await unlink(authBridge).catch(() => {});
      if (runTools) await rm(runTools, { recursive: true, force: true }).catch(() => {});
      await rm(runHome, { recursive: true, force: true }).catch(() => {});
      if (state?.status === 'ready') {
        await rm(workspace, { recursive: true, force: true }).catch(() => {});
        await rm(codexHome, { recursive: true, force: true }).catch(() => {});
      }
      await lock.close();
    }
    await unlink(lockFile);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const result = await deliver();
    process.exitCode = deliveryExitCode(result?.status);
  } catch (error) { console.error(redact(error.message)); process.exitCode = 1; }
}
