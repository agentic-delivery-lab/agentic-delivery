import assert from 'node:assert/strict';
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import { finalizeAgentInvocation } from '../../scripts/finalize-agent-invocation.mjs';
import { packRepositoryDispatchClientPayload } from '../../scripts/lib/agent-invocation.mjs';
import {
  DEFAULT_CONTROLLER_MAX_ATTEMPTS,
  FileReplayStore,
  InMemoryReplayStore,
} from '../../scripts/lib/replay-protection.mjs';

const deliveryId = '12345678-1234-4234-8234-123456789012';
const receiptKey = `163255060:${deliveryId}`;

test('file-backed replay state uses portable filenames for composite delivery IDs', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'agentic-delivery-file-replay-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const store = new FileReplayStore({ directory: root });

  assert.equal(await store.claim(receiptKey), true);
  await store.ensureControllerReceipt(receiptKey);

  const files = await readdir(root);
  assert.equal(files.length, 2);
  assert.ok(files.every((file) => !file.includes(':')));
  assert.equal((await store.controllerReceipt(receiptKey)).status, 'pending');
});

test('controller receipts serialize active runs and identify completed duplicate dispatches', async () => {
  const store = new InMemoryReplayStore({ now: () => 10_000 });
  await store.ensureControllerReceipt(receiptKey);

  assert.deepEqual(await store.claimController(receiptKey), { status: 'claimed' });
  assert.deepEqual(await store.claimController(receiptKey), { status: 'busy' });
  await store.completeController(receiptKey);
  assert.deepEqual(await store.claimController(receiptKey), { status: 'completed' });
});

test('controller receipt can be reclaimed after an interrupted run lease expires', async () => {
  let now = 10_000;
  const store = new InMemoryReplayStore({ now: () => now });
  await store.ensureControllerReceipt(receiptKey);

  assert.deepEqual(await store.claimController(receiptKey, { leaseMs: 100 }), { status: 'claimed' });
  assert.deepEqual(await store.claimController(receiptKey, { leaseMs: 100 }), { status: 'busy' });
  now += 101;
  assert.deepEqual(await store.claimController(receiptKey, { leaseMs: 100 }), { status: 'claimed' });
});

test('expired controller leases exhaust at the attempt limit instead of being reclaimed forever', async () => {
  let now = 10_000;
  const maxAttempts = DEFAULT_CONTROLLER_MAX_ATTEMPTS;
  const store = new InMemoryReplayStore({ now: () => now });
  await store.ensureControllerReceipt(receiptKey);

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    assert.deepEqual(await store.claimController(receiptKey, { leaseMs: 100 }), { status: 'claimed' });
    assert.equal((await store.controllerReceipt(receiptKey)).attempts, attempt);
    now += 101;
  }

  assert.deepEqual(await store.claimController(receiptKey, { leaseMs: 100 }), { status: 'exhausted' });
  const receipt = await store.controllerReceipt(receiptKey);
  assert.equal(receipt.status, 'exhausted');
  assert.equal(receipt.attempts, maxAttempts);
  assert.equal(receipt.leaseExpiresAt, null);
  assert.equal(receipt.leaseToken, null);
  assert.deepEqual(await store.claimController(receiptKey, { leaseMs: 100 }), { status: 'exhausted' });
});

test('file-backed controller receipts exhaust expired leases at the attempt limit', async (t) => {
  let now = 10_000;
  const root = await mkdtemp(path.join(os.tmpdir(), 'agentic-delivery-controller-limit-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const store = new FileReplayStore({ directory: root, now: () => now });
  const maxAttempts = DEFAULT_CONTROLLER_MAX_ATTEMPTS;
  await store.ensureControllerReceipt(receiptKey);

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    assert.deepEqual(await store.claimController(receiptKey, { leaseMs: 100 }), { status: 'claimed' });
    assert.equal(Number((await store.controllerReceipt(receiptKey)).attempts), attempt);
    now += 101;
  }

  assert.deepEqual(await store.claimController(receiptKey, { leaseMs: 100 }), { status: 'exhausted' });
  const receipt = await store.controllerReceipt(receiptKey);
  assert.equal(receipt.status, 'exhausted');
  assert.equal(Number(receipt.attempts), maxAttempts);
  assert.equal(receipt.leaseExpiresAt, null);
  assert.equal(receipt.leaseToken, null);
});

test('an expired controller run cannot finalize a receipt claimed by a later run', async () => {
  let now = 10_000;
  const store = new InMemoryReplayStore({ now: () => now });
  await store.ensureControllerReceipt(receiptKey);
  assert.deepEqual(await store.claimController(receiptKey, { leaseMs: 100, leaseToken: 'run-old:1' }), { status: 'claimed' });
  now += 101;
  assert.deepEqual(await store.claimController(receiptKey, { leaseMs: 100, leaseToken: 'run-new:1' }), { status: 'claimed' });

  await assert.rejects(store.completeController(receiptKey, { leaseToken: 'run-old:1' }), /could not be completed/);
  await store.completeController(receiptKey, { leaseToken: 'run-new:1' });
});

test('controller finalizer records success only after the workflow has completed', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'agentic-delivery-finalize-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const eventPath = path.join(root, 'event.json');
  await writeFile(eventPath, JSON.stringify({ client_payload: packRepositoryDispatchClientPayload({ installation_id: '163255060', delivery_id: deliveryId }) }));
  const store = new InMemoryReplayStore();
  await store.ensureControllerReceipt(receiptKey);
  await store.claimController(receiptKey, { leaseToken: 'local:1' });

  assert.deepEqual(await finalizeAgentInvocation({
    env: { GITHUB_EVENT_PATH: eventPath, INVOCATION_RESULT: 'success' },
    store,
  }), { status: 'completed' });
  assert.deepEqual(await store.claimController(receiptKey), { status: 'completed' });
});

test('controller finalizer makes failed work retryable with backoff', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'agentic-delivery-retry-finalize-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const eventPath = path.join(root, 'event.json');
  await writeFile(eventPath, JSON.stringify({ client_payload: { installation_id: '163255060', delivery_id: deliveryId } }));
  let now = 10_000;
  const store = new InMemoryReplayStore({ now: () => now });
  await store.ensureControllerReceipt(receiptKey);
  await store.claimController(receiptKey, { leaseToken: 'local:1' });

  assert.deepEqual(await finalizeAgentInvocation({
    env: { GITHUB_EVENT_PATH: eventPath, INVOCATION_RESULT: 'failure' },
    store,
  }), { status: 'retryable' });
  assert.deepEqual(await store.claimController(receiptKey), { status: 'waiting' });
  now += 60_001;
  assert.deepEqual(await store.claimController(receiptKey), { status: 'claimed' });
});
