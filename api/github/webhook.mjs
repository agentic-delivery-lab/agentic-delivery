import { createHmac } from 'node:crypto';

// agentic-primitive: {"id":"organization-webhook-ingress","kind":"validator","enforcement":"deterministic","adrs":["ADR-0018","ADR-0017"],"domains":["agentic-delivery-control-plane","agentic-delivery-governance"]}

import actorCatalog from '../../config/agent-actors.json' with { type: 'json' };
import {
  AGENT_BOT_LOGIN,
  AGENT_MENTION,
  actorEntry,
  invocationBody,
  invocationEnvelope,
  observationEventSupported,
  webhookEventSupported,
  hasInvocationMention,
  sourceFromWebhook,
  validateActorCatalog,
  webhookSignature,
} from '../../scripts/lib/agent-invocation.mjs';
import {
  authorizeParticipation,
  loadParticipantRegistry,
} from '../../scripts/lib/participant-registry.mjs';
import { assertEventEnvelope } from '../../scripts/lib/control-plane-contracts.mjs';
import { GithubAppTokenProvider } from '../../scripts/lib/github-app.mjs';
import { FileReplayStore, InMemoryReplayStore, ReplayProtectionError, claimDelivery, releaseDelivery } from '../../scripts/lib/replay-protection.mjs';

export const config = { api: { bodyParser: false } };

const API_VERSION = '2026-03-10';
const DEFAULT_ORGANIZATION = 'agentic-delivery-lab';
const DEFAULT_ORGANIZATION_ID = '327861320';
function header(req, name) {
  const value = req.headers?.[name] ?? req.headers?.[name.toLowerCase()];
  return Array.isArray(value) ? value[0] : value;
}

async function rawBody(req) {
  if (Buffer.isBuffer(req.body)) return req.body;
  if (typeof req.body === 'string') return Buffer.from(req.body, 'utf8');
  if (req.body && typeof req.body === 'object') return Buffer.from(JSON.stringify(req.body), 'utf8');
  const chunks = [];
  for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return Buffer.concat(chunks);
}

function reply(res, status, body = null) {
  res.statusCode = status;
  res.setHeader('Cache-Control', 'no-store');
  if (body === null) return res.end();
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  return res.end(JSON.stringify(body));
}

function environment(env = process.env) {
  return {
    controllerRepository: env.AGENTIC_DELIVERY_CONTROLLER_REPOSITORY
      || env.AGENTIC_DELIVERY_REPOSITORY,
    controllerRepositoryId: env.AGENTIC_DELIVERY_CONTROLLER_REPOSITORY_ID,
    organization: env.AGENTIC_DELIVERY_ORGANIZATION || DEFAULT_ORGANIZATION,
    organizationId: env.AGENTIC_DELIVERY_ORGANIZATION_ID || DEFAULT_ORGANIZATION_ID,
    appId: env.AGENTIC_DELIVERY_APP_ID || env.CODEX_DELIVERY_APP_ID,
    privateKey: env.AGENTIC_DELIVERY_APP_PRIVATE_KEY || env.CODEX_DELIVERY_APP_PRIVATE_KEY,
    installationId: env.AGENTIC_DELIVERY_APP_INSTALLATION_ID || env.CODEX_DELIVERY_APP_INSTALLATION_ID,
    webhookSecret: env.AGENTIC_DELIVERY_WEBHOOK_SECRET,
    replayStateDirectory: env.AGENTIC_DELIVERY_REPLAY_STATE_DIRECTORY,
    replayWindowMs: Number(env.AGENTIC_DELIVERY_REPLAY_WINDOW_MS || 300_000),
  };
}

function replayStoreFor(env, config) {
  if (config.replayStateDirectory) return new FileReplayStore({ directory: config.replayStateDirectory });
  if (env?.AGENTIC_DELIVERY_ALLOW_EPHEMERAL_REPLAY === 'true') return new InMemoryReplayStore();
  throw new ReplayProtectionError('A durable replay store is required; configure AGENTIC_DELIVERY_REPLAY_STATE_DIRECTORY or inject a replayStore adapter.', 2);
}

function appActor(payload) {
  return payload?.sender ?? payload?.comment?.user ?? payload?.review?.user ?? null;
}

async function repositoryApi({ repository, token, route, method = 'GET', body, fetchImpl = fetch }) {
  const response = await fetchImpl('https://api.github.com/repos/' + repository + route, {
    method,
    headers: {
      Authorization: 'Bearer ' + token,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': API_VERSION,
      'Content-Type': 'application/json',
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(8_000),
  });
  if (!response.ok) {
    const error = new Error('GitHub ' + method + ' ' + route + ' failed (' + response.status + ').');
    error.status = response.status;
    throw error;
  }
  return response.status === 204 ? null : response.json();
}

async function actorIsAuthorized({ actor, repository, token, config, fetchImpl }) {
  const login = String(actor?.login ?? '');
  const isBot = actor?.type === 'Bot' || login.endsWith('[bot]');
  if (isBot) {
    const registered = actorEntry(actorCatalog, login);
    if (!registered?.can_invoke || login === config.botLogin) return { allowed: false, reason: 'The bot is not an allowlisted invocation actor.' };
    if (config.maxBotHops < 1) return { allowed: false, reason: 'Bot-to-bot invocation is disabled by the actor catalog.' };
    return { allowed: true, kind: registered.kind ?? 'external-bot', permission: 'bot' };
  }
  if (!login || !/^[A-Za-z0-9_.-]+$/.test(login)) return { allowed: false, reason: 'The webhook actor login is invalid.' };
  try {
    const permission = await repositoryApi({
      repository,
      token,
      route: '/collaborators/' + encodeURIComponent(login) + '/permission',
      fetchImpl,
    });
    if (!actorCatalog.human_permissions.includes(permission?.permission)) {
      return { allowed: false, reason: 'The actor does not have repository write permission.' };
    }
    return { allowed: true, kind: 'human', permission: permission.permission };
  } catch (error) {
    if (error.status === 404) return { allowed: false, reason: 'The webhook actor is not a repository collaborator.' };
    throw error;
  }
}

function registryValue(value) {
  return value?.participants instanceof Map ? value : null;
}

export async function handleWebhook(req, res, {
  env = process.env,
  fetchImpl = fetch,
  tokenProvider,
  participantRegistry,
  replayStore,
  now = () => Date.now(),
} = {}) {
  if (req.method !== 'POST') return reply(res, 405, { error: 'POST is required.' });
  const config = environment(env);
  const catalog = validateActorCatalog(actorCatalog);
  if (!catalog.valid) return reply(res, 500, { error: 'The actor catalog is invalid.' });
  if (!config.webhookSecret) return reply(res, 500, { error: 'The webhook secret is not configured.' });
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(String(config.controllerRepository ?? ''))) {
    return reply(res, 500, { error: 'The central controller repository is not configured.' });
  }
  if (!/^[1-9][0-9]*$/.test(String(config.controllerRepositoryId ?? ''))) {
    return reply(res, 500, { error: 'The central controller repository ID is not configured.' });
  }
  if (!/^[1-9][0-9]*$/.test(String(config.installationId ?? ''))) {
    return reply(res, 500, { error: 'The GitHub App installation ID is not configured.' });
  }
  const raw = await rawBody(req);
  const signature = header(req, 'x-hub-signature-256');
  const signatureValid = webhookSignature({
    secret: config.webhookSecret,
    rawBody: raw,
    signature,
    hmac: (secret, value) => createHmac('sha256', secret).update(value, 'utf8').digest('hex'),
  });
  if (!signatureValid) return reply(res, 401, { error: 'Invalid webhook signature.' });

  let payload;
  try { payload = JSON.parse(raw.toString('utf8')); } catch { return reply(res, 400, { error: 'Webhook payload is not valid JSON.' }); }
  const eventName = String(header(req, 'x-github-event') ?? '');
  const action = String(payload?.action ?? '');
  if (!webhookEventSupported(eventName, action)) return reply(res, 204);
  if (payload?.organization?.login !== config.organization
    || String(payload.organization?.id ?? '') !== String(config.organizationId)) {
    return reply(res, 403, { error: 'Webhook organization identity is not authorized.' });
  }
  if (String(payload.installation?.id ?? '') !== String(config.installationId)) {
    return reply(res, 403, { error: 'Webhook installation identity is not authorized.' });
  }
  if (!payload?.repository?.full_name || !payload?.repository?.id) return reply(res, 400, { error: 'Webhook repository identity is missing.' });

  const body = invocationBody(eventName, payload);
  const issueLifecycleEvent = eventName === 'issues';
  const observationEvent = observationEventSupported(eventName, action);
  if (!issueLifecycleEvent && !observationEvent && !hasInvocationMention(body, AGENT_MENTION)) return reply(res, 204);
  const repository = String(payload.repository.full_name);
  const repositoryId = String(payload.repository.id);
  const deliveryId = header(req, 'x-github-delivery');
  if (!/^[0-9a-f-]{20,}$/i.test(String(deliveryId ?? ''))) return reply(res, 400, { error: 'GitHub delivery identity is invalid.' });
  const registry = registryValue(participantRegistry) ?? registryValue(await loadParticipantRegistry());
  const actor = appActor(payload);
  const provider = tokenProvider ?? new GithubAppTokenProvider({
    repository: config.controllerRepository,
    appId: config.appId,
    privateKey: config.privateKey,
    installationId: config.installationId,
    // The origin token only authenticates read-only actor/replay checks. The
    // unscoped controller token is minted separately with contents:write.
    permissions: { contents: 'read', issues: 'read', pull_requests: 'read', metadata: 'read' },
    fetchImpl,
  });
  let originToken;
  try {
    originToken = await provider.token({ repositoryIds: [repositoryId] });
  } catch {
    return reply(res, 403, { error: 'The GitHub App installation cannot access the event repository.' });
  }
  const participation = authorizeParticipation({
    registry,
    repositoryId,
    repositoryFullName: repository,
    appAccessVerified: true,
  });
  if (!participation.allowed) return reply(res, 403, { error: participation.reason });
  if (!participation.participant.events.includes(eventName)) return reply(res, 204);
  const authorization = observationEvent
    ? { allowed: true, kind: 'github-event', permission: 'event' }
    : await actorIsAuthorized({
      actor,
      repository,
      token: originToken,
      config: { botLogin: AGENT_BOT_LOGIN, maxBotHops: actorCatalog.max_bot_hops },
      fetchImpl,
    });
  if (!authorization.allowed) return reply(res, 403, { error: authorization.reason });

  const activeReplayStore = replayStore ?? replayStoreFor(env, config);
  const claimed = await claimDelivery(activeReplayStore, {
    installationId: config.installationId,
    deliveryId,
    ttlMs: config.replayWindowMs,
  });
  if (!claimed) return reply(res, 200, { accepted: false, duplicate: true, delivery_id: deliveryId, repository_id: repositoryId });

  const envelope = invocationEnvelope({
    deliveryId,
    eventName,
    action,
    repositoryId,
    source: sourceFromWebhook(eventName, payload),
    actor,
    body,
    hop: actor?.type === 'Bot' || String(actor?.login ?? '').endsWith('[bot]') ? 1 : 0,
    parentDeliveryId: null,
    controller: participation.participant.controller,
    receivedAt: new Date(now()).toISOString(),
    organizationId: config.organizationId,
    installationId: config.installationId,
    repositoryFullName: repository,
  });
  assertEventEnvelope(envelope);
  try {
    const controllerToken = await provider.token({
      repositoryIds: [config.controllerRepositoryId],
      permissions: { contents: 'write' },
    });
    await repositoryApi({
      repository: config.controllerRepository,
      token: controllerToken,
      route: '/dispatches',
      method: 'POST',
      body: { event_type: 'agent_invocation', client_payload: envelope },
      fetchImpl,
    });
  } catch (error) {
    await releaseDelivery(activeReplayStore, { installationId: config.installationId, deliveryId });
    throw error;
  }
  return reply(res, 202, { accepted: true, delivery_id: deliveryId, repository_id: repositoryId });
}

export default async function handler(req, res) {
  try {
    return await handleWebhook(req, res);
  } catch (error) {
    // Do not expose GitHub responses or credential details to the public hook.
    return reply(res, 502, { error: 'The invocation could not be dispatched.' });
  }
}
