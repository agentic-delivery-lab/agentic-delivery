import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { cp, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { promisify } from 'node:util';

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
const execFileAsync = promisify(execFile);

test('contract schemas are present and self-identifying', async () => {
  for (const file of ['event-envelope.v1.schema.json', 'event-catalog.v1.schema.json', 'participant-registry.v1.schema.json', 'controller-release.v1.schema.json', 'controller-release.v2.schema.json', 'github-app-contract.v1.schema.json', 'github-app-contract.v2.schema.json', 'primitive-selection.v1.schema.json']) {
    const schema = JSON.parse(await readFile(path.join(repositoryRoot, 'schemas', file), 'utf8'));
    assert.equal(schema.$schema, 'https://json-schema.org/draft/2020-12/schema');
    assert.match(schema.$id, /agentic-delivery-lab\/agentic-delivery\/blob\/main\/schemas\//);
    assert.equal(schema.type, 'object');
    assert.ok(schema.title);
  }
});

test('the checked-in controller release pins every enrolled participant and required runtime asset', async () => {
  const release = JSON.parse(await readFile(path.join(repositoryRoot, 'config/controller-release.json'), 'utf8'));
  assert.deepEqual(validateControllerRelease(release), { valid: true, errors: [] });
  assert.equal(release.schemaVersion, 2);
  assert.equal(release.$schema, '../schemas/controller-release.v2.schema.json');
  assert.equal(release.version, '0.2.0-draft.55');
  assert.equal(release.commit, '6eeb5d1d7c31f9f63586560528f4f327ced5e60c');
  assert.equal(release.bootstrapCommit, 'df7a0caa3c4050af86b4bf70270758abd64627f9');
  assert.equal(release.githubAppContractVersion, '2.0.0');
  assert.equal(release.compatibility.githubAppContractVersion, '2.0.0');
  assert.deepEqual(release.support.githubAppContractVersions, ['2.0.0']);
  assert.deepEqual(release.support.eventEnvelopeVersions, [1]);
  assert.deepEqual(release.support.lifecycleVersions, ['1.0.0']);
  assert.deepEqual(release.support.stateMachineVersions, ['1.0.0']);
  assert.deepEqual(release.support.evidenceVersions, ['1.0.0']);
  assert.deepEqual(release.support.primitiveCompatibility, ['0.x']);
  assert.deepEqual(release.support.architectureCompatibility, ['0.x']);
  assert.equal(release.support.minimumBootstrapVersion, '0.2.0-draft.23');
  assert.equal(release.support.policy.supportWindowDays, 90);
  const validated = await validateReleaseManifest({ repositoryRoot });
  assert.equal(validated.commit, release.commit);
  assert.equal(controllerPinMatchesRelease(release, {
    controller: { version: release.version, commit: release.commit },
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

test('controller release validation rejects pins missing durable invocation receipt runtime', async (t) => {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), 'agentic-delivery-release-runtime-'));
  t.after(() => rm(temporaryRoot, { recursive: true, force: true }));
  await execFileAsync('git', ['clone', '--quiet', '--shared', '--no-checkout', repositoryRoot, temporaryRoot], { encoding: 'utf8' });
  await mkdir(path.join(temporaryRoot, 'config'), { recursive: true });
  for (const file of ['controller-release.json', 'participants.yml']) {
    await cp(path.join(repositoryRoot, 'config', file), path.join(temporaryRoot, 'config', file));
  }
  const releasePath = path.join(temporaryRoot, 'config', 'controller-release.json');
  const release = JSON.parse(await readFile(releasePath, 'utf8'));
  release.commit = '8a2acddf07d0b70b11fc5d9c1f5143e54abf9185';
  await writeFile(releasePath, `${JSON.stringify(release, null, 2)}\n`, 'utf8');

  await assert.rejects(
    validateReleaseManifest({ repositoryRoot: temporaryRoot }),
    /release .* is missing required runtime file scripts\/lib\/neon-replay-store\.mjs/,
  );

  release.bootstrapCommit = '7f71508ea4cf4ff881b8d1b7628dc5722fca24b5';
  await writeFile(releasePath, `${JSON.stringify(release, null, 2)}\n`, 'utf8');
  await assert.rejects(
    validateReleaseManifest({ repositoryRoot: temporaryRoot }),
    /bootstrap commit .* is missing required runtime file scripts\/lib\/neon-replay-store\.mjs/,
  );
});

test('controller release support policy fails closed for incomplete compatibility metadata', async () => {
  const release = JSON.parse(await readFile(path.join(repositoryRoot, 'config/controller-release.json'), 'utf8'));
  const invalid = structuredClone(release);
  invalid.support.policy.supportWindowDays = 30;
  invalid.support.primitiveCompatibility = ['latest'];
  const result = validateControllerRelease(invalid);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((error) => error.includes('support.policy.supportWindowDays')));
  assert.ok(result.errors.some((error) => error.includes('support.primitiveCompatibility')));
});

test('controller release support policy includes current contracts and dependency majors', async () => {
  const release = JSON.parse(await readFile(path.join(repositoryRoot, 'config/controller-release.json'), 'utf8'));
  const invalid = structuredClone(release);
  invalid.support.lifecycleVersions = ['2.0.0'];
  invalid.support.architectureCompatibility = ['1.x'];
  invalid.compatibility.evidence = '2.0.0';
  const result = validateControllerRelease(invalid);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((error) => error.includes('support.lifecycleVersions must include contracts.lifecycle')));
  assert.ok(result.errors.some((error) => error.includes('support.architectureCompatibility must include the pinned Architecture major version')));
  assert.ok(result.errors.some((error) => error.includes('compatibility.evidence must match contracts.evidence')));
});

test('controller release schema v2 pins a supported GitHub App contract version', async () => {
  const release = JSON.parse(await readFile(path.join(repositoryRoot, 'config/controller-release.json'), 'utf8'));
  const invalid = structuredClone(release);
  invalid.support.githubAppContractVersions = ['1.0.0'];
  invalid.compatibility.githubAppContractVersion = '1.0.0';
  const result = validateControllerRelease(invalid);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((error) => error.includes('support.githubAppContractVersions must include githubAppContractVersion')));
  assert.ok(result.errors.some((error) => error.includes('compatibility.githubAppContractVersion must match githubAppContractVersion')));
});

test('the current controller release pins immutable Architecture and Primitive content digests', async () => {
  const release = JSON.parse(await readFile(path.join(repositoryRoot, 'config/controller-release.json'), 'utf8'));
  for (const dependency of [release.dependencies.architecture, release.dependencies.primitives]) {
    assert.match(dependency.commit, /^[0-9a-f]{40}$/);
    assert.match(dependency.contentSha256, /^[0-9a-f]{64}$/);
  }
  assert.equal(release.dependencies.architecture.version, '0.1.0-draft.8');
  assert.equal(release.dependencies.primitives.version, '0.1.0-draft.4');
});

test('the release catalog retains an older immutable pin for intentional rollback', async () => {
  const release = JSON.parse(await readFile(path.join(repositoryRoot, 'config/controller-release.json'), 'utf8'));
  assert.ok(release.compatibility.controllers.some((pin) => (
    pin.version === '0.2.0-draft.42'
    && pin.commit === 'b17a2077b645e7eb861aeb75558d77fb1c46011c'
  )));
  assert.ok(release.compatibility.controllers.some((pin) => (
    pin.version === '0.2.0-draft.6'
    && pin.commit === '564a35fd798e75800a3bf15223afb8bd87d59581'
  )));
  assert.ok(release.compatibility.controllers.some((pin) => (
    pin.version === '0.2.0-draft.2'
    && pin.commit === '50fba4418e394bf2fa57521302241caf474516bd'
  )));
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

test('pull-request lifecycle envelopes are valid observations with no issue transition', () => {
  const result = validateEventEnvelope(invocationEnvelope({
    deliveryId: '42345678-1234-4234-8234-123456789012',
    eventName: 'pull_request',
    action: 'synchronize',
    repositoryId: '1358455028',
    source: { kind: 'pull_request', issue_number: null, pull_request_number: 19, comment_id: null, review_id: null },
    actor: { login: 'external-contributor', type: 'User' },
    body: 'A pull-request change.',
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
