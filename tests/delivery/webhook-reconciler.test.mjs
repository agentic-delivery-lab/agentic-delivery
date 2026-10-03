import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { test } from 'node:test';

import { reconcileWebhookDeliveries } from '../../api/cron/reconcile-webhooks.mjs';

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
    async json() { return body; },
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

function makeStore({ checkpoint = null, dueReceipts = [], dueRedeliveries = [], requestStatus = 'claimed' } = {}) {
  return {
    checkpoint,
    dueReceipts,
    dueRedeliveries,
    requested: [],
    linked: [],
    completed: [],
    advanced: [],
    scanProgress: [],
    observations: new Map(),
    async reconcilerCheckpoint() { return this.checkpoint; },
    async mergeReconcilerObservations(values) {
      for (const value of values) {
        const existing = this.observations.get(value.guid);
        if (existing && existing.installation_id != null && value.installationId != null
          && String(existing.installation_id) !== String(value.installationId)) {
          throw new Error('conflicting installation IDs');
        }
        const newer = !existing
          || Date.parse(value.deliveredAt) > Date.parse(existing.newest_delivery_at)
          || (Date.parse(value.deliveredAt) === Date.parse(existing.newest_delivery_at)
            && BigInt(value.deliveryId) > BigInt(existing.newest_delivery_id));
        this.observations.set(value.guid, {
          delivery_guid: value.guid,
          newest_delivery_at: newer ? value.deliveredAt : existing.newest_delivery_at,
          newest_delivery_id: newer ? value.deliveryId : existing.newest_delivery_id,
          has_success: Boolean(existing?.has_success || value.hasSuccess),
          installation_id: existing?.installation_id ?? value.installationId,
        });
      }
    },
    async reconcilerObservations() { return [...this.observations.values()]; },
    async dueControllerReceipts() { return this.dueReceipts; },
    async dueRedeliveryRequests() { return this.dueRedeliveries; },
    async linkGithubDeliveries(links) { this.linked.push(...links.map(({ replayKey, githubDeliveryId }) => ({ key: replayKey, id: githubDeliveryId }))); },
    async claimRedeliveryRequest(guid, id) {
      this.requested.push({ guid, id });
      return requestStatus === 'claimed' ? { claimed: true } : { claimed: false, status: requestStatus };
    },
    async markRedeliveryAccepted(guid, id) { this.requested.at(-1).accepted = { guid, id }; },
    async releaseRedeliveryRequest(guid) { this.requested.at(-1).released = guid; },
    async completeRedelivery(guid) { this.completed.push(guid); },
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
  await reconcileWebhookDeliveries({ req: cronRequest(), res, env: cronEnv(), fetchImpl, store, now: () => scanNow });

  assert.equal(res.statusCode, 200);
  assert.deepEqual(redeliveries.sort(), ['101', '99']);
  assert.equal(store.advanced.length, 1);
  assert.equal(store.advanced[0].deliveryId, '101');
  assert.ok(store.linked.some((link) => link.key === `163255060:${deliveryC}` && link.id === '99'));
  assert.equal(JSON.parse(res.body).scanned_pages, 2);
});

test('reconciler leaves its checkpoint unchanged when GitHub rate limits redelivery', async () => {
  const scanNow = Date.now();
  const store = makeStore();
  const fetchImpl = async (url, options) => {
    if (options.method === 'POST') return response(429, [], { 'retry-after': '60' });
    return response(200, [{ id: 201, guid: deliveryA, delivered_at: new Date(scanNow - 5_000).toISOString(), status: 'FAIL', installation_id: '163255060' }]);
  };
  const res = output();
  await reconcileWebhookDeliveries({ req: cronRequest(), res, env: cronEnv(), fetchImpl, store, now: () => scanNow });

  assert.equal(res.statusCode, 503);
  assert.deepEqual(store.advanced, []);
  assert.equal(store.requested.length, 1);
  assert.equal(store.requested[0].released, undefined);
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

test('reconciler links a pending controller receipt before checkpointing successful webhook history', async () => {
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
    store.advanced.push(value);
    checkpoint = { checkpoint_at: value.deliveredAt, checkpoint_delivery_id: value.deliveryId };
  };
  const deliveredAt = new Date(scanNow - 60_000).toISOString();
  const fetchImpl = async (url, options) => {
    if (options.method === 'POST') {
      posts.push(String(url));
      return response(202);
    }
    return response(200, [{ id: 301, guid, delivered_at: deliveredAt, status: 'OK', installation_id: '163255060' }]);
  };
  const firstRes = output();
  await reconcileWebhookDeliveries({ req: cronRequest(), res: firstRes, env: cronEnv(), fetchImpl, store, now: () => scanNow });

  assert.equal(firstRes.statusCode, 200);
  assert.deepEqual(store.linked[0], { key: pendingReceipt.replay_key, id: '301' });
  assert.equal(checkpoint.checkpoint_delivery_id, '301');

  dueReceipts = [pendingReceipt];
  const secondRes = output();
  await reconcileWebhookDeliveries({ req: cronRequest(), res: secondRes, env: cronEnv(), fetchImpl, store, now: () => scanNow + 24 * 60 * 60 * 1000 });

  assert.equal(secondRes.statusCode, 200);
  assert.deepEqual(posts, ['https://api.github.com/app/hook/deliveries/301/attempts']);
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
