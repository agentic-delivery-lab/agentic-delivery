// agentic-primitive: {"id":"webhook-delivery-reconciler","kind":"validator","enforcement":"deterministic","adrs":["ADR-0018"],"domains":["agentic-delivery-control-plane"]}
import { timingSafeEqual } from 'node:crypto';

import { createGithubAppJwt } from '../../scripts/lib/github-app.mjs';
import { replayKey } from '../../scripts/lib/replay-protection.mjs';
import { NeonReplayStore, REDELIVERY_COOLDOWN_MS } from '../../scripts/lib/neon-replay-store.mjs';

const API_VERSION = '2026-03-10';
const PAGE_SIZE = 100;
const MAX_PAGES = 5;
const CONTROLLER_RECEIPT_LIMIT = 250;
const CHECKPOINT_OVERLAP_MS = 5 * 60 * 1000;

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

function logSafely(logger, level, event) {
  try {
    logger?.[level]?.(JSON.stringify(event));
  } catch {
    // Observability must not change reconciliation behavior.
  }
}

function nextPage(linkHeader) {
  for (const item of String(linkHeader ?? '').split(',')) {
    const match = /^\s*<([^>]+)>\s*;\s*rel="next"\s*$/.exec(item);
    if (match) return match[1];
  }
  return null;
}

function deliveryHistoryUrl(cursor = null) {
  const url = new URL('https://api.github.com/app/hook/deliveries');
  url.searchParams.set('per_page', String(PAGE_SIZE));
  if (cursor !== null) url.searchParams.set('cursor', cursor);
  return url.toString();
}

function cursorFromUrl(value) {
  const url = new URL(value);
  if (url.origin !== 'https://api.github.com' || url.pathname !== '/app/hook/deliveries') {
    throw new Error('GitHub returned an unexpected webhook pagination link.');
  }
  const cursor = url.searchParams.get('cursor');
  if (!cursor || cursor.length > 4096 || /[\u0000-\u001f\u007f]/.test(cursor)) {
    throw new Error('GitHub returned an invalid webhook pagination cursor.');
  }
  return cursor;
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

function retryAtFromHeaders(headers, now) {
  const retryAfter = headers?.get?.('retry-after');
  if (retryAfter !== null && retryAfter !== undefined && String(retryAfter).trim() !== '') {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds) && seconds >= 0) return new Date(now + seconds * 1_000).toISOString();
    const date = Date.parse(String(retryAfter));
    if (Number.isFinite(date)) return new Date(date).toISOString();
  }
  const reset = Number(headers?.get?.('x-ratelimit-reset'));
  return Number.isFinite(reset) && reset > 0 ? new Date(reset * 1_000).toISOString() : null;
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
    const remaining = response.headers?.get?.('x-ratelimit-remaining');
    let message = '';
    if (response.status === 403 || response.status === 429) {
      try {
        const payload = await response.json();
        message = String(payload?.message ?? '');
      } catch {
        // The status and rate-limit headers still classify an unreadable body.
      }
    }
    error.rateLimited = response.status === 429
      || (response.status === 403 && (
        error.retryAfter !== null
        || remaining === '0'
        || /(?:secondary|api) rate limit|rate limit exceeded/i.test(message)
      ));
    error.retryAt = error.rateLimited ? retryAtFromHeaders(response.headers, Date.now()) : null;
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
  return tuple.at >= checkpointAt - CHECKPOINT_OVERLAP_MS
    || tupleAfter(tuple, { at: checkpointAt, id: BigInt(checkpoint.checkpoint_delivery_id) });
}

function replayKeyFromGuid(installationId, guid) {
  try { return replayKey({ installationId, deliveryId: guid }); }
  catch { return null; }
}

function installationFromReplayKey(key) {
  const value = String(key ?? '');
  const separator = value.indexOf(':');
  return separator > 0 ? value.slice(0, separator) : '';
}

async function collectDeliveryAttempts({ checkpoint, scanCursor = null, jwt, fetchImpl }) {
  const grouped = new Map();
  let pageUrl = deliveryHistoryUrl(scanCursor);
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

  const nextCursor = reachedCheckpoint || !pageUrl ? null : cursorFromUrl(pageUrl);
  return { grouped, highWater, pages, nextCursor };
}

function observationsFromGroups(groups) {
  return [...groups.values()].map((group) => {
    const tuple = deliveryTuple(group.newest);
    if (!tuple) throw new Error('GitHub returned an invalid newest webhook delivery attempt.');
    const installations = [...group.installations];
    if (installations.length > 1) throw new Error('GitHub returned conflicting installation IDs for one delivery GUID.');
    return {
      guid: group.guid,
      deliveredAt: group.newest.delivered_at,
      deliveryId: String(group.newest.id),
      hasSuccess: group.hasSuccess,
      installationId: installations[0] ?? null,
    };
  });
}

function groupsFromObservations(observations) {
  return new Map(observations.map((observation) => {
    const guid = String(observation.delivery_guid ?? '').toLowerCase();
    return [guid, {
      guid,
      newest: {
        id: String(observation.newest_delivery_id),
        delivered_at: observation.newest_delivery_at,
      },
      hasSuccess: Boolean(observation.has_success),
      installations: new Set(observation.installation_id == null ? [] : [String(observation.installation_id)]),
    }];
  }));
}

async function requestRedelivery({ deliveryId, guid, jwt, fetchImpl, store, logger }) {
  const claim = await store.claimRedeliveryRequest(guid, deliveryId, { cooldownMs: REDELIVERY_COOLDOWN_MS });
  if (!claim.claimed) {
    if (claim.status === 'accepted') return { requested: false, reason: 'cooldown' };
    if (claim.status === 'exhausted') return { requested: false, reason: 'exhausted' };
    if (claim.status === 'requesting' || claim.status === 'queued') return { requested: false, reason: 'cooldown' };
    throw new Error('A previous redelivery request has an uncertain outcome.');
  }
  try {
    const result = await githubRequest({
      url: `https://api.github.com/app/hook/deliveries/${encodeURIComponent(String(deliveryId))}/attempts`,
      method: 'POST',
      jwt,
      fetchImpl,
    });
    await store.markRedeliveryAccepted(guid, deliveryId);
    logSafely(logger, 'info', {
      event: 'agentic_delivery_webhook_reconciler_redelivery',
      outcome: 'accepted',
      delivery_guid: guid,
      github_delivery_id: String(deliveryId),
      github_api_status: result.status,
    });
    return { requested: true };
  } catch (error) {
    if (error.rateLimited) {
      await store.deferRedeliveryRequest(guid, deliveryId, error.retryAt);
      logSafely(logger, 'warn', {
        event: 'agentic_delivery_webhook_reconciler_redelivery',
        outcome: 'deferred',
        delivery_guid: guid,
        github_delivery_id: String(deliveryId),
        github_api_status: Number.isInteger(error.status) ? error.status : null,
        rate_limited: true,
      });
      throw error;
    }
    if (error.status && error.status < 500 && error.status !== 408 && error.status !== 429) {
      await store.markRedeliveryRejected(guid, deliveryId);
      logSafely(logger, 'warn', {
        event: 'agentic_delivery_webhook_reconciler_redelivery',
        outcome: 'rejected',
        delivery_guid: guid,
        github_delivery_id: String(deliveryId),
        github_api_status: error.status,
        rate_limited: false,
      });
      return { requested: false, reason: 'exhausted' };
    }
    await store.deferRedeliveryRequest(guid, deliveryId);
    logSafely(logger, 'warn', {
      event: 'agentic_delivery_webhook_reconciler_redelivery',
      outcome: 'uncertain',
      delivery_guid: guid,
      github_delivery_id: String(deliveryId),
      github_api_status: Number.isInteger(error.status) ? error.status : null,
      rate_limited: false,
    });
    throw error;
  }
}

export async function reconcileWebhookDeliveries({ req, res, env = process.env, fetchImpl = fetch, store, logger, now = () => Date.now() }) {
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
    const scanCursor = checkpoint?.scan_cursor ?? null;
    const checkpointHighWater = scanCursor
      ? { deliveredAt: checkpoint.scan_high_water_at, deliveryId: String(checkpoint.scan_high_water_delivery_id ?? '') }
      : null;
    if (checkpointHighWater && (!Number.isFinite(Date.parse(String(checkpointHighWater.deliveredAt ?? ''))) || !/^[1-9][0-9]*$/.test(checkpointHighWater.deliveryId))) {
      throw new Error('The stored webhook scan high-water mark is invalid.');
    }
    const { grouped: segmentGroups, highWater, pages, nextCursor } = await collectDeliveryAttempts({ checkpoint, scanCursor, jwt, fetchImpl });
    const expectedCheckpoint = {
      expectedCursor: scanCursor,
      expectedCheckpointAt: checkpoint?.checkpoint_at ?? null,
      expectedCheckpointDeliveryId: checkpoint?.checkpoint_delivery_id ?? null,
    };
    await activeStore.mergeReconcilerObservations(observationsFromGroups(segmentGroups), expectedCheckpoint);
    const observedGroups = groupsFromObservations(await activeStore.reconcilerObservations());
    const grouped = nextCursor ? new Map() : observedGroups;
    const dueReceipts = await activeStore.dueControllerReceipts({ limit: CONTROLLER_RECEIPT_LIMIT });
    const dueByGuid = new Map();
    for (const receipt of dueReceipts) {
      const separator = String(receipt.replay_key).indexOf(':');
      if (separator < 1) continue;
      const guid = String(receipt.replay_key).slice(separator + 1).toLowerCase();
      dueByGuid.set(guid, receipt);
    }

    const receiptLinks = [];
    for (const [guid, group] of grouped) {
      const dueReceipt = dueByGuid.get(guid);
      const installations = [...group.installations];
      if (installations.length > 1) throw new Error('GitHub returned conflicting installation IDs for one delivery GUID.');
      const installationId = installations[0] ?? installationFromReplayKey(dueReceipt?.replay_key);
      const key = replayKeyFromGuid(installationId, guid);
      const deliveryId = String(group.newest?.id ?? '');
      if (key && /^[1-9][0-9]*$/.test(deliveryId)) receiptLinks.push({ replayKey: key, githubDeliveryId: deliveryId });
    }
    for (let offset = 0; offset < receiptLinks.length; offset += CONTROLLER_RECEIPT_LIMIT) {
      await activeStore.linkGithubDeliveries(receiptLinks.slice(offset, offset + CONTROLLER_RECEIPT_LIMIT));
    }

    const redeliveryQueue = new Map();
    if (!nextCursor) {
      for (const [guid, group] of grouped) {
        const dueReceipt = dueByGuid.get(guid);
        if (!group.hasSuccess || dueReceipt) {
          const deliveryId = String(group.newest?.id ?? dueReceipt?.github_delivery_id ?? '');
          if (/^[1-9][0-9]*$/.test(deliveryId)) redeliveryQueue.set(guid, { guid, githubDeliveryId: deliveryId });
        } else {
          await activeStore.completeRedelivery(guid);
        }
      }
    }
    for (const [guid, receipt] of dueByGuid) {
      const deliveryId = String(receipt.github_delivery_id ?? '');
      if (/^[1-9][0-9]*$/.test(deliveryId) && !redeliveryQueue.has(guid)) {
        redeliveryQueue.set(guid, { guid, githubDeliveryId: deliveryId });
      }
    }
    await activeStore.queueRedeliveryRequests([...redeliveryQueue.values()]);

    const dueRedeliveries = await activeStore.dueRedeliveryRequests({ limit: CONTROLLER_RECEIPT_LIMIT });
    let requested = 0;
    let skippedCooldown = 0;
    let exhausted = 0;
    for (const request of dueRedeliveries) {
      const guid = String(request.delivery_guid).toLowerCase();
      const deliveryId = String(request.github_delivery_id ?? '');
      if (!/^[1-9][0-9]*$/.test(deliveryId)) continue;
      const result = await requestRedelivery({ deliveryId, guid, jwt, fetchImpl, store: activeStore, logger });
      if (result.requested) requested += 1;
      else if (result.reason === 'exhausted') exhausted += 1;
      else skippedCooldown += 1;
    }

    exhausted += await activeStore.exhaustExpiredRedeliveryRequests();
    const redeliveryQueuePending = await activeStore.hasPendingRedeliveryRequests();
    const scanHighWater = checkpointHighWater ?? highWater;
    if (nextCursor) {
      if (!scanHighWater) throw new Error('The webhook scan cannot persist a cursor without a high-water mark.');
      await activeStore.saveReconcilerScan({
        cursor: nextCursor,
        highWaterAt: scanHighWater.deliveredAt,
        highWaterDeliveryId: scanHighWater.deliveryId,
        ...expectedCheckpoint,
      });
    } else if (scanHighWater && !redeliveryQueuePending) {
      await activeStore.advanceReconcilerCheckpoint({
        deliveredAt: scanHighWater.deliveredAt,
        deliveryId: scanHighWater.deliveryId,
        ...expectedCheckpoint,
      });
    }
    logSafely(logger, 'info', {
      event: 'agentic_delivery_webhook_reconciler_run',
      outcome: 'completed',
      http_status: 200,
      scanned_pages: pages,
      scan_continuation_pending: Boolean(nextCursor),
      redelivery_queue_pending: redeliveryQueuePending,
      matched_deliveries: observedGroups.size,
      accepted_redelivery_requests: requested,
      cooldown_skips: skippedCooldown,
      exhausted_redeliveries: exhausted,
    });
    return response(res, 200, { scanned_pages: pages, scan_continuation_pending: Boolean(nextCursor), redelivery_queue_pending: redeliveryQueuePending, matched_deliveries: observedGroups.size, redelivery_requests: requested, cooldown_skips: skippedCooldown, exhausted_redeliveries: exhausted });
  } catch (error) {
    const status = !error.status || error.rateLimited || error.status === 429 || error.status >= 500 || error.status === 408 ? 503 : 502;
    logSafely(logger, 'error', {
      event: 'agentic_delivery_webhook_reconciler_run',
      outcome: 'failed',
      http_status: status,
      github_api_status: Number.isInteger(error.status) ? error.status : null,
      rate_limited: Boolean(error.rateLimited),
      error_type: typeof error.name === 'string' ? error.name : 'Error',
    });
    return response(res, status, { error: 'Webhook delivery reconciliation failed; the checkpoint was not advanced.' });
  }
}

export default async function handler(req, res) {
  return reconcileWebhookDeliveries({ req, res, logger: console });
}
