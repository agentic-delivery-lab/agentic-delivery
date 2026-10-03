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
    async reconcilerCheckpoint() { return this.checkpoint; },
    async dueControllerReceipts() { return this.dueReceipts; },
    async dueRedeliveryRequests() { return this.dueRedeliveries; },
    async linkGithubDelivery(key, id) { this.linked.push({ key, id }); },
    async claimRedeliveryRequest(guid, id) {
      this.requested.push({ guid, id });
      return requestStatus === 'claimed' ? { claimed: true } : { claimed: false, status: requestStatus };
    },
    async markRedeliveryAccepted(guid, id) { this.requested.at(-1).accepted = { guid, id }; },
    async releaseRedeliveryRequest(guid) { this.requested.at(-1).released = guid; },
    async completeRedelivery(guid) { this.completed.push(guid); },
    async advanceReconcilerCheckpoint(value) { this.advanced.push(value); },
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
      ], { link: '<https://api.github.com/app/hook/deliveries?per_page=100&page=2>; rel="next"' });
    }
    if (String(url).includes('page=2')) {
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
  assert.equal(store.linked[0].key, `163255060:${deliveryC}`);
  assert.equal(store.linked[0].id, '99');
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
