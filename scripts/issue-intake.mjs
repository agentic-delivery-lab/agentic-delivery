import { access, appendFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseRepositoryYaml } from './lib/yaml.mjs';
import { appConfiguration, GithubAppTokenProvider } from './lib/github-app.mjs';
import { bindIssueMetadataConfig, githubGraphqlApi, readIssueControlPlane, setIssueFields, setIssueType, validateOrganizationIssueFields } from './lib/issue-field-api.mjs';
import {
  classifyIssue,
  validateRoutingProposal,
} from './lib/issue-routing.mjs';
import { reasonIssueRouting } from './lib/issue-routing-agent.mjs';
import { validateIssueMetadataConfig, issueMetadata, issueFieldMutation, validateFieldMutation } from './lib/issue-metadata.mjs';
import { validateOrchestrationPolicy } from './lib/orchestration-policy.mjs';

const repositoryRoot = path.resolve(import.meta.dirname, '..');

export async function loadLifecycleConfig(root = repositoryRoot) {
  const source = await readFile(path.join(root, 'config', 'issue-metadata.yml'), 'utf8');
  const config = parseRepositoryYaml(source, 'issue metadata configuration');
  const metadataValidation = validateIssueMetadataConfig(config);
  if (!metadataValidation.valid) throw new Error(`Issue metadata configuration is invalid: ${metadataValidation.errors.join('; ')}`);
  const policySource = await readFile(path.join(root, 'config', 'orchestration-policy.yml'), 'utf8');
  config.orchestration = parseRepositoryYaml(policySource, 'orchestration policy');
  const policy = validateOrchestrationPolicy(config.orchestration, {
    issueTypes: config.issue_types.map((type) => type.id),
    lifecycleStages: config.fields.lifecycle_stage.options.map((option) => option.id),
  });
  if (!policy.valid) throw new Error(`Orchestration policy is invalid: ${policy.errors.join('; ')}`);
  // Transitional read-only projections keep older integrations and persisted
  // delivery fixtures loadable while active mutation paths use fields. They
  // are never used as lifecycle authority.
  const legacyTypes = config.issue_types.map((type) => ({
    id: type.id,
    name: type.name,
    native_name: type.native_name,
    label: type.legacy_label,
    initial_state: type.initial_stage,
    initial_stage: type.initial_stage,
    initial_readiness: type.initial_readiness,
    delivery: type.delivery,
  }));
  const legacyStates = Object.entries(config.legacy?.state_labels ?? {}).map(([label, value]) => ({
    id: label.replace(/^state:/, ''),
    label,
    color: '6E7781',
    description: `Legacy migration alias for the ${value.stage} lifecycle stage.`,
  }));
  const stageForLegacyId = new Map(Object.entries(config.legacy?.state_labels ?? {}).map(([label, value]) => [label.replace(/^state:/, ''), value.stage]));
  const legacyTransitions = Object.fromEntries(legacyStates.map((from) => [from.id, legacyStates.filter((to) => {
    if (from.id === to.id) return false;
    const sourceStage = stageForLegacyId.get(from.id);
    const targetStage = stageForLegacyId.get(to.id);
    return sourceStage === targetStage || config.lifecycle.transitions[sourceStage]?.includes(targetStage);
  }).map((to) => to.id)]));
  config.types = legacyTypes;
  config.states = legacyStates;
  config.transitions = legacyTransitions;
  config.governance = config.governance.labels.map((item) => ({ ...item, label: item.label ?? item.name }));
  config.governance.labels = config.governance;
  config.readiness.delivery_types = config.readiness.planning_types;
  return config;
}

export const loadIssueMetadataConfig = loadLifecycleConfig;

function apiError(method, route, status) {
  const error = new Error(`GitHub ${method} ${route} failed (${status}).`);
  error.status = status;
  return error;
}

export function githubApi({ repository, token, fetchImpl = fetch }) {
  const endpoint = `https://api.github.com/repos/${repository}`;
  return async (route, method = 'GET', body) => {
    const response = await fetchImpl(`${endpoint}${route}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2026-03-10',
        'Content-Type': 'application/json',
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) throw apiError(method, route, response.status);
    return response.status === 204 ? null : response.json();
  };
}

function lineageParent(issue) {
  const match = /^<!--\s*codex-lineage:v1\s+parent=([1-9][0-9]*)\s+key=[a-z0-9]+(?:-[a-z0-9]+)*\s*-->/.exec(String(issue?.body ?? '').trim());
  return match ? match[1] : null;
}

async function issueConversation(api, issueNumber) {
  const comments = [];
  for (let page = 1; page <= 10; page += 1) {
    const batch = await api(`/issues/${issueNumber}/comments?per_page=100&page=${page}`);
    if (!Array.isArray(batch)) throw new Error('Issue conversation is unavailable.');
    comments.push(...batch.map((comment) => ({
      id: comment.id,
      author: comment.user?.login ?? null,
      authorType: comment.user?.type ?? null,
      body: comment.body ?? '',
      createdAt: comment.created_at ?? null,
      updatedAt: comment.updated_at ?? null,
    })));
    if (batch.length < 100) break;
    if (page === 10) throw new Error('Issue conversation exceeds the routing limit.');
  }
  if (JSON.stringify(comments).length > 150_000) throw new Error('Issue conversation exceeds the routing size limit.');
  return comments;
}

function newerHumanComment(comments, commentId) {
  if (commentId == null) return false;
  const current = BigInt(commentId);
  return comments.some((comment) => comment.id != null && BigInt(comment.id) > current
    && comment.authorType !== 'Bot' && !String(comment.author ?? '').endsWith('[bot]'));
}

function runnerAvailability(env, config) {
  return {
    capabilities: ['repository-read', 'repository-write', 'deterministic-validation'],
    mcp: String(env.CODEX_MCP_SERVERS ?? '').split(',').map((name) => name.trim()).filter(Boolean)
      .map((name) => ({ name, available: true })),
    skills: Object.keys(config.orchestration?.skills ?? {}),
  };
}

const DELIVERY_PHASES = new Set(['refine', 'research', 'requirements', 'architecture', 'plan', 'implement', 'validate', 'coordinate', 'branch', 'verify', 'commit', 'publish']);
const DELIVERY_STATUSES = new Set(['new', 'running', 'paused', 'awaiting-human', 'ready']);
const SESSION_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Read the runner-local continuation projection without granting it control
 * over GitHub. Intake needs this context to validate a resume proposal; the
 * saved file remains execution evidence and never becomes lifecycle authority.
 */
export async function readSavedDeliveryContext({ env = process.env, event = {}, repository, issueNumber } = {}) {
  const configuredRoot = env.CODEX_DELIVERY_STATE_DIR
    || (env.RUNNER_WORKSPACE ? path.join(env.RUNNER_WORKSPACE, '..', '.codex-delivery') : null);
  if (!configuredRoot) return null;
  const repositoryKey = event.repository?.id !== undefined && /^\d+$/.test(String(event.repository.id))
    ? String(event.repository.id)
    : repository.replace('/', '_');
  const stateFile = path.join(path.resolve(configuredRoot), repositoryKey, String(issueNumber), 'state.json');
  try { await access(stateFile); } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw new Error('Saved delivery state is unreadable; preserve it for operator inspection.');
  }
  let value;
  try { value = JSON.parse(await readFile(stateFile, 'utf8')); } catch { throw new Error('Saved delivery state is unreadable; preserve the issue directory for operator inspection.'); }
  const status = value?.status === 'needs_input' ? 'awaiting-human' : value?.status;
  if (value?.repository !== repository || String(value?.issue) !== String(issueNumber)
    || !DELIVERY_PHASES.has(value?.phase) || !DELIVERY_STATUSES.has(status)) {
    throw new Error('Saved delivery state does not match the current source issue; preserve it for operator inspection.');
  }
  if (value.sessionId !== undefined && (typeof value.sessionId !== 'string' || !SESSION_ID_PATTERN.test(value.sessionId))) {
    throw new Error('Saved delivery state contains an invalid Codex session ID; preserve it for operator inspection.');
  }
  const planDigest = typeof value.planDigest === 'string' && /^[a-f0-9]{64}$/i.test(value.planDigest) ? value.planDigest : null;
  const planExists = value.plan !== undefined;
  const planValid = value.plan?.status === 'ready' && planDigest !== null && value.planInvalidatedReason == null;
  const sessionExists = typeof value.sessionId === 'string';
  return {
    plan: { exists: planExists, valid: planValid, digest: planDigest, scopeChanged: value.planInvalidatedReason != null },
    session: { exists: sessionExists, resumable: sessionExists && status !== 'new', id: value.sessionId ?? null },
    execution: value.execution ?? { status: status === 'ready' ? 'completed' : status, operation: value.phase },
    scopeChanged: value.planInvalidatedReason != null,
  };
}

export async function reconcileFields({ graphql, issue, config, classification, actor = 'controller' }) {
  if (actor !== 'controller') throw new Error('Only the deterministic controller may reconcile lifecycle fields.');
  const current = issueMetadata(issue, config);
  const target = classification.targetFields ?? {
    lifecycle_stage: classification.lifecycleStage,
    readiness: classification.readiness,
  };
  const values = {};
  if (target.lifecycle_stage && (!current.fieldPresence?.lifecycleStage || current.lifecycleStage !== target.lifecycle_stage)) values.lifecycle_stage = target.lifecycle_stage;
  if (target.readiness && (!current.fieldPresence?.readiness || current.readiness !== target.readiness)) values.readiness = target.readiness;
  if (!Object.keys(values).length) return { changed: false, fields: target };
  const stageMutation = values.lifecycle_stage
    ? validateFieldMutation({ config, issueState: issue.state, field: 'lifecycle_stage', from: current.lifecycleStage, to: values.lifecycle_stage, workType: classification.workType, governance: classification.governance, actor })
    : { allowed: true };
  if (!stageMutation.allowed) throw new Error(`Lifecycle field transition rejected: ${stageMutation.reasons.join(' ')}`);
  const readinessMutation = values.readiness
    ? validateFieldMutation({ config, issueState: issue.state, field: 'readiness', from: current.readiness, to: values.readiness, workType: classification.workType, governance: classification.governance, actor })
    : { allowed: true };
  if (!readinessMutation.allowed) throw new Error(`Delivery readiness mutation rejected: ${readinessMutation.reasons.join(' ')}`);
  const mutation = { ...target, values: Object.fromEntries(Object.entries(values).map(([field, value]) => [field, issueFieldMutation({ config, field, to: value })])) };
  await setIssueFields({ graphql, issueId: issue.id, config, values, actor });
  return { changed: true, fields: mutation };
}

// Kept as a migration-only compatibility shim for callers that still import
// the old name. It deliberately performs no label mutation and reports the
// authoritative field target instead.
export async function reconcileLabels({ issue, config, classification }) {
  return {
    changed: false,
    labels: (issue.labels ?? []).map((label) => typeof label === 'string' ? label : label?.name).filter(Boolean),
    fields: classification.targetFields ?? { lifecycle_stage: classification.lifecycleStage, readiness: classification.readiness },
    migrationOnly: true,
    config,
  };
}

async function writeOutputs(result, env) {
  if (!env.GITHUB_OUTPUT) return;
  await appendFile(env.GITHUB_OUTPUT, [
    `issue=${result.issue}`,
    `route=${result.route}`,
    `state=${result.state}`,
    `lifecycle_stage=${result.metadata?.lifecycleStage ?? result.state}`,
    `readiness=${result.metadata?.readiness ?? ''}`,
    `orchestration_pattern=${result.metadata?.orchestrationPattern ?? ''}`,
    `metadata=${JSON.stringify(result.metadata)}`,
  ].join('\n') + '\n');
}

export async function classifyAndRoute({
  env = process.env,
  event,
  fetchImpl = fetch,
  config,
  reasonRoute = reasonIssueRouting,
  graphqlImpl,
  controlPlaneReader = readIssueControlPlane,
} = {}) {
  const repository = env.ORIGIN_REPOSITORY || env.GITHUB_REPOSITORY;
  const shadowMode = env.CONTROL_PLANE_MODE === 'shadow';
  const issueNumber = String(env.SOURCE_ISSUE ?? event?.issue?.number ?? '');
  if (!/^[\w.-]+\/[\w.-]+$/.test(repository ?? '') || !/^[1-9][0-9]*$/.test(issueNumber)) throw new Error('Invalid source repository or issue number.');
  if (event?.repository?.full_name && event.repository.full_name !== repository) throw new Error('Event repository does not match the originating repository.');
  if (event?.issue?.pull_request) throw new Error('A pull request cannot enter issue intake.');
  const appConfig = appConfiguration(env);
  const appProvider = appConfig.appId && appConfig.privateKey && env.ORIGIN_REPOSITORY_ID
    ? new GithubAppTokenProvider({
      repository: env.GITHUB_REPOSITORY,
      ...appConfig,
      // Shadow execution evaluates the exact same route but must not request
      // mutation capability. Active delivery gets issue write only when the
      // participant mode has already passed the deterministic enrollment gate.
      permissions: { contents: 'read', issues: shadowMode ? 'read' : 'write', pull_requests: 'read', metadata: 'read' },
      fetchImpl,
    })
    : null;
  const originToken = appProvider
    ? await appProvider.token({ repositoryIds: [env.ORIGIN_REPOSITORY_ID] })
    : env.PUBLISH_TOKEN || env.GH_TOKEN;
  const api = githubApi({ repository, token: originToken, fetchImpl });
  const routingEventKind = env.INVOCATION_EVENT === 'true' ? 'agent-invocation' : env.GITHUB_EVENT_NAME;
  const effectiveConfig = bindIssueMetadataConfig(config, env.ISSUE_FIELD_BINDINGS_JSON || {});
  const available = runnerAvailability(env, effectiveConfig);
  let issue = await api(`/issues/${issueNumber}`);
  if (issue.pull_request) throw new Error('A pull request cannot enter issue intake.');
  let graphql = graphqlImpl;
  const useGraphql = Boolean(graphqlImpl || env.GITHUB_GRAPHQL === 'true' || env.GITHUB_ACTIONS === 'true');
  if (useGraphql && !graphql) graphql = githubGraphqlApi({ token: originToken, fetchImpl });
  const readTrustedControlPlane = async (controlIssueNumber) => {
    const enriched = await controlPlaneReader({ graphql, repository, issueNumber: controlIssueNumber, organization: repository.split('/')[0] });
    const fieldContract = validateOrganizationIssueFields({ config: effectiveConfig, organizationIssueFields: enriched.organizationIssueFields });
    if (!fieldContract.valid) throw new Error(`Required organization issue fields are not ready: ${fieldContract.errors.join(' ')}`);
    return enriched;
  };
  if (graphql) {
    try {
      const enriched = await readTrustedControlPlane(issueNumber);
      issue = { ...issue, ...enriched, labels: issue.labels ?? enriched.labels ?? [] };
    } catch (error) {
      const reason = `Issue field metadata could not be read; no lifecycle mutation is authorized. ${String(error.message ?? error).slice(0, 400)}`;
      const metadata = classifyIssue({ issue, config: effectiveConfig, eventAction: event?.action, eventKind: routingEventKind, available });
      metadata.route = 'hold';
      metadata.reasons = [...metadata.reasons, reason];
      const result = { issue: issueNumber, route: 'hold', state: metadata.state, metadata, labels: issue.labels ?? [] };
      await writeOutputs(result, env);
      return result;
    }
  }
  try {
    const saved = await readSavedDeliveryContext({ env, event, repository, issueNumber });
    if (saved) issue = { ...issue, ...saved };
  } catch (error) {
    const metadata = classifyIssue({ issue, config: effectiveConfig, eventAction: event?.action, eventKind: routingEventKind, available });
    metadata.route = 'hold';
    metadata.reasons = [...metadata.reasons, `Saved execution state could not be trusted; no orchestration route is authorized. ${String(error.message ?? error).slice(0, 400)}`];
    const result = { issue: issueNumber, route: 'hold', state: metadata.state, metadata, labels: issue.labels ?? [] };
    await writeOutputs(result, env);
    return result;
  }
  const issueComment = env.GITHUB_EVENT_NAME === 'issue_comment';
  const allowlistedInvocationBot = env.INVOCATION_EVENT === 'true'
    && env.INVOCATION_ACTOR_KIND === 'external-bot'
    && env.INVOCATION_AUTHORIZED === 'true';
  const trustedComment = !issueComment || (
    (env.INVOCATION_EVENT === 'true' && env.INVOCATION_AUTHORIZED === 'true')
    || (event?.action === 'created'
      && event?.comment?.user?.type !== 'Bot'
      && !String(event?.comment?.user?.login ?? '').endsWith('[bot]'))
  );
  const resultFor = (targetIssue, metadata, fields = null) => ({
    issue: String(targetIssue.number ?? issueNumber),
    route: metadata.route,
    state: metadata.state,
    metadata,
    fields,
    labels: (targetIssue.labels ?? []).map((label) => typeof label === 'string' ? label : label?.name).filter(Boolean),
  });
  let metadata = classifyIssue({ issue, config: effectiveConfig, eventAction: event?.action, eventKind: routingEventKind, available });
  if (!trustedComment) {
    metadata.route = 'hold';
    metadata.reasons = [...metadata.reasons, 'Only a newly created non-bot comment may enter semantic routing.'];
    const result = resultFor(issue, metadata);
    await writeOutputs(result, env);
    return result;
  }
  const parentNumber = !issueComment && ['edited', 'closed', 'reopened', 'typed', 'untyped'].includes(event?.action)
    ? issue.parent?.number ?? lineageParent(issue) : null;
  if (parentNumber) {
    let parent = await api(`/issues/${parentNumber}`);
    if (graphql) {
      parent = { ...parent, ...(await readTrustedControlPlane(parentNumber)), labels: parent.labels ?? [] };
    }
    const parentMetadata = classifyIssue({ issue: parent, config: effectiveConfig, eventKind: 'child-event', available });
    const actor = env.GITHUB_TRIGGERING_ACTOR || env.GITHUB_ACTOR;
    let actorAllowed = false;
    if (typeof actor === 'string' && (actor === 'github-actions[bot]' || actor.endsWith('[bot]'))) actorAllowed = true;
    else if (actor) {
      try { actorAllowed = ['admin', 'maintain', 'write'].includes((await api(`/collaborators/${encodeURIComponent(actor)}/permission`)).permission); }
      catch (error) { if (error.status !== 404) throw error; }
    }
    if (actorAllowed && parent.state === 'open' && parentMetadata.lifecycleStage === 'acceptance') {
      metadata = { ...parentMetadata, route: 'coordinate', reasons: [...parentMetadata.reasons, `Child issue #${issueNumber} changed; coordinate parent #${parentNumber}.`] };
      const result = resultFor({ ...parent, number: parentNumber }, metadata);
      await writeOutputs(result, env);
      return result;
    }
  }
  if (issue.state !== 'open') {
    metadata.route = 'hold';
    const result = resultFor(issue, metadata);
    await writeOutputs(result, env);
    return result;
  }

  const actor = issueComment ? event.comment.user.login : env.GITHUB_TRIGGERING_ACTOR || env.GITHUB_ACTOR;
  let permission = 'none';
  if (allowlistedInvocationBot) permission = 'write';
  else if (actor) {
    try { permission = (await api(`/collaborators/${encodeURIComponent(actor)}/permission`)).permission; }
    catch (error) { if (error.status !== 404) throw error; }
  }
  if (!['admin', 'maintain', 'write'].includes(permission)) {
    metadata.route = 'hold';
    metadata.reasons = [...metadata.reasons, 'A repository writer must authorize semantic routing.'];
    const result = resultFor(issue, metadata);
    await writeOutputs(result, env);
    return result;
  }

  const manualRecovery = env.GITHUB_EVENT_NAME === 'workflow_dispatch' && env.FORCE_ROUTE === 'true';
  if (manualRecovery) {
    metadata = classifyIssue({ issue, config: effectiveConfig, mode: 'resume', eventKind: 'manual', available });
    metadata.reasons = [...metadata.reasons, 'A repository writer used manual recovery after semantic routing was unavailable.'];
  } else {
    try {
      const comments = await issueConversation(api, issueNumber);
      if (issueComment && newerHumanComment(comments, event.comment.id)) {
        metadata.route = 'hold';
        metadata.reasons = [...metadata.reasons, 'A newer human comment superseded this event.'];
        const result = resultFor(issue, metadata);
        await writeOutputs(result, env);
        return result;
      }
      const proposal = await reasonRoute({ repositoryRoot, issue: { ...issue, comments }, event: { ...event, kind: routingEventKind }, config: effectiveConfig, env });
      metadata = validateRoutingProposal({ proposal, issue, event: { ...event, kind: routingEventKind }, config: effectiveConfig, available });
    } catch (error) {
      const detail = String(error?.message ?? '').replace(/\s+/g, ' ').trim().slice(0, 500);
      const message = `Routing could not be decided. No issue fields changed. Next: rerun issue intake after Codex is available.${detail ? `\n\nReason: ${detail}` : ''}`;
      if (!shadowMode) await api(`/issues/${issueNumber}/comments`, 'POST', { body: message });
      metadata.route = 'hold';
      metadata.reasons = [...metadata.reasons, message];
      const result = resultFor(issue, metadata);
      await writeOutputs(result, env);
      return result;
    }
  }

  // Establish durable native classification before writing lifecycle fields.
  // If the organization type is not observed, fail closed and leave both
  // control-plane concepts unchanged for explicit migration.
  if (graphql && issue.id && !issue.issueType && metadata.workType) {
    const nativeType = (issue.organizationIssueTypes ?? []).find((candidate) => candidate.name === metadata.workTypeName && candidate.isEnabled !== false);
    if (!nativeType?.id) {
      metadata.route = 'hold';
      metadata.reasons = [...metadata.reasons, `The organization native issue type ${metadata.workTypeName} is not available; migration must be completed before routing can authorize delivery.`];
      const result = resultFor(issue, metadata);
      await writeOutputs(result, env);
      return result;
    }
    try {
      if (!shadowMode) await setIssueType({ graphql, issueId: issue.id, issueTypeId: nativeType.id });
    } catch (error) {
      metadata.route = 'hold';
      metadata.reasons = [...metadata.reasons, `Native issue type assignment was rejected; no lifecycle field mutation is authorized. ${String(error.message ?? error).slice(0, 400)}`];
      const result = resultFor(issue, metadata);
      await writeOutputs(result, env);
      return result;
    }
  }

  let fieldResult = null;
  if (graphql && issue.id && metadata.targetFields) {
    try {
      fieldResult = shadowMode
        ? { changed: false, fields: metadata.targetFields, shadow: true }
        : await reconcileFields({ graphql, issue, config: effectiveConfig, classification: metadata });
    } catch (error) {
      metadata.route = 'hold';
      metadata.reasons = [...metadata.reasons, `Issue-field mutation was rejected; no delivery route is authorized. ${String(error.message ?? error).slice(0, 400)}`];
      const result = resultFor(issue, metadata);
      await writeOutputs(result, env);
      return result;
    }
  } else {
    fieldResult = { changed: false, fields: metadata.targetFields, migrationRequired: true };
  }
  if (metadata.message && !shadowMode) await api(`/issues/${issueNumber}/comments`, 'POST', { body: metadata.message });
  if (shadowMode) metadata = { ...metadata, shadow: true };
  const result = resultFor(issue, metadata, fieldResult);
  await writeOutputs(result, env);
  return result;
}

const isMainModule = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMainModule) {
  try {
    const event = JSON.parse(await readFile(process.env.GITHUB_EVENT_PATH, 'utf8'));
    const config = await loadLifecycleConfig();
    const result = await classifyAndRoute({ event, config });
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}
