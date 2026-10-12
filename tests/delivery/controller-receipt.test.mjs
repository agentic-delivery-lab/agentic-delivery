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
const receiptIdentity = {
  originRepository: 'agentic-delivery-lab/agentic-delivery-architecture',
  originRepositoryId: '1380894616',
  sourceIssueNumber: 11,
  controllerCommit: 'a'.repeat(40),
  workflowRunId: '38206400933',
  workflowRunAttempt: 2,
};

function invocationEvent(identity = receiptIdentity) {
  return {
    installation_id: '163255060',
    delivery_id: deliveryId,
    repository_id: identity.originRepositoryId,
    repository_full_name: identity.originRepository,
    source: { kind: 'issue', issue_number: identity.sourceIssueNumber, pull_request_number: null, comment_id: null, review_id: null },
    controller: { version: '0.2.0-draft.37', commit: identity.controllerCommit },
  };
}

function finalizerEnv(eventPath, result, identity = receiptIdentity) {
  return {
    GITHUB_EVENT_PATH: eventPath,
    GITHUB_RUN_ID: identity.workflowRunId,
    GITHUB_RUN_ATTEMPT: String(identity.workflowRunAttempt),
    ORIGIN_REPOSITORY: identity.originRepository,
    ORIGIN_REPOSITORY_ID: identity.originRepositoryId,
    SOURCE_ISSUE: String(identity.sourceIssueNumber),
    CONTROLLER_COMMIT: identity.controllerCommit,
    INVOCATION_RESULT: result,
  };
}

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

test('file-backed controller receipt attribution survives reopening the store', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'agentic-delivery-file-attribution-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const store = new FileReplayStore({ directory: root });
  const leaseToken = `${receiptIdentity.workflowRunId}:${receiptIdentity.workflowRunAttempt}`;
  await store.ensureControllerReceipt(receiptKey);
  await store.claimController(receiptKey, { leaseToken });
  await store.recordControllerIdentity(receiptKey, { leaseToken, identity: receiptIdentity });

  const reopenedStore = new FileReplayStore({ directory: root });
  assert.deepEqual((await reopenedStore.controllerReceipt(receiptKey)).identity, receiptIdentity);
});

test('an expired controller run cannot finalize a receipt claimed by a later run', async () => {
  let now = 10_000;
  const store = new InMemoryReplayStore({ now: () => now });
  const oldIdentity = { ...receiptIdentity, workflowRunId: '111', workflowRunAttempt: 1 };
  const newIdentity = { ...receiptIdentity, workflowRunId: '112', workflowRunAttempt: 1 };
  await store.ensureControllerReceipt(receiptKey);
  assert.deepEqual(await store.claimController(receiptKey, { leaseMs: 100, leaseToken: '111:1' }), { status: 'claimed' });
  await store.recordControllerIdentity(receiptKey, { leaseToken: '111:1', identity: oldIdentity });
  now += 101;
  assert.deepEqual(await store.claimController(receiptKey, { leaseMs: 100, leaseToken: '112:1' }), { status: 'claimed' });
  await store.recordControllerIdentity(receiptKey, { leaseToken: '112:1', identity: newIdentity });

  await assert.rejects(store.completeController(receiptKey, { leaseToken: '111:1', identity: oldIdentity }), /could not be completed/);
  await store.completeController(receiptKey, { leaseToken: '112:1', identity: newIdentity });
  assert.deepEqual((await store.controllerReceipt(receiptKey)).identity, newIdentity);
});

test('controller finalizer records success only after the workflow has completed', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'agentic-delivery-finalize-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const eventPath = path.join(root, 'event.json');
  await writeFile(eventPath, JSON.stringify({ client_payload: packRepositoryDispatchClientPayload(invocationEvent()) }));
  const store = new InMemoryReplayStore();
  await store.ensureControllerReceipt(receiptKey);
  await store.claimController(receiptKey, { leaseToken: `${receiptIdentity.workflowRunId}:${receiptIdentity.workflowRunAttempt}` });

  assert.deepEqual(await finalizeAgentInvocation({
    env: finalizerEnv(eventPath, 'success'),
    store,
  }), { status: 'completed' });
  assert.deepEqual(await store.claimController(receiptKey), { status: 'completed' });
});

test('controller receipt retains the validated source and workflow run identity through finalization', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'agentic-delivery-attributable-finalize-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const eventPath = path.join(root, 'event.json');
  await writeFile(eventPath, JSON.stringify({ client_payload: packRepositoryDispatchClientPayload(invocationEvent()) }));
  const store = new InMemoryReplayStore();
  const leaseToken = `${receiptIdentity.workflowRunId}:${receiptIdentity.workflowRunAttempt}`;
  await store.ensureControllerReceipt(receiptKey);
  await store.claimController(receiptKey, { leaseToken });

  await store.recordControllerIdentity(receiptKey, { leaseToken, identity: receiptIdentity });
  const result = await finalizeAgentInvocation({
    env: {
      GITHUB_EVENT_PATH: eventPath,
      GITHUB_RUN_ID: receiptIdentity.workflowRunId,
      GITHUB_RUN_ATTEMPT: String(receiptIdentity.workflowRunAttempt),
      ORIGIN_REPOSITORY: receiptIdentity.originRepository,
      ORIGIN_REPOSITORY_ID: receiptIdentity.originRepositoryId,
      SOURCE_ISSUE: String(receiptIdentity.sourceIssueNumber),
      CONTROLLER_COMMIT: receiptIdentity.controllerCommit,
      INVOCATION_RESULT: 'success',
    },
    store,
  });

  assert.deepEqual(result, { status: 'completed' });
  const receipt = await store.controllerReceipt(receiptKey);
  assert.equal(receipt.status, 'completed');
  assert.deepEqual(receipt.identity, receiptIdentity);
});

test('controller finalizer makes failed work retryable with backoff', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'agentic-delivery-retry-finalize-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const eventPath = path.join(root, 'event.json');
  await writeFile(eventPath, JSON.stringify({ client_payload: packRepositoryDispatchClientPayload(invocationEvent()) }));
  let now = 10_000;
  const store = new InMemoryReplayStore({ now: () => now });
  await store.ensureControllerReceipt(receiptKey);
  await store.claimController(receiptKey, { leaseToken: `${receiptIdentity.workflowRunId}:${receiptIdentity.workflowRunAttempt}` });

  assert.deepEqual(await finalizeAgentInvocation({
    env: finalizerEnv(eventPath, 'failure'),
    store,
  }), { status: 'retryable' });
  assert.deepEqual((await store.controllerReceipt(receiptKey)).identity, receiptIdentity);
  assert.deepEqual(await store.claimController(receiptKey), { status: 'waiting' });
  now += 60_001;
  const retryIdentity = { ...receiptIdentity, workflowRunId: '38206400934', workflowRunAttempt: 1 };
  const retryLeaseToken = `${retryIdentity.workflowRunId}:${retryIdentity.workflowRunAttempt}`;
  assert.deepEqual(await store.claimController(receiptKey, { leaseToken: retryLeaseToken }), { status: 'claimed' });
  await store.recordControllerIdentity(receiptKey, { leaseToken: retryLeaseToken, identity: retryIdentity });
  assert.deepEqual((await store.controllerReceipt(receiptKey)).identity, retryIdentity);
  assert.deepEqual(await finalizeAgentInvocation({
    env: finalizerEnv(eventPath, 'success', retryIdentity),
    store,
  }), { status: 'completed' });
  assert.deepEqual((await store.controllerReceipt(receiptKey)).identity, retryIdentity);
});

test('controller finalizer refuses source identity that differs from the signed event', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'agentic-delivery-finalize-mismatch-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const eventPath = path.join(root, 'event.json');
  await writeFile(eventPath, JSON.stringify({ client_payload: packRepositoryDispatchClientPayload(invocationEvent()) }));
  const store = new InMemoryReplayStore();
  await store.ensureControllerReceipt(receiptKey);
  const leaseToken = `${receiptIdentity.workflowRunId}:${receiptIdentity.workflowRunAttempt}`;
  await store.claimController(receiptKey, { leaseToken });

  await assert.rejects(finalizeAgentInvocation({
    env: finalizerEnv(eventPath, 'success', { ...receiptIdentity, sourceIssueNumber: 12 }),
    store,
  }), /source Issue does not match the signed event/);
  const receipt = await store.controllerReceipt(receiptKey);
  assert.equal(receipt.status, 'running');
  assert.equal(receipt.identity, undefined);
});
