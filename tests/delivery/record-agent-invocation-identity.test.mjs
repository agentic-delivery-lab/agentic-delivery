import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import { recordAgentInvocationIdentity } from '../../scripts/record-agent-invocation-identity.mjs';
import { packRepositoryDispatchClientPayload } from '../../scripts/lib/agent-invocation.mjs';
import { InMemoryReplayStore } from '../../scripts/lib/replay-protection.mjs';

const identity = {
  originRepository: 'agentic-delivery-lab/agentic-delivery-architecture',
  originRepositoryId: '1380894616',
  sourceIssueNumber: 11,
  controllerCommit: 'a'.repeat(40),
  workflowRunId: '38206400933',
  workflowRunAttempt: 2,
};
const deliveryId = '12345678-1234-4234-8234-123456789012';
const receiptKey = `163255060:${deliveryId}`;

function event(identityValue = identity) {
  return {
    installation_id: '163255060',
    delivery_id: deliveryId,
    repository_id: identityValue.originRepositoryId,
    repository_full_name: identityValue.originRepository,
    source: { kind: 'issue', issue_number: identityValue.sourceIssueNumber },
    controller: { version: '0.2.0-draft.37', commit: identityValue.controllerCommit },
  };
}

function env(eventPath, identityValue = identity) {
  return {
    GITHUB_EVENT_PATH: eventPath,
    GITHUB_RUN_ID: identityValue.workflowRunId,
    GITHUB_RUN_ATTEMPT: String(identityValue.workflowRunAttempt),
    ORIGIN_REPOSITORY: identityValue.originRepository,
    ORIGIN_REPOSITORY_ID: identityValue.originRepositoryId,
    SOURCE_ISSUE: String(identityValue.sourceIssueNumber),
    CONTROLLER_COMMIT: identityValue.controllerCommit,
  };
}

test('trusted workflow records cross-repository invocation identity before delivery starts', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'agentic-delivery-record-identity-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const eventPath = path.join(root, 'event.json');
  await writeFile(eventPath, JSON.stringify({ client_payload: packRepositoryDispatchClientPayload(event()) }));
  const store = new InMemoryReplayStore();
  const leaseToken = `${identity.workflowRunId}:${identity.workflowRunAttempt}`;
  await store.ensureControllerReceipt(receiptKey);
  await store.claimController(receiptKey, { leaseToken });

  assert.deepEqual(await recordAgentInvocationIdentity({ env: env(eventPath), store }), { status: 'recorded' });
  assert.deepEqual((await store.controllerReceipt(receiptKey)).identity, identity);
});

test('trusted workflow refuses an identity that does not match the cross-repository event', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'agentic-delivery-record-identity-mismatch-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const eventPath = path.join(root, 'event.json');
  await writeFile(eventPath, JSON.stringify({ client_payload: packRepositoryDispatchClientPayload(event()) }));
  const store = new InMemoryReplayStore();
  const leaseToken = `${identity.workflowRunId}:${identity.workflowRunAttempt}`;
  await store.ensureControllerReceipt(receiptKey);
  await store.claimController(receiptKey, { leaseToken });

  await assert.rejects(recordAgentInvocationIdentity({
    env: env(eventPath, { ...identity, originRepository: 'agentic-delivery-lab/agentic-delivery' }),
    store,
  }), /does not match the signed event/);
  assert.equal((await store.controllerReceipt(receiptKey)).identity, undefined);
});

test('trusted workflow preserves an issue-linked source for pull-request events', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'agentic-delivery-record-pr-identity-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const eventPath = path.join(root, 'event.json');
  const pullRequestEvent = event();
  pullRequestEvent.source = {
    kind: 'pull_request_comment',
    issue_number: 42,
    pull_request_number: 42,
    comment_id: 99,
    review_id: null,
  };
  await writeFile(eventPath, JSON.stringify({ client_payload: packRepositoryDispatchClientPayload(pullRequestEvent) }));
  const store = new InMemoryReplayStore();
  const leaseToken = `${identity.workflowRunId}:${identity.workflowRunAttempt}`;
  await store.ensureControllerReceipt(receiptKey);
  await store.claimController(receiptKey, { leaseToken });

  assert.deepEqual(await recordAgentInvocationIdentity({ env: env(eventPath), store }), { status: 'recorded' });
  assert.equal((await store.controllerReceipt(receiptKey)).identity.sourceIssueNumber, identity.sourceIssueNumber);
});
