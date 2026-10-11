import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { promisify } from 'node:util';

import { invocationEnvelope, packRepositoryDispatchClientPayload, unwrapRepositoryDispatchClientPayload } from '../../scripts/lib/agent-invocation.mjs';
import { loadParticipantRegistry, participantForRepository } from '../../scripts/lib/participant-registry.mjs';
import { normalizeRepositoryDispatchEventFile } from '../../scripts/normalize-repository-dispatch-event.mjs';
import { ObservationValidationError, validateObservationEvent } from '../../scripts/validate-observation-event.mjs';

const repositoryRoot = path.resolve(import.meta.dirname, '../..');
const execFileAsync = promisify(execFile);

async function writeEvent(t, envelope) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'agentic-delivery-observation-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const eventPath = path.join(root, 'event.json');
  await writeFile(eventPath, JSON.stringify({
    repository: { full_name: 'agentic-delivery-lab/agentic-delivery', id: 1358455028 },
    client_payload: packRepositoryDispatchClientPayload(envelope),
  }));
  return eventPath;
}

test('observation validator accepts an enrolled pull-request event without GitHub access', async (t) => {
  const registry = await loadParticipantRegistry(repositoryRoot);
  const participant = participantForRepository(registry, '1358455028');
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
    controller: participant.controller,
    dispatchSecret: 'dispatch-secret',
    dispatchTimestamp: 1789992000000,
  }));
  const result = await validateObservationEvent({ eventPath, repositoryRoot, dispatchSecret: 'dispatch-secret', now: () => 1789992000000 });
  assert.equal(result.status, 'passed');
  assert.equal(result.action, 'ready_for_review');
});

test('trusted observation CLI verifies the normalized event and exports the registry controller pin', async (t) => {
  const registry = await loadParticipantRegistry(repositoryRoot);
  const participant = participantForRepository(registry, '1358455028');
  const secret = 'dispatch-secret';
  const dispatchTimestamp = Date.now();
  const eventPath = await writeEvent(t, invocationEnvelope({
    deliveryId: '72345678-1234-4234-8234-123456789012',
    eventName: 'pull_request',
    action: 'ready_for_review',
    repositoryId: '1358455028',
    source: { kind: 'pull_request', issue_number: null, pull_request_number: 19, comment_id: null, review_id: null },
    actor: { login: 'external-contributor', type: 'User' },
    body: 'A pull-request observation.',
    organizationId: '327861320',
    installationId: '163255060',
    repositoryFullName: 'agentic-delivery-lab/agentic-delivery',
    controller: participant.controller,
    dispatchSecret: secret,
    dispatchTimestamp,
  }));
  const normalizedPath = `${eventPath}.normalized`;
  const outputPath = `${eventPath}.output`;
  await normalizeRepositoryDispatchEventFile(eventPath, normalizedPath);
  await writeFile(outputPath, '');

  const { stdout } = await execFileAsync(process.execPath, [
    'scripts/validate-observation-event.mjs', repositoryRoot,
  ], {
    cwd: repositoryRoot,
    encoding: 'utf8',
    env: {
      ...process.env,
      GITHUB_EVENT_PATH: normalizedPath,
      GITHUB_REPOSITORY: 'agentic-delivery-lab/agentic-delivery',
      CODEX_DELIVERY_DISPATCH_SECRET: secret,
      GITHUB_OUTPUT: outputPath,
    },
  });

  assert.match(stdout, /Observation passed: agentic-delivery-lab\/agentic-delivery#1358455028 ready_for_review\./);
  assert.equal(await readFile(outputPath, 'utf8'), `controller_commit=${participant.controller.commit}\n`);
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
    controller: { version: '0.2.0-draft.38', commit: '9367c5a1c58eb6215b92d34fbe5490cd85fb061f' },
    dispatchSecret: 'dispatch-secret',
    dispatchTimestamp: 1789992000000,
  });
  const eventPath = await writeEvent(t, envelope);
  const event = JSON.parse(await readFile(eventPath, 'utf8'));
  const tamperedEnvelope = unwrapRepositoryDispatchClientPayload(event.client_payload);
  tamperedEnvelope.repository_id = '777777777';
  event.client_payload = packRepositoryDispatchClientPayload(tamperedEnvelope);
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
    controller: { version: '0.2.0-draft.38', commit: '9367c5a1c58eb6215b92d34fbe5490cd85fb061f' },
  }));
  await assert.rejects(
    validateObservationEvent({ eventPath, repositoryRoot }),
    (error) => error instanceof ObservationValidationError && /observation dispatch/.test(error.message),
  );
});
