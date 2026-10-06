import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { test } from 'node:test';

import { reconcileWebhookDeliveries } from '../../api/cron/reconcile-webhooks.mjs';
import { CONTROLLER_MAX_ATTEMPTS } from '../../scripts/lib/neon-replay-store.mjs';

const { privateKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  publicKeyEncoding: { type: 'spki', format: 'pem' },
});

const deliveryA = '12345678-1234-4234-8234-123456789012';
const deliveryB = '22345678-1234-4234-8234-123456789012';
const deliveryC = '32345678-1234-4234-8234-123456789012';

function response(status, body = [], headers = {}) {
  const values = new Map(Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value]));
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: { get(name) { return values.get(String(name).toLowerCase()) ?? null; } },
    async json() { return typeof body === 'string' ? JSON.parse(body) : body; },
    async text() { return typeof body === 'string' ? body : JSON.stringify(body); },
  };
}

function output() {
  return {
    statusCode: null,
    headers: {},
    body: null,
    setHeader(name, value) { this.headers[name] = value; },
    end(value) { this.body = value ?? null; },
  };
}

function makeStore({ checkpoint = null, dueReceipts = [], dueRedeliveries = [], requestStatus = 'claimed', observations = [] } = {}) {
  return {
    checkpoint,
    dueReceipts,
    dueRedeliveries,
    requested: [],
    linked: [],
    linkBatches: [],
    completed: [],
    advanced: [],
    scanProgress: [],
    observations: new Map(observations.map((value) => [value.delivery_guid, value])),
    redeliveryQueue: new Map(),
    queuedRedeliveries: [],
    async reconcilerCheckpoint() { return this.checkpoint; },
    async mergeReconcilerObservations(values, { refreshEqualTimestampDeliveryIds = false } = {}) {
      for (const value of values) {
        const existing = this.observations.get(value.guid);
        if (existing && existing.installation_id != null && value.installationId != null
          && String(existing.installation_id) !== String(value.installationId)) {
          throw new Error('conflicting installation IDs');
        }
        const sameTimestamp = existing
          && Date.parse(value.deliveredAt) === Date.parse(existing.newest_delivery_at);
        const newer = !existing
          || Date.parse(value.deliveredAt) > Date.parse(existing.newest_delivery_at)
          || (sameTimestamp && BigInt(value.deliveryId) > BigInt(existing.newest_delivery_id));
        const queued = this.redeliveryQueue.get(value.guid);
        const refreshEqualTimestampId = refreshEqualTimestampDeliveryIds && sameTimestamp
          && queued?.request_status === 'exhausted'
          && queued.github_delivery_id !== value.deliveryId
          && Number(queued.attempt_count ?? 0) < CONTROLLER_MAX_ATTEMPTS;
        this.observations.set(value.guid, {
          delivery_guid: value.guid,
          newest_delivery_at: newer || refreshEqualTimestampId ? value.deliveredAt : existing.newest_delivery_at,
          newest_delivery_id: newer || refreshEqualTimestampId ? value.deliveryId : existing.newest_delivery_id,
          has_success: Boolean(existing?.has_success || value.hasSuccess),
          installation_id: existing?.installation_id ?? value.installationId,
        });
        if (refreshEqualTimestampId) {
          queued.github_delivery_id = value.deliveryId;
          queued.request_status = 'queued';
        }
      }
    },
    async reconcilerObservations() { return [...this.observations.values()]; },
    async dueControllerReceipts() { return this.dueReceipts; },
    async queueRedeliveryRequests(requests) {
      this.queuedRedeliveries.push(...requests);
      for (const request of requests) {
        const existing = this.redeliveryQueue.get(request.guid);
        if (!existing) {
          this.redeliveryQueue.set(request.guid, {
            delivery_guid: request.guid,
            github_delivery_id: request.githubDeliveryId,
            attempt_count: 0,
            request_status: 'queued',
          });
        } else if (existing.request_status === 'queued') {
          existing.github_delivery_id = request.githubDeliveryId;
        } else if (existing.request_status === 'exhausted'
          && existing.github_delivery_id !== request.githubDeliveryId
          && Number(existing.attempt_count ?? 0) < CONTROLLER_MAX_ATTEMPTS) {
          existing.github_delivery_id = request.githubDeliveryId;
          existing.request_status = 'queued';
        }
      }
    },
    async dueRedeliveryRequests({ limit = 250, includeQueued = true } = {}) {
      const completed = new Set(this.completed);
      const queued = [...this.redeliveryQueue.values()]
        .filter((request) => ((includeQueued && request.request_status === 'queued') || request.due === true)
          && Number(request.attempt_count ?? 0) < CONTROLLER_MAX_ATTEMPTS);
      return [
        ...this.dueRedeliveries.filter((request) => !completed.has(request.delivery_guid)
          && Number(request.attempt_count ?? 0) < CONTROLLER_MAX_ATTEMPTS),
        ...queued,
      ].slice(0, limit);
    },
    async exhaustExpiredRedeliveryRequests() {
      let exhausted = 0;
      for (const request of this.redeliveryQueue.values()) {
        if (['requesting', 'accepted'].includes(request.request_status)
          && Number(request.attempt_count ?? 0) >= CONTROLLER_MAX_ATTEMPTS
          && request.due === true) {
          request.request_status = 'exhausted';
          request.due = false;
          exhausted += 1;
        }
      }
      return exhausted;
    },
    async hasPendingRedeliveryRequests() {
      return [...this.redeliveryQueue.values()].some((request) => ['queued', 'requesting', 'exhausted'].includes(request.request_status));
    },
    async linkGithubDeliveries(links) {
      this.linkBatches.push(links.length);
      this.linked.push(...links.map(({ replayKey, githubDeliveryId }) => ({ key: replayKey, id: githubDeliveryId })));
    },
    async claimRedeliveryRequest(guid, id) {
      this.requested.push({ guid, id });
      const queued = this.redeliveryQueue.get(guid);
      if (queued) {
        if (queued.request_status !== 'queued' && queued.due !== true) {
          this.requested.pop();
          return { claimed: false, status: queued.request_status };
        }
        queued.request_status = 'requesting';
        queued.attempt_count += 1;
        queued.due = false;
        return { claimed: true };
      }
      return requestStatus === 'claimed' ? { claimed: true } : { claimed: false, status: requestStatus };
    },
    async markRedeliveryAccepted(guid, id) {
      this.requested.at(-1).accepted = { guid, id };
      const queued = this.redeliveryQueue.get(guid);
      if (queued) queued.request_status = 'accepted';
    },
    async markRedeliveryRejected(guid, id) {
      this.requested.at(-1).rejected = { guid, id };
      const queued = this.redeliveryQueue.get(guid);
      if (queued) queued.request_status = 'exhausted';
    },
    async deferRedeliveryRequest(guid, id, retryAt) {
      this.requested.at(-1).deferred = { guid, id, retryAt };
      const queued = this.redeliveryQueue.get(guid);
      if (queued) {
        queued.request_status = 'requesting';
        queued.retry_at = retryAt;
      }
    },
    async completeRedelivery(guid) {
      this.completed.push(guid);
      this.redeliveryQueue.delete(guid);
    },
    async saveReconcilerScan(value) {
      this.scanProgress.push(value);
      this.checkpoint = {
        ...this.checkpoint,
        scan_cursor: value.cursor,
        scan_high_water_at: value.highWaterAt,
        scan_high_water_delivery_id: value.highWaterDeliveryId,
      };
    },
    async advanceReconcilerCheckpoint(value) {
      this.advanced.push(value);
      this.checkpoint = {
        ...this.checkpoint,
        checkpoint_at: value.deliveredAt,
        checkpoint_delivery_id: value.deliveryId,
        scan_cursor: null,
        scan_high_water_at: null,
        scan_high_water_delivery_id: null,
      };
      this.observations.clear();
    },
  };
}

function cronRequest() {
  return { method: 'GET', headers: { authorization: 'Bearer test-cron-secret-which-is-long-enough-123456' } };
}

function cronEnv() {
  return {
    CRON_SECRET: 'test-cron-secret-which-is-long-enough-123456',
    AGENTIC_DELIVERY_APP_ID: '123456',
    AGENTIC_DELIVERY_APP_PRIVATE_KEY: privateKey,
    AGENTIC_DELIVERY_REPLAY_DATABASE_URL: 'postgresql://test:secret@ep-test-pooler.us-east-1.aws.neon.tech/replay',
  };
}

test('reconciler paginates, groups attempts by GUID, redelivers failures and stale controller receipts', async () => {
  const scanNow = Date.now();
  const at = (minutesAgo) => new Date(scanNow - minutesAgo * 60_000).toISOString();
  const store = makeStore({
    dueReceipts: [{ replay_key: `163255060:${deliveryC}`, status: 'running', github_delivery_id: '99', attempt_count: 1 }],
  });
  const redeliveries = [];
  const urls = [];
  const logs = [];
  const logger = { info: (line) => logs.push(JSON.parse(line)) };
  const fetchImpl = async (url, options) => {
    urls.push(String(url));
    assert.match(options.headers.Authorization, /^Bearer [A-Za-z0-9_.-]+$/);
    assert.equal(options.headers['X-GitHub-Api-Version'], '2026-03-10');
    if (options.method === 'POST') {
      redeliveries.push(new URL(String(url)).pathname.split('/').at(-2));
      return response(202);
    }
    if (String(url).endsWith('/app/hook/deliveries?per_page=100')) {
      return response(200, [
        { id: 101, guid: deliveryA, delivered_at: at(10), status: 'FAIL', installation_id: '163255060' },
        { id: 100, guid: deliveryB, delivered_at: at(11), status: 'OK', installation_id: '163255060' },
        { id: 99, guid: deliveryC, delivered_at: at(12), status: 'OK', installation_id: '163255060' },
      ], { link: '<https://api.github.com/app/hook/deliveries?per_page=100&cursor=page-2>; rel="next"' });
    }
    if (String(url).includes('cursor=page-2')) {
      return response(200, [
        { id: 98, guid: deliveryA, delivered_at: at(13), status: 'FAIL', installation_id: '163255060' },
        { id: 90, guid: deliveryB, delivered_at: at(30 * 60), status: 'OK', installation_id: '163255060' },
      ]);
    }
    throw new Error(`Unexpected URL ${url}`);
  };
  const res = output();
  await reconcileWebhookDeliveries({ req: cronRequest(), res, env: cronEnv(), fetchImpl, store, logger, now: () => scanNow });

  assert.equal(res.statusCode, 200);
  assert.deepEqual(redeliveries.sort(), ['101', '99']);
  assert.equal(store.advanced.length, 1);
  assert.equal(store.advanced[0].deliveryId, '101');
  assert.ok(store.linked.some((link) => link.key === `163255060:${deliveryC}` && link.id === '99'));
  assert.equal(JSON.parse(res.body).scanned_pages, 2);
  assert.deepEqual(logs.filter((entry) => entry.outcome === 'accepted').map((entry) => ({
    delivery_guid: entry.delivery_guid,
    github_delivery_id: entry.github_delivery_id,
    github_api_status: entry.github_api_status,
  })), [
    { delivery_guid: deliveryA, github_delivery_id: '101', github_api_status: 202 },
    { delivery_guid: deliveryC, github_delivery_id: '99', github_api_status: 202 },
  ]);
  assert.deepEqual(logs.at(-1), {
    event: 'agentic_delivery_webhook_reconciler_run',
    outcome: 'completed',
    http_status: 200,
    scanned_pages: 2,
    scan_continuation_pending: false,
    redelivery_queue_pending: false,
    matched_deliveries: 3,
    accepted_redelivery_requests: 2,
    cooldown_skips: 0,
    exhausted_redeliveries: 0,
  });
});

test('reconciler preserves exact large delivery IDs and refreshes exhausted rows from the full-history source', async () => {
  const scanNow = Date.now();
  const deliveredAt = new Date(scanNow - 5_000).toISOString();
  const exactDeliveryId = '3846548579682426877';
  const roundedDeliveryId = String(Number(exactDeliveryId));
  assert.notEqual(roundedDeliveryId, exactDeliveryId);
  assert.ok(BigInt(roundedDeliveryId) > BigInt(exactDeliveryId));
  const store = makeStore({
    observations: [{
      delivery_guid: deliveryA,
      newest_delivery_at: deliveredAt,
      newest_delivery_id: roundedDeliveryId,
      has_success: false,
      installation_id: '163255060',
    }],
  });
  store.redeliveryQueue.set(deliveryA, {
    delivery_guid: deliveryA,
    github_delivery_id: roundedDeliveryId,
    attempt_count: 1,
    request_status: 'exhausted',
  });
  const postUrls = [];
  const fetchImpl = async (url, options) => {
    if (options.method === 'POST') {
      postUrls.push(String(url));
      return response(202);
    }
    return response(200, `[{
      "id":${exactDeliveryId},
      "guid":"${deliveryA}",
      "delivered_at":"${deliveredAt}",
      "status":"FAIL",
      "installation_id":163255060
    }]`);
  };
  const res = output();

  await reconcileWebhookDeliveries({ req: cronRequest(), res, env: cronEnv(), fetchImpl, store, now: () => scanNow });

  assert.equal(res.statusCode, 200);
  assert.deepEqual(postUrls, [`https://api.github.com/app/hook/deliveries/${exactDeliveryId}/attempts`]);
  assert.deepEqual(store.requested.map(({ id }) => id), [exactDeliveryId]);
  assert.equal(store.redeliveryQueue.get(deliveryA).request_status, 'accepted');
  assert.equal(store.advanced.length, 1);
});

test('reconciler repairs an exhausted ID on a resumed page and preserves it through later pages', async () => {
  const scanNow = Date.now();
  const deliveredAt = new Date(scanNow - 120_000).toISOString();
  const checkpoint = {
    checkpoint_at: new Date(scanNow - 60 * 60_000).toISOString(),
    checkpoint_delivery_id: '1000',
    scan_cursor: 'page-6',
    scan_high_water_at: new Date(scanNow - 60_000).toISOString(),
    scan_high_water_delivery_id: '50000',
  };
  const exactDeliveryId = '3846548579682426877';
  const olderAttemptId = '3846548579682426876';
  const roundedDeliveryId = String(Number(exactDeliveryId));
  const store = makeStore({
    checkpoint,
    observations: [{
      delivery_guid: deliveryA,
      newest_delivery_at: deliveredAt,
      newest_delivery_id: roundedDeliveryId,
      has_success: false,
      installation_id: '163255060',
    }],
  });
  store.redeliveryQueue.set(deliveryA, {
    delivery_guid: deliveryA,
    github_delivery_id: roundedDeliveryId,
    attempt_count: 1,
    request_status: 'exhausted',
  });
  const postUrls = [];
  const pageFetch = (firstPage, lastPage, primaryDeliveryId) => async (url, options) => {
    if (options.method === 'POST') {
      postUrls.push(String(url));
      return response(202);
    }
    const page = Number(new URL(String(url)).searchParams.get('cursor').replace('page-', ''));
    assert.ok(page >= firstPage && page <= lastPage);
    const other = {
      id: 30_000 - page,
      guid: deliveryB,
      delivered_at: new Date(scanNow - (page * 1_000)).toISOString(),
      status: 'OK',
      installation_id: 163255060,
    };
    const event = page === firstPage
      ? `{"id":${primaryDeliveryId},"guid":"${deliveryA}","delivered_at":"${deliveredAt}","status":"FAIL","installation_id":163255060}`
      : null;
    const body = event ? `[${event},${JSON.stringify(other)}]` : JSON.stringify([other]);
    const headers = page < lastPage
      ? { link: `<https://api.github.com/app/hook/deliveries?per_page=100&cursor=page-${page + 1}>; rel="next"` }
      : (lastPage === 10
        ? { link: '<https://api.github.com/app/hook/deliveries?per_page=100&cursor=page-11>; rel="next"' }
        : {});
    return response(200, body, headers);
  };

  const firstRes = output();
  await reconcileWebhookDeliveries({
    req: cronRequest(),
    res: firstRes,
    env: cronEnv(),
    fetchImpl: pageFetch(6, 10, exactDeliveryId),
    store,
    now: () => scanNow,
  });

  assert.equal(firstRes.statusCode, 200);
  assert.equal(JSON.parse(firstRes.body).scan_continuation_pending, true);
  assert.equal(store.checkpoint.scan_cursor, 'page-11');
  assert.equal(store.observations.get(deliveryA).newest_delivery_id, exactDeliveryId);
  assert.equal(store.redeliveryQueue.get(deliveryA).request_status, 'queued');
  assert.equal(store.redeliveryQueue.get(deliveryA).github_delivery_id, exactDeliveryId);
  assert.deepEqual(postUrls, [], 'the repaired queued request waits for complete history');

  const secondRes = output();
  await reconcileWebhookDeliveries({
    req: cronRequest(),
    res: secondRes,
    env: cronEnv(),
    fetchImpl: pageFetch(11, 15, olderAttemptId),
    store,
    now: () => scanNow + 60_000,
  });

  assert.equal(secondRes.statusCode, 200);
  assert.equal(JSON.parse(secondRes.body).scan_continuation_pending, false);
  assert.deepEqual(postUrls, [`https://api.github.com/app/hook/deliveries/${exactDeliveryId}/attempts`]);
  assert.equal(store.requested.at(-1).id, exactDeliveryId);
});

test('reconciler preserves an accepted GitHub outcome when its state write and recovery both fail', async () => {
  const scanNow = Date.now();
  const store = makeStore();
  store.markRedeliveryAccepted = async () => { throw new Error('private database detail'); };
  store.deferRedeliveryRequest = async () => { throw new Error('private recovery detail'); };
  const fetchImpl = async (_url, options) => options.method === 'POST'
    ? response(202)
    : response(200, [{
      id: 206,
      guid: deliveryA,
      delivered_at: new Date(scanNow - 5_000).toISOString(),
      status: 'FAIL',
      installation_id: '163255060',
    }]);
  const res = output();
  const logs = [];
  const logger = {
    info: (line) => logs.push(JSON.parse(line)),
    warn: (line) => logs.push(JSON.parse(line)),
    error: (line) => logs.push(JSON.parse(line)),
  };

  await reconcileWebhookDeliveries({ req: cronRequest(), res, env: cronEnv(), fetchImpl, store, logger, now: () => scanNow });

  assert.equal(res.statusCode, 503);
  assert.deepEqual(store.advanced, []);
  assert.deepEqual(logs, [{
    event: 'agentic_delivery_webhook_reconciler_redelivery',
    outcome: 'accepted_not_recorded',
    delivery_guid: deliveryA,
    github_delivery_id: '206',
    github_api_status: 202,
    recovery_status: 'failed',
    storage_error_type: 'Error',
    recovery_error_type: 'Error',
    rate_limited: false,
  }, {
    event: 'agentic_delivery_webhook_reconciler_run',
    outcome: 'failed',
    http_status: 503,
    github_api_status: 202,
    rate_limited: false,
    error_type: 'Error',
  }]);
  assert.doesNotMatch(JSON.stringify(logs), /private database detail|private recovery detail/);
});

test('reconciler reports when it defers an accepted GitHub outcome after its state write fails', async () => {
  const scanNow = Date.now();
  const store = makeStore();
  store.markRedeliveryAccepted = async () => { throw new Error('database write failed'); };
  const fetchImpl = async (_url, options) => options.method === 'POST'
    ? response(202)
    : response(200, [{
      id: 207,
      guid: deliveryA,
      delivered_at: new Date(scanNow - 5_000).toISOString(),
      status: 'FAIL',
      installation_id: '163255060',
    }]);
  const res = output();
  const logs = [];
  const logger = { error: (line) => logs.push(JSON.parse(line)) };

  await reconcileWebhookDeliveries({ req: cronRequest(), res, env: cronEnv(), fetchImpl, store, logger, now: () => scanNow });

  assert.equal(res.statusCode, 503);
  assert.equal(store.requested[0].deferred.guid, deliveryA);
  assert.equal(store.requested[0].deferred.id, '207');
  assert.equal(store.advanced.length, 0);
  assert.deepEqual(logs, [{
    event: 'agentic_delivery_webhook_reconciler_redelivery',
    outcome: 'accepted_not_recorded',
    delivery_guid: deliveryA,
    github_delivery_id: '207',
    github_api_status: 202,
    recovery_status: 'deferred',
    storage_error_type: 'Error',
    rate_limited: false,
  }, {
    event: 'agentic_delivery_webhook_reconciler_run',
    outcome: 'failed',
    http_status: 503,
    github_api_status: 202,
    rate_limited: false,
    error_type: 'Error',
  }]);
});

test('reconciler leaves its checkpoint unchanged and records a cooldown when GitHub rate limits redelivery', async () => {
  const scanNow = Date.now();
  const store = makeStore();
  const fetchImpl = async (url, options) => {
    if (options.method === 'POST') return response(429, [], { 'retry-after': '60' });
    return response(200, [{ id: 201, guid: deliveryA, delivered_at: new Date(scanNow - 5_000).toISOString(), status: 'FAIL', installation_id: '163255060' }]);
  };
  const res = output();
  const logs = [];
  const logger = {
    info: (line) => logs.push(JSON.parse(line)),
    warn: (line) => logs.push(JSON.parse(line)),
    error: (line) => logs.push(JSON.parse(line)),
  };
  await reconcileWebhookDeliveries({ req: cronRequest(), res, env: cronEnv(), fetchImpl, store, logger, now: () => scanNow });

  assert.equal(res.statusCode, 503);
  assert.deepEqual(store.advanced, []);
  assert.equal(store.requested.length, 1);
  assert.equal(store.requested[0].deferred.guid, deliveryA);
  assert.equal(store.requested[0].deferred.id, '201');
  assert.ok(Number.isFinite(Date.parse(store.requested[0].deferred.retryAt)));
  assert.deepEqual(logs, [{
    event: 'agentic_delivery_webhook_reconciler_redelivery',
    outcome: 'deferred',
    delivery_guid: deliveryA,
    github_delivery_id: '201',
    github_api_status: 429,
    rate_limited: true,
  }, {
    event: 'agentic_delivery_webhook_reconciler_run',
    outcome: 'failed',
    http_status: 503,
    github_api_status: 429,
    rate_limited: true,
    error_type: 'Error',
  }]);
});

test('reconciler holds the checkpoint after a definitive rejection until an accepted manual retry', async () => {
  const scanNow = Date.now();
  const store = makeStore();
  let rejectRedelivery = true;
  const fetchImpl = async (url, options) => {
    if (options.method === 'POST') return rejectRedelivery ? response(404) : response(202);
    return response(200, [{
      id: 202,
      guid: deliveryA,
      delivered_at: new Date(scanNow - 5_000).toISOString(),
      status: 'FAIL',
      installation_id: '163255060',
    }]);
  };
  const res = output();

  await reconcileWebhookDeliveries({ req: cronRequest(), res, env: cronEnv(), fetchImpl, store, now: () => scanNow });

  assert.equal(res.statusCode, 200);
  assert.deepEqual(store.requested, [{ guid: deliveryA, id: '202', rejected: { guid: deliveryA, id: '202' } }]);
  assert.equal(store.advanced.length, 0);
  assert.equal(JSON.parse(res.body).exhausted_redeliveries, 1);
  assert.equal(JSON.parse(res.body).redelivery_queue_pending, true);
  assert.equal(JSON.parse(res.body).cooldown_skips, 0);

  const exhaustedRequest = store.redeliveryQueue.get(deliveryA);
  assert.equal(exhaustedRequest.request_status, 'exhausted');
  assert.equal(await store.hasPendingRedeliveryRequests(), true);

  exhaustedRequest.request_status = 'queued';
  exhaustedRequest.attempt_count = 0;
  rejectRedelivery = false;
  const retryRes = output();
  await reconcileWebhookDeliveries({ req: cronRequest(), res: retryRes, env: cronEnv(), fetchImpl, store, now: () => scanNow + 60_000 });

  assert.equal(retryRes.statusCode, 200);
  assert.deepEqual(store.requested[1].accepted, { guid: deliveryA, id: '202' });
  assert.equal(store.redeliveryQueue.get(deliveryA).request_status, 'accepted');
  assert.equal(JSON.parse(retryRes.body).redelivery_queue_pending, false);
  assert.equal(store.advanced.length, 1);
});

test('reconciler defers a rate-limited GitHub 403 until Retry-After', async () => {
  const scanNow = Date.now();
  const store = makeStore();
  const fetchImpl = async (url, options) => {
    if (options.method === 'POST') {
      return response(403, { message: 'You have exceeded a secondary rate limit.' }, { 'retry-after': '3600' });
    }
    return response(200, [{
      id: 203,
      guid: deliveryA,
      delivered_at: new Date(scanNow - 5_000).toISOString(),
      status: 'FAIL',
      installation_id: '163255060',
    }]);
  };
  const res = output();

  await reconcileWebhookDeliveries({ req: cronRequest(), res, env: cronEnv(), fetchImpl, store, now: () => scanNow });

  assert.equal(res.statusCode, 503);
  assert.deepEqual(store.advanced, []);
  assert.equal(store.requested[0].rejected, undefined);
  assert.equal(store.requested[0].deferred.guid, deliveryA);
  assert.ok(Date.parse(store.requested[0].deferred.retryAt) >= scanNow + 3_600_000);
});

test('reconciler retries an ambiguous network failure from durable requesting state', async () => {
  const scanNow = Date.now();
  const store = makeStore();
  let attempts = 0;
  const fetchImpl = async (url, options) => {
    if (options.method === 'POST') {
      attempts += 1;
      if (attempts === 1) throw new Error('connection lost after request dispatch');
      return response(202);
    }
    return response(200, [{
      id: 205,
      guid: deliveryA,
      delivered_at: new Date(scanNow - 5_000).toISOString(),
      status: 'FAIL',
      installation_id: '163255060',
    }]);
  };
  const firstRes = output();

  await reconcileWebhookDeliveries({ req: cronRequest(), res: firstRes, env: cronEnv(), fetchImpl, store, now: () => scanNow });

  assert.equal(firstRes.statusCode, 503);
  assert.equal(store.advanced.length, 0);
  assert.equal(store.redeliveryQueue.get(deliveryA).request_status, 'requesting');
  assert.equal(await store.hasPendingRedeliveryRequests(), true);

  store.redeliveryQueue.get(deliveryA).due = true;
  const secondRes = output();
  await reconcileWebhookDeliveries({ req: cronRequest(), res: secondRes, env: cronEnv(), fetchImpl, store, now: () => scanNow + 24 * 60 * 60 * 1_000 });

  assert.equal(secondRes.statusCode, 200);
  assert.equal(attempts, 2);
  assert.equal(store.redeliveryQueue.get(deliveryA).request_status, 'accepted');
  assert.equal(store.advanced.length, 1);
});

test('reconciler holds the checkpoint when an authorization 403 exhausts a redelivery', async () => {
  const scanNow = Date.now();
  const store = makeStore();
  const fetchImpl = async (url, options) => {
    if (options.method === 'POST') return response(403, { message: 'Resource not accessible by integration.' });
    return response(200, [{
      id: 204,
      guid: deliveryA,
      delivered_at: new Date(scanNow - 5_000).toISOString(),
      status: 'FAIL',
      installation_id: '163255060',
    }]);
  };
  const res = output();
  const logs = [];
  const logger = {
    info: (line) => logs.push(JSON.parse(line)),
    warn: (line) => logs.push(JSON.parse(line)),
    error: (line) => logs.push(JSON.parse(line)),
  };

  await reconcileWebhookDeliveries({ req: cronRequest(), res, env: cronEnv(), fetchImpl, store, logger, now: () => scanNow });

  assert.equal(res.statusCode, 200);
  assert.deepEqual(store.requested[0].rejected, { guid: deliveryA, id: '204' });
  assert.equal(store.requested[0].deferred, undefined);
  assert.equal(store.redeliveryQueue.get(deliveryA).request_status, 'exhausted');
  assert.equal(await store.hasPendingRedeliveryRequests(), true);
  assert.equal(store.advanced.length, 0);
  assert.deepEqual(logs, [{
    event: 'agentic_delivery_webhook_reconciler_redelivery',
    outcome: 'rejected',
    delivery_guid: deliveryA,
    github_delivery_id: '204',
    github_api_status: 403,
    rate_limited: false,
  }, {
    event: 'agentic_delivery_webhook_reconciler_run',
    outcome: 'completed',
    http_status: 200,
    scanned_pages: 1,
    scan_continuation_pending: false,
    redelivery_queue_pending: true,
    matched_deliveries: 1,
    accepted_redelivery_requests: 0,
    cooldown_skips: 0,
    exhausted_redeliveries: 1,
  }]);
});

test('reconciler reports and holds an expired accepted final attempt when history still has no success', async () => {
  const scanNow = Date.now();
  const store = makeStore();
  store.redeliveryQueue.set(deliveryA, {
    guid: deliveryA,
    githubDeliveryId: '204',
    attempt_count: CONTROLLER_MAX_ATTEMPTS,
    request_status: 'accepted',
    due: true,
  });
  const fetchImpl = async (url, options) => {
    assert.notEqual(options.method, 'POST', 'the final accepted attempt must not exceed the retry limit');
    return response(200, [{
      id: 205,
      guid: deliveryA,
      delivered_at: new Date(scanNow - 5_000).toISOString(),
      status: 'FAIL',
      installation_id: '163255060',
    }]);
  };
  const res = output();

  await reconcileWebhookDeliveries({ req: cronRequest(), res, env: cronEnv(), fetchImpl, store, now: () => scanNow });

  assert.equal(res.statusCode, 200);
  assert.equal(store.redeliveryQueue.get(deliveryA).request_status, 'exhausted');
  assert.equal(JSON.parse(res.body).exhausted_redeliveries, 1);
  assert.equal(JSON.parse(res.body).redelivery_queue_pending, true);
  assert.equal(store.advanced.length, 0);
});

test('reconciler overlaps the prior checkpoint to find late delivery-history entries', async () => {
  const scanNow = Date.now();
  const checkpointAt = new Date(scanNow - 60_000).toISOString();
  const store = makeStore({ checkpoint: { checkpoint_at: checkpointAt, checkpoint_delivery_id: '999' } });
  const posts = [];
  const fetchImpl = async (url, options) => {
    if (options.method === 'POST') {
      posts.push(String(url));
      return response(202);
    }
    return response(200, [{
      id: 998,
      guid: deliveryA,
      delivered_at: new Date(scanNow - 120_000).toISOString(),
      status: 'FAIL',
      installation_id: '163255060',
    }]);
  };
  const res = output();

  await reconcileWebhookDeliveries({ req: cronRequest(), res, env: cronEnv(), fetchImpl, store, now: () => scanNow });

  assert.equal(res.statusCode, 200);
  assert.equal(posts.length, 1);
  assert.match(posts[0], /\/998\/attempts$/);
});

test('reconciler does not re-request a due redelivery after successful history resolves its GUID', async () => {
  const scanNow = Date.now();
  const store = makeStore({
    dueRedeliveries: [{ delivery_guid: deliveryA, github_delivery_id: '201', attempt_count: 1 }],
  });
  const fetchImpl = async (url, options) => {
    if (options.method === 'POST') throw new Error('resolved delivery must not be redelivered again');
    return response(200, [{
      id: 202,
      guid: deliveryA,
      delivered_at: new Date(scanNow - 5_000).toISOString(),
      status: 'OK',
      installation_id: '163255060',
    }]);
  };
  const res = output();

  await reconcileWebhookDeliveries({ req: cronRequest(), res, env: cronEnv(), fetchImpl, store, now: () => scanNow });

  assert.equal(res.statusCode, 200);
  assert.deepEqual(store.completed, [deliveryA]);
  assert.deepEqual(store.requested, []);
  assert.equal(store.advanced.length, 1);
});

test('reconciler links failed webhook history to a pending receipt before checkpointing, even when it is not due', async () => {
  const scanNow = Date.now();
  const guid = deliveryA;
  const pendingReceipt = { replay_key: `163255060:${guid}`, status: 'pending', github_delivery_id: null, attempt_count: 0 };
  const store = makeStore();
  let checkpoint = null;
  let dueReceipts = [];
  const posts = [];
  store.reconcilerCheckpoint = async () => checkpoint;
  store.dueControllerReceipts = async () => dueReceipts;
  store.linkGithubDeliveries = async (links) => {
    store.linked.push(...links.map(({ replayKey, githubDeliveryId }) => ({ key: replayKey, id: githubDeliveryId })));
    for (const link of links) {
      if (link.replayKey === pendingReceipt.replay_key) pendingReceipt.github_delivery_id = link.githubDeliveryId;
    }
  };
  store.advanceReconcilerCheckpoint = async (value) => {
    assert.equal(pendingReceipt.github_delivery_id, '301');
    store.advanced.push(value);
    checkpoint = { checkpoint_at: value.deliveredAt, checkpoint_delivery_id: value.deliveryId };
  };
  const deliveredAt = new Date(scanNow - 60_000).toISOString();
  let historyPage = 0;
  const fetchImpl = async (url, options) => {
    if (options.method === 'POST') {
      posts.push(String(url));
      return response(202);
    }
    const status = historyPage++ === 0 ? 'FAIL' : 'OK';
    return response(200, [{ id: 301, guid, delivered_at: deliveredAt, status, installation_id: '163255060' }]);
  };
  const firstRes = output();
  await reconcileWebhookDeliveries({ req: cronRequest(), res: firstRes, env: cronEnv(), fetchImpl, store, now: () => scanNow });

  assert.equal(firstRes.statusCode, 200);
  assert.deepEqual(store.linked[0], { key: pendingReceipt.replay_key, id: '301' });
  assert.deepEqual(posts, ['https://api.github.com/app/hook/deliveries/301/attempts']);
  assert.equal(checkpoint.checkpoint_delivery_id, '301');

  dueReceipts = [pendingReceipt];
  store.redeliveryQueue.get(guid).due = true;
  const secondRes = output();
  await reconcileWebhookDeliveries({ req: cronRequest(), res: secondRes, env: cronEnv(), fetchImpl, store, now: () => scanNow + 24 * 60 * 60 * 1000 });

  assert.equal(secondRes.statusCode, 200);
  assert.deepEqual(posts, [
    'https://api.github.com/app/hook/deliveries/301/attempts',
    'https://api.github.com/app/hook/deliveries/301/attempts',
  ]);
});

test('reconciler resumes due redeliveries beyond its delivery-history checkpoint', async () => {
  const scanNow = Date.now();
  const guid = '42345678-1234-4234-8234-123456789012';
  const store = makeStore({
    checkpoint: { checkpoint_at: new Date(scanNow - 48 * 60 * 60 * 1000).toISOString(), checkpoint_delivery_id: '50' },
    dueRedeliveries: [{ delivery_guid: guid, github_delivery_id: '42', attempt_count: 1 }],
  });
  const posts = [];
  const fetchImpl = async (url, options) => {
    if (options.method === 'POST') {
      posts.push(String(url));
      return response(202);
    }
    return response(200, [{ id: 42, guid, delivered_at: new Date(scanNow - 72 * 60 * 60 * 1000).toISOString(), status: 'FAIL', installation_id: '163255060' }]);
  };
  const res = output();
  await reconcileWebhookDeliveries({ req: cronRequest(), res, env: cronEnv(), fetchImpl, store, now: () => scanNow });

  assert.equal(res.statusCode, 200);
  assert.equal(posts.length, 1);
  assert.match(posts[0], /\/42\/attempts$/);
});

test('reconciler retries an ambiguous requesting record after it becomes due', async () => {
  const scanNow = Date.now();
  const guid = '42345678-1234-4234-8234-123456789012';
  const store = makeStore({
    checkpoint: { checkpoint_at: new Date(scanNow - 48 * 60 * 60 * 1000).toISOString(), checkpoint_delivery_id: '50' },
    dueRedeliveries: [{ delivery_guid: guid, github_delivery_id: '42', attempt_count: 1, request_status: 'requesting' }],
  });
  const posts = [];
  const fetchImpl = async (url, options) => {
    if (options.method === 'POST') {
      posts.push(String(url));
      return response(202);
    }
    return response(200, [{
      id: 42,
      guid,
      delivered_at: new Date(scanNow - 72 * 60 * 60 * 1000).toISOString(),
      status: 'FAIL',
      installation_id: '163255060',
    }]);
  };
  const res = output();

  await reconcileWebhookDeliveries({ req: cronRequest(), res, env: cronEnv(), fetchImpl, store, now: () => scanNow });

  assert.equal(res.statusCode, 200);
  assert.deepEqual(posts, ['https://api.github.com/app/hook/deliveries/42/attempts']);
});

test('reconciler queues large failed-history scans and drains them in bounded batches', async () => {
  const scanNow = Date.now();
  const observations = Array.from({ length: 1_001 }, (_, index) => ({
    delivery_guid: `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
    newest_delivery_at: new Date(scanNow - 10 * 60_000).toISOString(),
    newest_delivery_id: String(index + 1),
    has_success: false,
    installation_id: '163255060',
  }));
  const store = makeStore({ observations });
  const fetchImpl = async (url, options) => {
    if (options.method === 'POST') return response(202);
    return response(200, [{
      id: 2_000,
      guid: deliveryB,
      delivered_at: new Date(scanNow - 5_000).toISOString(),
      status: 'FAIL',
      installation_id: '163255060',
    }]);
  };

  const firstRes = output();
  await reconcileWebhookDeliveries({ req: cronRequest(), res: firstRes, env: cronEnv(), fetchImpl, store, now: () => scanNow });

  assert.equal(firstRes.statusCode, 200);
  assert.equal(store.redeliveryQueue.size, 1_002);
  assert.equal(store.requested.length, 250);
  assert.equal(store.advanced.length, 0);
  assert.equal(store.linked.length, 1_002);
  assert.ok(Math.max(...store.linkBatches) <= 250);
  assert.equal([...store.redeliveryQueue.values()].filter((request) => request.request_status === 'queued').length, 752);
  assert.equal(JSON.parse(firstRes.body).redelivery_queue_pending, true);

  for (const [batch, remaining] of [[2, 502], [3, 252], [4, 2]]) {
    const nextRes = output();
    await reconcileWebhookDeliveries({ req: cronRequest(), res: nextRes, env: cronEnv(), fetchImpl, store, now: () => scanNow + (batch * 60_000) });
    assert.equal(nextRes.statusCode, 200);
    assert.equal(store.requested.length, batch * 250);
    assert.equal([...store.redeliveryQueue.values()].filter((request) => request.request_status === 'queued').length, remaining);
    assert.equal(store.advanced.length, 0);
  }

  const finalRes = output();
  await reconcileWebhookDeliveries({ req: cronRequest(), res: finalRes, env: cronEnv(), fetchImpl, store, now: () => scanNow + 5 * 60_000 });

  assert.equal(finalRes.statusCode, 200);
  assert.equal(store.requested.length, 1_002);
  assert.equal([...store.redeliveryQueue.values()].filter((request) => request.request_status === 'queued').length, 0);
  assert.equal(store.advanced.length, 1);
  assert.equal(JSON.parse(finalRes.body).redelivery_queue_pending, false);
});

test('reconciler resumes a page-limited history scan from its persisted cursor', async () => {
  const scanNow = Date.now();
  const guid = deliveryA;
  const store = makeStore();
  const firstFetch = async (url, options) => {
    assert.equal(options.method, 'GET');
    const cursor = new URL(String(url)).searchParams.get('cursor');
    const page = cursor ? Number(cursor.replace('page-', '')) : 1;
    assert.ok(page >= 1 && page <= 5);
    const items = Array.from({ length: 100 }, (_, index) => {
      const offset = ((page - 1) * 100) + index;
      return {
        id: String(20_000 - offset),
        guid: offset === 499 ? guid : deliveryB,
        delivered_at: new Date(scanNow - (offset * 1_000)).toISOString(),
        status: offset === 499 ? 'FAIL' : 'OK',
      };
    });
    const headers = page < 6
      ? { link: `<https://api.github.com/app/hook/deliveries?per_page=100&cursor=page-${page + 1}>; rel="next"` }
      : {};
    return response(200, items, headers);
  };
  const firstRes = output();
  await reconcileWebhookDeliveries({ req: cronRequest(), res: firstRes, env: cronEnv(), fetchImpl: firstFetch, store, now: () => scanNow });

  assert.equal(firstRes.statusCode, 200);
  assert.equal(JSON.parse(firstRes.body).scanned_pages, 5);
  assert.equal(JSON.parse(firstRes.body).scan_continuation_pending, true);
  assert.equal(JSON.parse(firstRes.body).matched_deliveries, 2);
  assert.equal(store.scanProgress.length, 1);
  assert.equal(store.scanProgress[0].cursor, 'page-6');
  assert.equal(store.scanProgress[0].highWaterDeliveryId, '20000');
  assert.equal(store.observations.get(guid).has_success, false);
  assert.deepEqual(store.requested, [], 'history-based redelivery waits for the full scan');
  assert.equal(store.advanced.length, 0);

  let resumedUrl;
  const secondFetch = async (url, options) => {
    resumedUrl = String(url);
    assert.equal(options.method, 'GET');
    assert.equal(new URL(resumedUrl).searchParams.get('cursor'), 'page-6');
    return response(200, [{
      id: 10_000,
      guid,
      delivered_at: new Date(scanNow - (10_000 * 1_000)).toISOString(),
      status: 'OK',
    }]);
  };
  const secondRes = output();
  await reconcileWebhookDeliveries({ req: cronRequest(), res: secondRes, env: cronEnv(), fetchImpl: secondFetch, store, now: () => scanNow + 1_000 });

  assert.equal(secondRes.statusCode, 200);
  assert.equal(JSON.parse(secondRes.body).scan_continuation_pending, false);
  assert.match(resumedUrl, /cursor=page-6/);
  assert.deepEqual(store.requested, [], 'the successful attempt on the resumed segment prevents a stale redelivery');
  assert.equal(store.advanced.length, 1);
  assert.equal(store.advanced[0].deliveryId, '20000');
  assert.equal(store.checkpoint.scan_cursor, null);
  assert.equal(store.observations.size, 0);
});

test('reconciler rejects missing and incorrect Cron bearer credentials before accessing storage', async () => {
  for (const headers of [{}, { authorization: 'Bearer wrong-secret' }]) {
    const res = output();
    await reconcileWebhookDeliveries({
      req: { method: 'GET', headers },
      res,
      env: cronEnv(),
      store: { async reconcilerCheckpoint() { throw new Error('must not read storage'); } },
    });
    assert.equal(res.statusCode, 401);
  }
});
