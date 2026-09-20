import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';

import { invocationEnvelope } from '../../scripts/lib/agent-invocation.mjs';
import {
  CONTRACT_VERSIONS,
  assertEventEnvelope,
  controllerPinMatchesRelease,
  validateControllerRelease,
  validateEventEnvelope,
} from '../../scripts/lib/control-plane-contracts.mjs';
import { validateControllerRelease as validateReleaseManifest } from '../../scripts/validate-controller-release.mjs';

const repositoryRoot = path.resolve(import.meta.dirname, '../..');

test('contract schemas are present and self-identifying', async () => {
  for (const file of ['event-envelope.v1.schema.json', 'participant-registry.v1.schema.json', 'controller-release.v1.schema.json']) {
    const schema = JSON.parse(await readFile(path.join(repositoryRoot, 'schemas', file), 'utf8'));
    assert.equal(schema.$schema, 'https://json-schema.org/draft/2020-12/schema');
    assert.match(schema.$id, /agentic-delivery-lab\/agentic-delivery\/blob\/main\/schemas\//);
    assert.equal(schema.type, 'object');
    assert.ok(schema.title);
  }
});

test('the checked-in controller release pins every enrolled participant', async () => {
  const release = JSON.parse(await readFile(path.join(repositoryRoot, 'config/controller-release.json'), 'utf8'));
  assert.deepEqual(validateControllerRelease(release), { valid: true, errors: [] });
  const validated = await validateReleaseManifest({ repositoryRoot });
  assert.equal(validated.commit, release.commit);
  assert.equal(controllerPinMatchesRelease(release, {
    controller: { version: '0.2.0', commit: release.commit },
    contracts: release.contracts,
    dependencies: release.dependencies,
  }), true);
  assert.equal(controllerPinMatchesRelease(release, {
    controller: { version: '0.1.0', commit: '8b9bd77e1cb6008ce9dab3bbe8652ab7979b4c99' },
    contracts: release.contracts,
    dependencies: release.dependencies,
  }), false);
  const upgraded = structuredClone(release);
  upgraded.compatibility.controllers.push({
    version: '0.1.0',
    commit: '8b9bd77e1cb6008ce9dab3bbe8652ab7979b4c99',
    contracts: release.contracts,
    dependencies: release.dependencies,
  });
  assert.equal(controllerPinMatchesRelease(upgraded, {
    controller: { version: '0.1.0', commit: '8b9bd77e1cb6008ce9dab3bbe8652ab7979b4c99' },
    contracts: release.contracts,
    dependencies: release.dependencies,
  }), true);
});

test('valid event envelopes are accepted before central execution', () => {
  const envelope = invocationEnvelope({
    deliveryId: '12345678-1234-4234-8234-123456789012',
    eventName: 'issue_comment',
    action: 'created',
    repositoryId: '1358455028',
    source: { kind: 'issue_comment', issue_number: 44, pull_request_number: null, comment_id: 7, review_id: null },
    actor: { login: 'sjefsharp', type: 'User' },
    body: '@agentic-delivery-lab-invoker-7f3a continue',
    receivedAt: '2026-09-21T12:00:00.000Z',
    organizationId: '327861320',
    installationId: '163255060',
    repositoryFullName: 'agentic-delivery-lab/agentic-delivery',
  });
  assert.deepEqual(validateEventEnvelope(envelope), { valid: true, errors: [] });
  assert.equal(assertEventEnvelope(envelope), envelope);
  assert.deepEqual(CONTRACT_VERSIONS, { eventEnvelope: 1, lifecycle: '1.0.0', stateMachine: '1.0.0', evidence: '1.0.0' });
});

test('event envelopes reject malformed gateway receipt timestamps', () => {
  const envelope = invocationEnvelope({
    deliveryId: '32345678-1234-4234-8234-123456789012',
    eventName: 'issues',
    action: 'opened',
    repositoryId: '1358455028',
    source: { kind: 'issue', issue_number: 44, pull_request_number: null, comment_id: null, review_id: null },
    actor: { login: 'sjefsharp', type: 'User' },
    body: 'A new issue',
    receivedAt: 'not-a-timestamp',
  });
  const result = validateEventEnvelope(envelope);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((error) => error.startsWith('received_at')));
});

test('pull-request review envelopes use the pull-request identity until source issue resolution', () => {
  const result = validateEventEnvelope(invocationEnvelope({
    deliveryId: '22345678-1234-4234-8234-123456789012',
    eventName: 'pull_request_review',
    action: 'submitted',
    repositoryId: '1358455028',
    source: { kind: 'pull_request_review', issue_number: null, pull_request_number: 19, comment_id: null, review_id: 8 },
    actor: { login: 'sjefsharp', type: 'User' },
    body: '@agentic-delivery-lab-invoker-7f3a review this',
  }));
  assert.deepEqual(result, { valid: true, errors: [] });
});

test('malformed identity or source data fails closed', () => {
  const result = validateEventEnvelope({
    version: 1,
    delivery_id: 'not-a-delivery',
    event: 'issue_comment',
    action: 'created',
    repository_id: '0',
    source: { kind: 'issue', issue_number: null, pull_request_number: null, comment_id: null, review_id: null },
    actor: { login: 'bad login', type: 'User' },
    hop: 2,
    parent_delivery_id: null,
    body_digest: 'short',
  });
  assert.equal(result.valid, false);
  for (const phrase of ['delivery_id', 'repository_id', 'source.kind', 'source.issue_number', 'actor.login', 'hop', 'body_digest']) {
    assert.ok(result.errors.some((error) => error.startsWith(phrase)), phrase);
  }
  assert.throws(() => assertEventEnvelope({}), /Invalid event envelope/);
});
