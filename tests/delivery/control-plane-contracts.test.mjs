import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { cp, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';
import { promisify } from 'node:util';
import Ajv2020 from 'ajv/dist/2020.js';

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

async function nativeReleaseFixture() {
  const { stdout } = await execFileAsync('git', ['-C', repositoryRoot, 'show', '52d1dea2f6259d365723f90ce01d771da802edc9:config/controller-release.json']);
  const release = JSON.parse(stdout);
  release.schemaVersion = 3;
  release.$schema = '../schemas/controller-release.v3.schema.json';
  release.version = '0.2.0-draft.67';
  release.dependencies.architecture.repositoryId = 1380894616;
  release.dependencies.primitives.repository = 'agentic-delivery-lab/agentic-delivery-agent-customizations';
  release.dependencies.primitives.repositoryId = 1380894656;
  release.compatibility.controllers.unshift({
    version: release.version, commit: release.commit,
    contracts: structuredClone(release.contracts), dependencies: structuredClone(release.dependencies),
  });
  return release;
}

test('v3 binds current native identities and retains exact historical rollback entries', async () => {
  const release = await nativeReleaseFixture();
  const before = structuredClone(release);
  assert.deepEqual(validateControllerRelease(release), { valid: true, errors: [] });
  assert.deepEqual(release, before);
  const prior = release.compatibility.controllers[1];
  assert.equal(controllerPinMatchesRelease(release, {
    controller: { version: prior.version, commit: prior.commit },
    contracts: prior.contracts, dependencies: prior.dependencies,
  }), true);
});

test('v3 rejects wrong or mixed native identities, incomplete pins and unknown fields', async () => {
  for (const mutate of [
    r => { r.dependencies.primitives.repositoryId = '1380894656'; },
    r => { r.dependencies.primitives.repositoryId = 999999; },
    r => { r.dependencies.architecture.repositoryId = 1380894656; },
    r => { delete r.dependencies.architecture.repositoryId; },
    r => { r.dependencies.primitives.repository = 'agentic-delivery-lab/agentic-delivery-primitives'; },
    r => { r.dependencies.primitives.contentSha256 = null; },
    r => { r.dependencies.primitives.unreviewed = true; },
    r => { r.compatibility.controllers[1].dependencies.primitives.repositoryId = 1380894656; },
    r => { r.compatibility.controllers[0].dependencies.primitives.commit = 'f'.repeat(40); },
    r => { r.compatibility.controllers.shift(); },
    r => { r.unreviewed = true; },
    r => { r.schemaVersion = 4; },
  ]) {
    const release = await nativeReleaseFixture();
    mutate(release);
    assert.equal(validateControllerRelease(release).valid, false);
  }
});

test('v3 closed schema preserves legacy contracts and rejects identity-shape mixing', async () => {
  for (const version of [1, 2]) {
    const file = `schemas/controller-release.v${version}.schema.json`;
    const { stdout } = await execFileAsync('git', ['-C', repositoryRoot, 'show', `52d1dea2f6259d365723f90ce01d771da802edc9:${file}`]);
    assert.equal(await readFile(path.join(repositoryRoot, file), 'utf8'), stdout);
  }
  const schema = JSON.parse(await readFile(path.join(repositoryRoot, 'schemas/controller-release.v3.schema.json'), 'utf8'));
  const check = new Ajv2020({ strict: false }).compile(schema);
  const valid = await nativeReleaseFixture();
  assert.equal(check(valid), true, JSON.stringify(check.errors));
  for (const mutate of [
    r => { r.dependencies.primitives.repositoryId = '1380894656'; },
    r => { delete r.dependencies.architecture.repositoryId; },
    r => { r.dependencies.primitives.contentSha256 = null; },
    r => { r.compatibility.controllers[1].dependencies.primitives.repositoryId = 1380894656; },
    r => { r.unreviewed = true; },
  ]) {
    const invalid = structuredClone(valid);
    mutate(invalid);
    assert.equal(check(invalid), false);
  }
});

test('malformed v3 history returns validation errors rather than throwing', async () => {
  const release = await nativeReleaseFixture();
  delete release.version;
  delete release.commit;
  release.compatibility.controllers = [null];
  assert.equal(validateControllerRelease(release).valid, false);
});

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
  assert.equal(release.schemaVersion, 3);
  assert.equal(release.$schema, '../schemas/controller-release.v3.schema.json');
  assert.equal(release.version, '0.2.0-draft.67');
  assert.equal(release.commit, 'bd40269c346aea91fb496ddfef995131e36a7d90');
  assert.match(release.bootstrapCommit, /^[0-9a-f]{40}$/);
  assert.equal(release.githubAppContractVersion, '2.0.0');
  assert.equal(release.compatibility.githubAppContractVersion, '2.0.0');
  assert.deepEqual(release.support.githubAppContractVersions, ['2.0.0']);
  assert.deepEqual(release.support.eventEnvelopeVersions, [1]);
  assert.deepEqual(release.support.lifecycleVersions, ['1.0.0']);
  assert.deepEqual(release.support.stateMachineVersions, ['1.0.0']);
  assert.deepEqual(release.support.evidenceVersions, ['1.0.0']);
  assert.deepEqual(release.support.primitiveCompatibility, ['0.x']);
  assert.deepEqual(release.support.architectureCompatibility, ['0.x']);
  assert.equal(release.support.minimumBootstrapVersion, '0.2.0-draft.67');
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

test('the current runtime retains the receipt fix and removal of native Codex patches', async () => {
  const release = JSON.parse(await readFile(path.join(repositoryRoot, 'config/controller-release.json'), 'utf8'));
  for (const ancestor of ['624e2a462271ddbc536d254ee6147397eba2799f', 'b490540d7b9613c2f6c61cf231c076f6ac65020e']) {
    await execFileAsync('git', ['-C', repositoryRoot, 'merge-base', '--is-ancestor', ancestor, release.commit]);
  }
  const { stdout } = await execFileAsync('git', ['-C', repositoryRoot, 'ls-tree', '-r', '--name-only', release.commit, '--',
    'runtime/codex', 'scripts/prepare-codex-tool-gate.mjs', 'scripts/probe-codex-tool-gate.mjs',
    '.github/workflows/codex-tool-gate-probe.yml']);
  assert.equal(stdout, '', 'the selected runtime must not contain the withdrawn native Codex patch or build probe');
});

test('controller release validation rejects pins missing durable invocation receipt runtime', async (t) => {
  const fixtureContainer = `${repositoryRoot}.worktrees`;
  await mkdir(fixtureContainer, { recursive: true });
  const temporaryRoot = await mkdtemp(path.join(fixtureContainer, 'controller-release-runtime-'));
  t.after(() => rm(temporaryRoot, { recursive: true, force: true }));
  await execFileAsync('git', ['clone', '--quiet', '--shared', '--no-checkout', repositoryRoot, temporaryRoot], { encoding: 'utf8' });
  await mkdir(path.join(temporaryRoot, 'config'), { recursive: true });
  for (const file of ['controller-release.json', 'participants.yml']) {
    await cp(path.join(repositoryRoot, 'config', file), path.join(temporaryRoot, 'config', file));
  }
  const releasePath = path.join(temporaryRoot, 'config', 'controller-release.json');
  const release = JSON.parse(await readFile(releasePath, 'utf8'));
  const current = release.compatibility.controllers.find(pin => pin.version === release.version && pin.commit === release.commit);
  release.commit = '8a2acddf07d0b70b11fc5d9c1f5143e54abf9185';
  current.commit = release.commit;
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
  assert.equal(release.dependencies.architecture.version, '0.1.0-draft.78');
  assert.equal(release.dependencies.architecture.repositoryId, 1380894616);
  assert.equal(release.dependencies.primitives.version, '0.1.0-draft.15');
  assert.equal(release.dependencies.primitives.repositoryId, 1380894656);
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
