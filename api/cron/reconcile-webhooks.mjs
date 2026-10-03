// agentic-primitive: {"id":"webhook-delivery-reconciler","kind":"validator","enforcement":"deterministic","adrs":["ADR-0018"],"domains":["agentic-delivery-control-plane"]}
import { timingSafeEqual } from 'node:crypto';

import { createGithubAppJwt } from '../../scripts/lib/github-app.mjs';
import { replayKey } from '../../scripts/lib/replay-protection.mjs';
import { NeonReplayStore, REDELIVERY_COOLDOWN_MS } from '../../scripts/lib/neon-replay-store.mjs';

const API_VERSION = '2026-03-10';
const PAGE_SIZE = 100;
const MAX_PAGES = 100;
const MAX_REDELIVERIES = 1_000;
const CONTROLLER_RECEIPT_LIMIT = 500;

export const config = { maxDuration: 'max' };

function bearerMatches(headerValue, secret) {
  if (typeof secret !== 'string' || secret.length < 32 || typeof headerValue !== 'string') return false;
  const expected = Buffer.from(`Bearer ${secret}`);
  const actual = Buffer.from(headerValue);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

function response(res, statusCode, body) {
  res.statusCode = statusCode;
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  return res.end(JSON.stringify(body));
}

function nextPage(linkHeader) {
  for (const item of String(linkHeader ?? '').split(',')) {
    const match = /^\s*<([^>]+)>\s*;\s*rel="next"\s*$/.exec(item);
    if (match) return match[1];
  }
  return null;
}

function deliveryTuple(delivery) {
  const at = Date.parse(String(delivery?.delivered_at ?? ''));
  const id = String(delivery?.id ?? '');
  if (!Number.isFinite(at) || !/^[1-9][0-9]*$/.test(id)) return null;
  return { at, id: BigInt(id) };
}

function tupleAfter(left, right) {
  if (!right) return true;
  if (left.at !== right.at) return left.at > right.at;
  return left.id > right.id;
}

function newestDelivery(left, right) {
  const a = deliveryTuple(left);
  const b = deliveryTuple(right);
  if (!a) return right;
  if (!b) return left;
  return tupleAfter(a, b) ? left : right;
}

function setRequestHeaders(jwt) {
  return {
    Authorization: `Bearer ${jwt}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': API_VERSION,
    'Content-Type': 'application/json',
  };
}

async function githubRequest({ url, method = 'GET', jwt, fetchImpl, body }) {
  const response = await fetchImpl(url, {
    method,
    headers: setRequestHeaders(jwt),
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(8_000),
  });
  if (!response.ok) {
    const error = new Error(`GitHub App webhook API request failed (${response.status}).`);
    error.status = response.status;
    error.retryAfter = response.headers?.get?.('retry-after') ?? null;
    throw error;
  }
  return response;
}

function configFrom(env) {
  return {
    cronSecret: env.CRON_SECRET,
    appId: env.AGENTIC_DELIVERY_APP_ID || env.CODEX_DELIVERY_APP_ID,
    privateKey: env.AGENTIC_DELIVERY_APP_PRIVATE_KEY || env.CODEX_DELIVERY_APP_PRIVATE_KEY,
    replayDatabaseUrl: env.AGENTIC_DELIVERY_REPLAY_DATABASE_URL,
  };
}

function withinCheckpoint(delivery, checkpoint) {
  const tuple = deliveryTuple(delivery);
  if (!tuple) return false;
  if (!checkpoint?.checkpoint_at || !checkpoint?.checkpoint_delivery_id) return true;
  const checkpointAt = Date.parse(checkpoint.checkpoint_at);
  if (!Number.isFinite(checkpointAt)) throw new Error('The stored webhook checkpoint is invalid.');
  return tupleAfter(tuple, { at: checkpointAt, id: BigInt(checkpoint.checkpoint_delivery_id) });
}

function replayKeyFromGuid(installationId, guid) {
  try { return replayKey({ installationId, deliveryId: guid }); }
  catch { return null; }
}

async function collectDeliveryAttempts({ checkpoint, jwt, fetchImpl }) {
  const grouped = new Map();
  let pageUrl = `https://api.github.com/app/hook/deliveries?per_page=${PAGE_SIZE}`;
  let highWater = null;
  let pages = 0;
  let reachedCheckpoint = false;

  while (pageUrl && pages < MAX_PAGES) {
    const parsedUrl = new URL(pageUrl);
    if (parsedUrl.origin !== 'https://api.github.com' || parsedUrl.pathname !== '/app/hook/deliveries') {
      throw new Error('GitHub returned an unexpected webhook pagination link.');
    }
    const pageResponse = await githubRequest({ url: pageUrl, jwt, fetchImpl });
    const items = await pageResponse.json();
    if (!Array.isArray(items)) throw new Error('GitHub returned an invalid webhook delivery page.');
    pages += 1;

    for (const item of items) {
      const tuple = deliveryTuple(item);
      if (!tuple) continue;
      if (!highWater || tupleAfter(tuple, highWater.tuple)) highWater = { tuple, deliveredAt: item.delivered_at, deliveryId: String(item.id) };
      if (withinCheckpoint(item, checkpoint)) {
        const guid = String(item.guid ?? '').toLowerCase();
        if (!/^[0-9a-f-]{20,}$/i.test(guid)) continue;
        const group = grouped.get(guid) ?? { guid, newest: item, hasSuccess: false, installations: new Set() };
        group.newest = newestDelivery(group.newest, item);
        group.hasSuccess ||= String(item.status ?? '').toUpperCase() === 'OK';
        if (/^[1-9][0-9]*$/.test(String(item.installation_id ?? ''))) group.installations.add(String(item.installation_id));
        grouped.set(guid, group);
      }
    }

    const olderThanCheckpoint = checkpoint?.checkpoint_at
      ? items.length > 0 && items.every((item) => !withinCheckpoint(item, checkpoint))
      : items.length > 0 && items.every((item) => !withinCheckpoint(item, null));
    if (olderThanCheckpoint || items.length === 0) {
      reachedCheckpoint = true;
      break;
    }
    pageUrl = nextPage(pageResponse.headers?.get?.('link'));
    if (!pageUrl) {
      reachedCheckpoint = true;
      break;
    }
  }

  if (!reachedCheckpoint) throw new Error('The webhook delivery scan exceeded its page limit; the checkpoint was not advanced.');
  return { grouped, highWater, pages };
}

async function requestRedelivery({ deliveryId, guid, jwt, fetchImpl, store }) {
  const claim = await store.claimRedeliveryRequest(guid, deliveryId, { cooldownMs: REDELIVERY_COOLDOWN_MS });
  if (!claim.claimed) {
    if (claim.status === 'accepted') return { requested: false, reason: 'cooldown' };
    if (claim.status === 'exhausted') return { requested: false, reason: 'exhausted' };
    throw new Error('A previous redelivery request has an uncertain outcome.');
  }
  try {
    await githubRequest({
      url: `https://api.github.com/app/hook/deliveries/${encodeURIComponent(String(deliveryId))}/attempts`,
      method: 'POST',
      jwt,
      fetchImpl,
    });
    await store.markRedeliveryAccepted(guid, deliveryId);
    return { requested: true };
  } catch (error) {
    if (error.status && error.status < 500 && error.status !== 408 && error.status !== 429) {
      await store.releaseRedeliveryRequest(guid);
    }
    throw error;
  }
}

export async function reconcileWebhookDeliveries({ req, res, env = process.env, fetchImpl = fetch, store, now = () => Date.now() }) {
  if (req.method !== 'GET') return response(res, 405, { error: 'GET is required.' });
  const config = configFrom(env);
  if (!bearerMatches(req.headers?.authorization ?? req.headers?.Authorization, config.cronSecret)) {
    return response(res, 401, { error: 'Unauthorized.' });
  }
  if (!/^[1-9][0-9]*$/.test(String(config.appId ?? '')) || !config.privateKey || !config.replayDatabaseUrl) {
    return response(res, 500, { error: 'The reconciler configuration is incomplete.' });
  }

  try {
    const activeStore = store ?? new NeonReplayStore({ connectionString: config.replayDatabaseUrl });
    const scanNow = now();
    const jwt = createGithubAppJwt({ appId: config.appId, privateKey: config.privateKey, now: scanNow });
    const checkpoint = await activeStore.reconcilerCheckpoint();
    const { grouped, highWater, pages } = await collectDeliveryAttempts({ checkpoint, jwt, fetchImpl });
    const dueReceipts = await activeStore.dueControllerReceipts({ limit: CONTROLLER_RECEIPT_LIMIT });
    const dueRedeliveries = await activeStore.dueRedeliveryRequests({ limit: CONTROLLER_RECEIPT_LIMIT });
    const dueByGuid = new Map();
    for (const receipt of dueReceipts) {
      const separator = String(receipt.replay_key).indexOf(':');
      if (separator < 1) continue;
      const guid = String(receipt.replay_key).slice(separator + 1).toLowerCase();
      dueByGuid.set(guid, receipt);
    }

    let requested = 0;
    let skippedCooldown = 0;
    let exhausted = 0;
    const candidates = new Map();
    for (const [guid, group] of grouped) {
      const dueReceipt = dueByGuid.get(guid);
      if (!group.hasSuccess || dueReceipt) candidates.set(guid, { group, dueReceipt });
      else await activeStore.completeRedelivery(guid);
    }
    for (const [guid, receipt] of dueByGuid) {
      if (!candidates.has(guid) && receipt.github_delivery_id) {
        candidates.set(guid, { group: { guid, newest: { id: String(receipt.github_delivery_id) }, installations: new Set() }, dueReceipt: receipt });
      }
    }
    for (const request of dueRedeliveries) {
      const guid = String(request.delivery_guid).toLowerCase();
      if (!candidates.has(guid)) {
        candidates.set(guid, {
          group: { guid, newest: { id: String(request.github_delivery_id) }, installations: new Set() },
          dueReceipt: null,
        });
      }
    }
    if (candidates.size > MAX_REDELIVERIES) throw new Error('The webhook reconciliation batch exceeded its safe redelivery limit.');

    for (const [guid, { group, dueReceipt }] of candidates) {
      const deliveryId = String(group.newest?.id ?? dueReceipt?.github_delivery_id ?? '');
      if (!/^[1-9][0-9]*$/.test(deliveryId)) continue;
      if (dueReceipt) {
        const installationId = [...group.installations][0] ?? String(dueReceipt.replay_key).split(':', 1)[0];
        const key = replayKeyFromGuid(installationId, guid);
        if (key) await activeStore.linkGithubDelivery(key, deliveryId);
      }
      const result = await requestRedelivery({ deliveryId, guid, jwt, fetchImpl, store: activeStore });
      if (result.requested) requested += 1;
      else skippedCooldown += 1;
      if (result.reason === 'exhausted') exhausted += 1;
    }

    if (highWater) {
      await activeStore.advanceReconcilerCheckpoint({ deliveredAt: highWater.deliveredAt, deliveryId: highWater.deliveryId });
    }
    return response(res, 200, { scanned_pages: pages, matched_deliveries: grouped.size, redelivery_requests: requested, cooldown_skips: skippedCooldown, exhausted_redeliveries: exhausted });
  } catch (error) {
    const status = !error.status || error.status === 429 || error.status >= 500 || error.status === 408 ? 503 : 502;
    return response(res, status, { error: 'Webhook delivery reconciliation failed; the checkpoint was not advanced.' });
  }
}

export default async function handler(req, res) {
  return reconcileWebhookDeliveries({ req, res });
}
