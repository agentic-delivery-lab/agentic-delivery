// agentic-primitive: {"id":"agent-invocation-preflight","kind":"validator","enforcement":"deterministic","adrs":["ADR-0017","ADR-0018"],"domains":["agentic-delivery-governance","agentic-delivery-control-plane"]}
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  AGENT_BOT_LOGIN,
  actorEntry,
  bodyDigest,
  hasInvocationMention,
  observationEventSupported,
  validateActorCatalog,
} from './lib/agent-invocation.mjs';
import { appConfiguration, GithubAppTokenProvider } from './lib/github-app.mjs';
import { loadParticipantRegistry, participantForRepository } from './lib/participant-registry.mjs';
import { validateEventEnvelope } from './lib/control-plane-contracts.mjs';
import { validateReceivedAt } from './lib/replay-protection.mjs';
import actorCatalog from '../config/agent-actors.json' with { type: 'json' };

const API_VERSION = '2026-03-10';
async function writeOutput(name, value, env = process.env) {
  if (!env.GITHUB_OUTPUT) return;
  const encoded = String(value ?? '');
  await import('node:fs/promises').then(({ appendFile }) => appendFile(env.GITHUB_OUTPUT, `${name}<<AGENT_INVOCATION_EOF\n${encoded}\nAGENT_INVOCATION_EOF\n`));
}

function apiClient({ repository, token, fetchImpl = fetch }) {
  return async (route) => {
    const response = await fetchImpl(`https://api.github.com/repos/${repository}${route}`, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': API_VERSION,
      },
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) {
      const error = new Error(`GitHub GET ${route} failed (${response.status}).`);
      error.status = response.status;
      throw error;
    }
    return response.json();
  };
}

function sourceIssueFromPullRequest(pullRequest) {
  const branch = String(pullRequest?.head?.ref ?? '');
  const fromBranch = /(?:^|\/)issue-([1-9][0-9]*)-[a-z0-9-]+$/i.exec(branch)?.[1];
  if (fromBranch) return fromBranch;
  const fromBody = /^\s*-\s*Source issue:\s*(?:Closes|Refs)?\s*#([1-9][0-9]*)\b/im.exec(String(pullRequest?.body ?? ''))?.[1];
  return fromBody ?? null;
}

async function currentSource({ event, envelope, api }) {
  const source = envelope.source ?? {};
  if (source.kind === 'issue_comment') return String(source.issue_number);
  if (source.kind === 'issue') return String(source.issue_number);
  const pullRequestNumber = String(source.pull_request_number ?? '');
  if (!/^[1-9][0-9]*$/.test(pullRequestNumber)) throw new Error('The invocation does not identify a pull request.');
  const pullRequest = await api(`/pulls/${pullRequestNumber}`);
  if (pullRequest.base?.repo?.full_name && pullRequest.base.repo.full_name !== event.repository.full_name) throw new Error('The pull request belongs to another repository.');
  const issue = sourceIssueFromPullRequest(pullRequest);
  if (!issue) throw new Error('The pull request cannot be mapped to an issue-linked source.');
  return issue;
}

async function currentComment({ envelope, api }) {
  const source = envelope.source ?? {};
  if (envelope.event === 'issues') return null;
  let item;
  if (envelope.event === 'issue_comment') item = await api(`/issues/comments/${source.comment_id}`);
  else if (envelope.event === 'pull_request_review') item = await api(`/pulls/${source.pull_request_number}/reviews/${source.review_id}`);
  else item = await api(`/pulls/comments/${source.comment_id}`);
  const body = String(item?.body ?? '');
  const login = String(item?.user?.login ?? '');
  if (login !== envelope.actor?.login) throw new Error('The current comment author differs from the signed webhook actor.');
  if (bodyDigest(body) !== envelope.body_digest) throw new Error('The comment changed after webhook dispatch; request it again with a new tag.');
  if (!hasInvocationMention(body)) throw new Error('The current comment no longer contains the invocation tag.');
  return {
    id: String(item.id),
    body,
    user: item.user,
    author_association: item.author_association,
  };
}

async function authorizeActor({ envelope, api }) {
  const login = String(envelope.actor?.login ?? '');
  const isBot = envelope.actor?.type === 'Bot' || login.endsWith('[bot]');
  if (isBot) {
    const registered = actorEntry(actorCatalog, login);
    if (!registered?.can_invoke || login === AGENT_BOT_LOGIN || Number(envelope.hop) > actorCatalog.max_bot_hops) {
      throw new Error('The bot actor is not authorized for this invocation.');
    }
    return { kind: registered.kind ?? 'external-bot', authorized: true };
  }
  const permission = await api(`/collaborators/${encodeURIComponent(login)}/permission`);
  if (!actorCatalog.human_permissions.includes(permission?.permission)) throw new Error('The webhook actor does not have repository write permission.');
  return { kind: 'human', authorized: true };
}

async function markDelivery({ repository, sourceIssue, deliveryId, env }) {
  const root = path.resolve(env.CODEX_DELIVERY_STATE_DIR || env.RUNNER_TEMP || '/tmp');
  const markerDirectory = path.join(root, 'agent-invocations', repository.replace('/', '_'), String(sourceIssue));
  await mkdir(markerDirectory, { recursive: true, mode: 0o700 });
  const marker = path.join(markerDirectory, `${deliveryId}.json`);
  try {
    await writeFile(marker, JSON.stringify({ deliveryId, sourceIssue, acceptedAt: new Date().toISOString() }), { flag: 'wx', mode: 0o600 });
    return true;
  } catch (error) {
    if (error.code === 'EEXIST') return false;
    throw error;
  }
}

export async function prepareAgentInvocation({ env = process.env, fetchImpl = fetch, participantRegistry, now = () => Date.now() } = {}) {
  const catalog = validateActorCatalog(actorCatalog);
  if (!catalog.valid) throw new Error(`The actor catalog is invalid: ${catalog.errors.join(' ')}`);
  if (!env.GH_TOKEN || !env.GITHUB_EVENT_PATH || !env.GITHUB_REPOSITORY) throw new Error('Agent invocation preflight requires GitHub event, repository, and token context.');
  const event = JSON.parse(await readFile(env.GITHUB_EVENT_PATH, 'utf8'));
  const envelope = event?.client_payload;
  const envelopeValidation = validateEventEnvelope(envelope);
  if (!envelopeValidation.valid) throw new Error(`The repository dispatch envelope is invalid: ${envelopeValidation.errors.join(' ')}`);
  if (envelope.received_at !== undefined) {
    const freshness = validateReceivedAt(envelope.received_at, { now: now() });
    if (!freshness.valid) throw new Error(`The repository dispatch envelope is stale: ${freshness.reason}`);
  }
  const controllerRepository = env.GITHUB_REPOSITORY;
  if (String(event.repository?.full_name) !== controllerRepository) throw new Error('The dispatch controller repository boundary is invalid.');
  if (!/^[\w.-]+\/[\w.-]+$/.test(controllerRepository) || !/^[1-9][0-9]*$/.test(String(envelope.repository_id))
    || !/^[0-9a-f-]{20,}$/i.test(String(envelope.delivery_id))) throw new Error('The dispatch identity is invalid.');
  if (!/^[A-Za-z0-9_.\[\]-]+$/.test(String(envelope.actor?.login ?? ''))) throw new Error('The dispatch actor is invalid.');
  const registry = participantRegistry ?? await loadParticipantRegistry();
  if (!registry.valid) throw new Error('The participant registry is invalid: ' + registry.errors.join(' '));
  const participant = participantForRepository(registry, envelope.repository_id);
  if (!participant || participant.mode === 'disabled') throw new Error('The dispatch repository is not an active participant.');
  if (envelope.controller && (envelope.controller.version !== participant.controller.version
    || envelope.controller.commit.toLowerCase() !== participant.controller.commit.toLowerCase())) {
    throw new Error('The dispatch controller pin does not match the participant registry.');
  }
  const originRepository = participant.expectedFullName;
  if (envelope.repository_full_name !== undefined && envelope.repository_full_name !== originRepository) {
    throw new Error('The dispatch repository full name does not match the participant registry.');
  }
  const appConfig = appConfiguration(env);
  const configuredOrganizationId = env.AGENTIC_DELIVERY_ORGANIZATION_ID || env.CODEX_DELIVERY_ORGANIZATION_ID;
  if (envelope.organization_id !== undefined && configuredOrganizationId !== undefined
    && String(envelope.organization_id) !== String(configuredOrganizationId)) {
    throw new Error('The dispatch organization identity does not match the controller configuration.');
  }
  if (envelope.installation_id !== undefined && appConfig.installationId !== undefined
    && String(envelope.installation_id) !== String(appConfig.installationId)) {
    throw new Error('The dispatch installation identity does not match the controller configuration.');
  }
  if (observationEventSupported(envelope.event, envelope.action)) {
    if (!participant.events.includes(envelope.event)) throw new Error('The observation event is not enrolled for this participant.');
    await writeOutput('accepted', 'false', env);
    await writeOutput('observation_only', 'true', env);
    await writeOutput('origin_repository', originRepository, env);
    await writeOutput('origin_repository_id', envelope.repository_id, env);
    await writeOutput('participant_mode', participant.mode, env);
    await writeOutput('controller_version', participant.controller.version, env);
    await writeOutput('controller_commit', participant.controller.commit, env);
    await writeOutput('invocation_event_name', envelope.event, env);
    return {
      accepted: false,
      observation: true,
      originRepository,
      participantMode: participant.mode,
    };
  }
  const appProvider = appConfig.appId && appConfig.privateKey
    ? new GithubAppTokenProvider({
      repository: controllerRepository,
      ...appConfig,
      permissions: { contents: 'read', issues: 'read', pull_requests: 'read', metadata: 'read' },
      fetchImpl,
    })
    : null;
  const originToken = appProvider
    ? await appProvider.token({ repositoryIds: [String(envelope.repository_id)] })
    : env.GH_TOKEN;
  const api = apiClient({ repository: originRepository, token: originToken, fetchImpl });
  const originEvent = {
    ...event,
    repository: { ...event.repository, id: Number(envelope.repository_id), full_name: originRepository },
  };
  const authorization = await authorizeActor({ envelope, api });
  const sourceIssue = await currentSource({ event: originEvent, envelope, api });
  if (!/^[1-9][0-9]*$/.test(sourceIssue)) throw new Error('The source issue number is invalid.');
  const comment = await currentComment({ envelope, api });
  const accepted = await markDelivery({ repository: originRepository, sourceIssue, deliveryId: envelope.delivery_id, env });
  const normalizedPath = path.join(path.resolve(env.RUNNER_TEMP || '/tmp'), `agent-invocation-${envelope.delivery_id}.json`);
  await writeFile(normalizedPath, JSON.stringify({
    action: envelope.event === 'issues' ? envelope.action : 'created',
    repository: originEvent.repository,
    issue: { number: Number(sourceIssue) },
    ...(comment ? { comment } : {}),
    sender: envelope.actor,
  }), { mode: 0o600 });
  await writeOutput('accepted', accepted ? 'true' : 'false', env);
  await writeOutput('source_issue', sourceIssue, env);
  await writeOutput('origin_repository', originRepository, env);
  await writeOutput('origin_repository_id', envelope.repository_id, env);
  await writeOutput('participant_mode', participant.mode, env);
  await writeOutput('controller_version', participant.controller.version, env);
  await writeOutput('controller_commit', participant.controller.commit, env);
  await writeOutput('event_path', normalizedPath, env);
  await writeOutput('invocation_event_name', envelope.event, env);
  await writeOutput('invocation_source_kind', envelope.source?.kind ?? '', env);
  await writeOutput('invocation_comment_id', envelope.source?.comment_id ?? '', env);
  await writeOutput('invocation_review_id', envelope.source?.review_id ?? '', env);
  await writeOutput('invocation_pull_request_number', envelope.source?.pull_request_number ?? '', env);
  await writeOutput('invocation_delivery_id', envelope.delivery_id, env);
  await writeOutput('invocation_actor', envelope.actor.login, env);
  await writeOutput('invocation_actor_kind', authorization.kind, env);
  await writeOutput('invocation_authorized', authorization.authorized ? 'true' : 'false', env);
  await writeOutput('invocation_body_digest', envelope.body_digest, env);
  return { accepted, sourceIssue, normalizedPath, originRepository, participantMode: participant.mode, authorization };
}

const isMainModule = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMainModule) {
  try {
    const result = await prepareAgentInvocation();
    process.stdout.write(`${result.accepted ? 'Accepted' : 'Ignored duplicate'} agent invocation for issue #${result.sourceIssue}.\n`);
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}
