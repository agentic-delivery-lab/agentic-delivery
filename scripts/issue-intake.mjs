import { appendFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseRepositoryYaml } from './lib/yaml.mjs';
import {
  classifyIssue,
  labelDefinitions,
  managedLabels,
  stateByLabel,
  validateRoutingProposal,
} from './lib/issue-routing.mjs';
import { validateTransition } from './lib/lifecycle-transitions.mjs';
import { reasonIssueRouting } from './lib/issue-routing-agent.mjs';

const repositoryRoot = path.resolve(import.meta.dirname, '..');

export async function loadLifecycleConfig(root = repositoryRoot) {
  const source = await readFile(path.join(root, '.github', 'issue-lifecycle.yml'), 'utf8');
  return parseRepositoryYaml(source, 'issue lifecycle configuration');
}

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
        'X-GitHub-Api-Version': '2022-11-28',
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

async function upsertLabels(api, config) {
  for (const definition of labelDefinitions(config)) {
    try {
      await api(`/labels/${encodeURIComponent(definition.name)}`);
      await api(`/labels/${encodeURIComponent(definition.name)}`, 'PATCH', definition);
    } catch (error) {
      if (error.status !== 404) throw error;
      await api('/labels', 'POST', definition);
    }
  }
}

export async function reconcileLabels({ api, issueNumber, issue, config, classification }) {
  await upsertLabels(api, config);
  const existing = (issue.labels ?? []).map((label) => typeof label === 'string' ? label : label?.name).filter(Boolean);
  const managed = managedLabels(config);
  const preserved = existing.filter((label) => !managed.has(label));
  const currentManaged = existing.filter((label) => managed.has(label));
  const currentStates = existing.map((label) => stateByLabel(config, label)?.id).filter(Boolean);
  const targetState = stateByLabel(config, classification.stateLabel)?.id;
  if (currentStates.length === 1 && targetState && currentStates[0] !== targetState) {
    const transition = validateTransition({
      config,
      from: currentStates[0],
      to: targetState,
      workType: classification.workType,
      governance: classification.governance,
      issueState: issue.state,
    });
    if (!transition.allowed) throw new Error(`Lifecycle transition rejected: ${transition.reasons.join(' ')}`);
  }
  const desiredManaged = [...classification.governance];
  if (classification.workType && classification.workTypeSource !== 'native' && !classification.conflict?.length) {
    const type = config.types.find((candidate) => candidate.id === classification.workType);
    if (type) desiredManaged.push(type.label);
  } else if (classification.conflict?.length) {
    // Keep conflicting type labels visible until a maintainer resolves them.
    desiredManaged.push(...existing.filter((label) => config.types.some((type) => type.label === label)));
  }
  if (classification.stateLabel) desiredManaged.push(classification.stateLabel);
  const next = [...new Set([...preserved, ...desiredManaged])];
  const changed = currentManaged.length !== desiredManaged.length
    || currentManaged.some((label) => !desiredManaged.includes(label))
    || preserved.length + currentManaged.length !== existing.length;
  if (changed) await api(`/issues/${issueNumber}/labels`, 'PUT', { labels: next });
  return { changed, labels: next };
}

async function writeOutputs(result, env) {
  if (!env.GITHUB_OUTPUT) return;
  await appendFile(env.GITHUB_OUTPUT, [
    `issue=${result.issue}`,
    `route=${result.route}`,
    `state=${result.state}`,
    `metadata=${JSON.stringify(result.metadata)}`,
  ].join('\n') + '\n');
}

export async function classifyAndRoute({ env = process.env, event, fetchImpl = fetch, config, reasonRoute = reasonIssueRouting } = {}) {
  const repository = env.GITHUB_REPOSITORY;
  const issueNumber = String(env.SOURCE_ISSUE ?? event?.issue?.number ?? '');
  if (!/^[\w.-]+\/[\w.-]+$/.test(repository ?? '') || !/^[1-9][0-9]*$/.test(issueNumber)) {
    throw new Error('Invalid source repository or issue number.');
  }
  if (event?.issue?.pull_request) throw new Error('A pull request cannot enter issue intake.');
  const api = githubApi({ repository, token: env.GH_TOKEN, fetchImpl });
  const issue = await api(`/issues/${issueNumber}`);
  if (issue.pull_request) throw new Error('A pull request cannot enter issue intake.');
  const issueComment = env.GITHUB_EVENT_NAME === 'issue_comment';
  const trustedComment = !issueComment || (
    event?.action === 'created'
    && event?.comment?.user?.type !== 'Bot'
    && !String(event?.comment?.user?.login ?? '').endsWith('[bot]')
  );
  let metadata = classifyIssue({ issue, config, eventAction: event?.action });
  if (!trustedComment) {
    metadata.route = 'hold';
    metadata.reasons = [...metadata.reasons, 'Only a newly created non-bot comment may enter semantic routing.'];
    const result = { issue: issueNumber, route: metadata.route, state: metadata.state, metadata, labels: (issue.labels ?? []).map((label) => typeof label === 'string' ? label : label?.name).filter(Boolean) };
    await writeOutputs(result, env);
    return result;
  }
  const parentNumber = !issueComment && ['edited', 'closed', 'reopened', 'labeled', 'unlabeled', 'typed', 'untyped'].includes(event?.action)
    ? lineageParent(issue) : null;
  if (parentNumber) {
    const parent = await api(`/issues/${parentNumber}`);
    const parentMetadata = classifyIssue({ issue: parent, config });
    const actor = env.GITHUB_TRIGGERING_ACTOR || env.GITHUB_ACTOR;
    let actorAllowed = false;
    if (typeof actor === 'string' && (actor === 'github-actions[bot]' || actor.endsWith('[bot]'))) actorAllowed = true;
    else if (actor) {
      try { actorAllowed = ['admin', 'maintain', 'write'].includes((await api(`/collaborators/${encodeURIComponent(actor)}/permission`)).permission); } catch (error) {
        if (error.status !== 404) throw error;
      }
    }
    if (actorAllowed && parent.state === 'open' && parentMetadata.state === 'coordinating') {
      metadata = { ...parentMetadata, route: 'coordinate', reasons: [...parentMetadata.reasons, `Child issue #${issueNumber} changed; coordinate parent #${parentNumber}.`] };
      const result = { issue: parentNumber, route: metadata.route, state: metadata.state, metadata, labels: (parent.labels ?? []).map((label) => typeof label === 'string' ? label : label?.name).filter(Boolean) };
      await writeOutputs(result, env);
      return result;
    }
  }
  if (issue.state !== 'open') {
    metadata.route = 'hold';
    const result = { issue: issueNumber, route: metadata.route, state: metadata.state, metadata, labels: (issue.labels ?? []).map((label) => typeof label === 'string' ? label : label?.name).filter(Boolean) };
    await writeOutputs(result, env);
    return result;
  }

  const actor = issueComment ? event.comment.user.login : env.GITHUB_TRIGGERING_ACTOR || env.GITHUB_ACTOR;
  let permission = 'none';
  if (actor) {
    try { permission = (await api(`/collaborators/${encodeURIComponent(actor)}/permission`)).permission; }
    catch (error) { if (error.status !== 404) throw error; }
  }
  if (!['admin', 'maintain', 'write'].includes(permission)) {
    metadata.route = 'hold';
    metadata.reasons = [...metadata.reasons, 'A repository writer must authorize semantic routing.'];
    const result = { issue: issueNumber, route: metadata.route, state: metadata.state, metadata, labels: (issue.labels ?? []).map((label) => typeof label === 'string' ? label : label?.name).filter(Boolean) };
    await writeOutputs(result, env);
    return result;
  }

  const manualRecovery = env.GITHUB_EVENT_NAME === 'workflow_dispatch' && env.FORCE_ROUTE === 'true';
  if (manualRecovery) {
    metadata = classifyIssue({ issue, config, mode: 'resume' });
    metadata.reasons = [...metadata.reasons, 'A repository writer used manual recovery after semantic routing was unavailable.'];
  } else {
    try {
      const comments = await issueConversation(api, issueNumber);
      if (issueComment && newerHumanComment(comments, event.comment.id)) {
        metadata.route = 'hold';
        metadata.reasons = [...metadata.reasons, 'A newer human comment superseded this event.'];
        const result = { issue: issueNumber, route: 'hold', state: metadata.state, metadata, labels: (issue.labels ?? []).map((label) => typeof label === 'string' ? label : label?.name).filter(Boolean) };
        await writeOutputs(result, env);
        return result;
      }
      const proposal = await reasonRoute({
        repositoryRoot,
        issue: { ...issue, comments },
        event: { ...event, kind: env.GITHUB_EVENT_NAME },
        config,
        env,
      });
      metadata = validateRoutingProposal({ proposal, issue, event: { ...event, kind: env.GITHUB_EVENT_NAME }, config });
    } catch (error) {
      const detail = String(error?.message ?? '').replace(/\s+/g, ' ').trim().slice(0, 500);
      const message = `Routing could not be decided. No labels changed. Next: rerun issue intake after Codex is available.${detail ? `\n\nReason: ${detail}` : ''}`;
      await api(`/issues/${issueNumber}/comments`, 'POST', { body: message });
      metadata.route = 'hold';
      metadata.reasons = [...metadata.reasons, message];
      const result = { issue: issueNumber, route: 'hold', state: metadata.state, metadata, labels: (issue.labels ?? []).map((label) => typeof label === 'string' ? label : label?.name).filter(Boolean) };
      await writeOutputs(result, env);
      return result;
    }
  }

  const labels = await reconcileLabels({ api, issueNumber, issue, config, classification: metadata });
  if (metadata.message) await api(`/issues/${issueNumber}/comments`, 'POST', { body: metadata.message });
  const result = { issue: issueNumber, route: metadata.route, state: metadata.state, metadata, labels: labels.labels };
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
