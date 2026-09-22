import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import { dispatchEnvelopeSignature, invocationEnvelope } from '../../scripts/lib/agent-invocation.mjs';
import { ObservationValidationError, validateObservationEvent } from '../../scripts/validate-observation-event.mjs';

const repositoryRoot = path.resolve(import.meta.dirname, '../..');

async function writeEvent(t, envelope) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'agentic-delivery-observation-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const eventPath = path.join(root, 'event.json');
  await writeFile(eventPath, JSON.stringify({
    repository: { full_name: 'agentic-delivery-lab/agentic-delivery', id: 1358455028 },
    client_payload: envelope,
  }));
  return eventPath;
}

test('observation validator accepts an enrolled pull-request event without GitHub access', async (t) => {
  const eventPath = await writeEvent(t, invocationEnvelope({
    deliveryId: '62345678-1234-4234-8234-123456789012',
    eventName: 'pull_request',
    action: 'ready_for_review',
    repositoryId: '1358455028',
    source: { kind: 'pull_request', issue_number: null, pull_request_number: 19, comment_id: null, review_id: null },
    actor: { login: 'external-contributor', type: 'User' },
    body: 'A pull-request observation.',
    organizationId: '327861320',
    installationId: '163255060',
    repositoryFullName: 'agentic-delivery-lab/agentic-delivery',
    controller: { version: '0.2.0-draft.37', commit: '7d38227f7f8d8377ed7cd1b883d90b71b69bfc9b' },
    dispatchSecret: 'dispatch-secret',
    dispatchTimestamp: 1789992000000,
  }));
  const result = await validateObservationEvent({ eventPath, repositoryRoot, dispatchSecret: 'dispatch-secret', now: () => 1789992000000 });
  assert.equal(result.status, 'passed');
  assert.equal(result.action, 'ready_for_review');
});

test('observation validator rejects a tampered central dispatch envelope', async (t) => {
  const envelope = invocationEnvelope({
    deliveryId: '82345678-1234-4234-8234-123456789012',
    eventName: 'pull_request',
    action: 'ready_for_review',
    repositoryId: '1358455028',
    source: { kind: 'pull_request', issue_number: null, pull_request_number: 19, comment_id: null, review_id: null },
    actor: { login: 'external-contributor', type: 'User' },
    body: 'A pull-request observation.',
    organizationId: '327861320',
    installationId: '163255060',
    repositoryFullName: 'agentic-delivery-lab/agentic-delivery',
    controller: { version: '0.2.0-draft.37', commit: '7d38227f7f8d8377ed7cd1b883d90b71b69bfc9b' },
    dispatchSecret: 'dispatch-secret',
    dispatchTimestamp: 1789992000000,
  });
  const eventPath = await writeEvent(t, envelope);
  const event = JSON.parse(await readFile(eventPath, 'utf8'));
  event.client_payload.repository_id = '777777777';
  await writeFile(eventPath, JSON.stringify(event));
  await assert.rejects(
    validateObservationEvent({ eventPath, repositoryRoot, dispatchSecret: 'dispatch-secret', now: () => 1789992000000 }),
    (error) => error instanceof ObservationValidationError && /dispatch signature/.test(error.message),
  );
});

test('observation validator rejects an invocation event on the observation dispatch', async (t) => {
  const eventPath = await writeEvent(t, invocationEnvelope({
    deliveryId: '72345678-1234-4234-8234-123456789012',
    eventName: 'issue_comment',
    action: 'created',
    repositoryId: '1358455028',
    source: { kind: 'issue_comment', issue_number: 19, pull_request_number: null, comment_id: 8, review_id: null },
    actor: { login: 'sjefsharp', type: 'User' },
    body: '@agentic-delivery-lab-invoker-7f3a continue',
    repositoryFullName: 'agentic-delivery-lab/agentic-delivery',
    controller: { version: '0.2.0-draft.37', commit: '7d38227f7f8d8377ed7cd1b883d90b71b69bfc9b' },
  }));
  await assert.rejects(
    validateObservationEvent({ eventPath, repositoryRoot }),
    (error) => error instanceof ObservationValidationError && /observation dispatch/.test(error.message),
  );
});
