import { createHmac } from 'node:crypto';

import { GithubAppTokenProvider } from '../../scripts/lib/github-app.mjs';
import actorCatalog from '../../.github/agent-actors.json' with { type: 'json' };
import {
  AGENT_BOT_LOGIN,
  AGENT_MENTION,
  actorEntry,
  invocationBody,
  invocationEnvelope,
  invocationEventSupported,
  hasInvocationMention,
  sourceFromWebhook,
  validateActorCatalog,
  webhookSignature,
} from '../../scripts/lib/agent-invocation.mjs';

export const config = { api: { bodyParser: false } };

const API_VERSION = '2026-03-10';
const DEFAULT_REPOSITORY = 'agentic-delivery-lab/agentic-delivery';

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
    repository: env.AGENTIC_DELIVERY_REPOSITORY || env.GITHUB_REPOSITORY || DEFAULT_REPOSITORY,
    appId: env.AGENTIC_DELIVERY_APP_ID || env.CODEX_DELIVERY_APP_ID,
    privateKey: env.AGENTIC_DELIVERY_APP_PRIVATE_KEY || env.CODEX_DELIVERY_APP_PRIVATE_KEY,
    installationId: env.AGENTIC_DELIVERY_APP_INSTALLATION_ID || env.CODEX_DELIVERY_APP_INSTALLATION_ID,
    webhookSecret: env.AGENTIC_DELIVERY_WEBHOOK_SECRET,
  };
}

function appActor(payload) {
  return payload?.sender ?? payload?.comment?.user ?? payload?.review?.user ?? null;
}

async function repositoryApi({ repository, token, route, method = 'GET', body, fetchImpl = fetch }) {
  const response = await fetchImpl(`https://api.github.com/repos/${repository}${route}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': API_VERSION,
      'Content-Type': 'application/json',
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(8_000),
  });
  if (!response.ok) {
    const error = new Error(`GitHub ${method} ${route} failed (${response.status}).`);
    error.status = response.status;
    throw error;
  }
  return response.status === 204 ? null : response.json();
}

async function actorIsAuthorized({ actor, config, token, fetchImpl }) {
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
      repository: config.repository,
      token,
      route: `/collaborators/${encodeURIComponent(login)}/permission`,
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

export async function handleWebhook(req, res, { env = process.env, fetchImpl = fetch, tokenProvider } = {}) {
  if (req.method !== 'POST') return reply(res, 405, { error: 'POST is required.' });
  const config = environment(env);
  const catalog = validateActorCatalog(actorCatalog);
  if (!catalog.valid) return reply(res, 500, { error: 'The actor catalog is invalid.' });
  if (!config.webhookSecret) return reply(res, 500, { error: 'The webhook secret is not configured.' });
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
  if (!invocationEventSupported(eventName, action)) return reply(res, 204);
  if (payload?.repository?.full_name !== config.repository) return reply(res, 403, { error: 'Webhook repository is not installed for this endpoint.' });
  if (!payload?.repository?.id || !header(req, 'x-github-delivery')) return reply(res, 400, { error: 'GitHub delivery identity is missing.' });

  const body = invocationBody(eventName, payload);
  if (!hasInvocationMention(body, AGENT_MENTION)) return reply(res, 204);
  const actor = appActor(payload);
  const provider = tokenProvider ?? new GithubAppTokenProvider({
    repository: config.repository,
    appId: config.appId,
    privateKey: config.privateKey,
    installationId: config.installationId,
    permissions: { contents: 'write', metadata: 'read' },
    fetchImpl,
  });
  const token = await provider.token();
  const authorization = await actorIsAuthorized({ actor, config: { ...config, botLogin: AGENT_BOT_LOGIN, maxBotHops: actorCatalog.max_bot_hops }, token, fetchImpl });
  if (!authorization.allowed) return reply(res, 403, { error: authorization.reason });

  const source = sourceFromWebhook(eventName, payload);
  const deliveryId = header(req, 'x-github-delivery');
  const envelope = invocationEnvelope({
    deliveryId,
    eventName,
    action,
    repositoryId: payload.repository.id,
    source,
    actor,
    body,
    hop: actor?.type === 'Bot' || String(actor?.login ?? '').endsWith('[bot]') ? 1 : 0,
    parentDeliveryId: null,
  });
  await repositoryApi({
    repository: config.repository,
    token,
    route: '/dispatches',
    method: 'POST',
    body: { event_type: 'agent_invocation', client_payload: envelope },
    fetchImpl,
  });
  return reply(res, 202, { accepted: true, delivery_id: deliveryId });
}

export default async function handler(req, res) {
  try {
    return await handleWebhook(req, res);
  } catch (error) {
    // Do not expose GitHub responses or credential details to the public hook.
    return reply(res, 502, { error: 'The invocation could not be dispatched.' });
  }
}
