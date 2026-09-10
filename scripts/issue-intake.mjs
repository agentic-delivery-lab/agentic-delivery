import { appendFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseRepositoryYaml } from './lib/yaml.mjs';
import {
  classifyIssue,
  labelDefinitions,
  managedLabels,
  parseEventRequestedState,
} from './lib/issue-routing.mjs';

const repositoryRoot = path.resolve(import.meta.dirname, '..');

export async function loadLifecycleConfig(root = repositoryRoot) {
  const source = await readFile(path.join(root, '.github', 'issue-lifecycle.yml'), 'utf8');
  return parseRepositoryYaml(source, 'issue lifecycle configuration');
}

export function intakeMode(event, env = process.env) {
  if (env.INTAKE_MODE) return env.INTAKE_MODE;
  if (env.GITHUB_EVENT_NAME === 'issue_comment') return 'resume';
  if (env.GITHUB_EVENT_NAME === 'workflow_dispatch') return 'resume';
  return 'event';
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

export async function classifyAndRoute({ env = process.env, event, fetchImpl = fetch, config } = {}) {
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
  const owner = event?.repository?.owner?.login ?? repository.split('/')[0];
  const trustedOwnerComment = !issueComment || (
    event?.action === 'created'
    && event?.comment?.user?.login === owner
    && event.comment.user.type !== 'Bot'
    && event.comment.author_association === 'OWNER'
  );
  const mode = trustedOwnerComment ? intakeMode(event, env) : 'event';
  const requestedState = parseEventRequestedState(event, config);
  const metadata = classifyIssue({ issue, config, requestedState, mode, eventAction: event?.action });
  if (!trustedOwnerComment) {
    metadata.route = 'hold';
    metadata.reasons = [...metadata.reasons, 'Only a trusted repository-owner comment may continue delivery.'];
  }
  const labels = await reconcileLabels({ api, issueNumber, issue, config, classification: metadata });

  if (metadata.route === 'resume' && issue.state !== 'open') {
    metadata.route = 'hold';
    metadata.reasons = [...metadata.reasons, 'A closed issue cannot resume delivery.'];
  }

  // A ready route is an authorization boundary. Check the triggering actor
  // before handing it to the delivery workflow; ordinary intake remains open
  // to issue authors and can still reconcile metadata without this check.
  if (metadata.route === 'plan' || metadata.route === 'resume') {
    const actor = issueComment ? event.comment.user.login : env.GITHUB_TRIGGERING_ACTOR || env.GITHUB_ACTOR;
    if (!actor) {
      metadata.route = 'hold';
      metadata.reasons = [...metadata.reasons, 'A maintainer must authorize downstream delivery.'];
    } else {
      let permission = 'none';
      try {
        permission = (await api(`/collaborators/${encodeURIComponent(actor)}/permission`)).permission;
      } catch (error) {
        if (error.status !== 404) throw error;
      }
      if (!['admin', 'maintain', 'write'].includes(permission)) {
        metadata.route = 'hold';
        metadata.reasons = [...metadata.reasons, 'A maintainer must authorize downstream delivery.'];
      }
    }
  }
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
