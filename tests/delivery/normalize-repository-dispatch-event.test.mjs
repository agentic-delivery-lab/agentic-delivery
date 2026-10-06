import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { promisify } from 'node:util';
import { pathToFileURL } from 'node:url';

import {
  normalizeRepositoryDispatchEvent,
  normalizeRepositoryDispatchEventFile,
  repositoryDispatchEventShape,
} from '../../scripts/normalize-repository-dispatch-event.mjs';
import {
  dispatchEnvelopeSignature,
  invocationEnvelope,
  packRepositoryDispatchClientPayload,
  validateDispatchEnvelopeSignature,
} from '../../scripts/lib/agent-invocation.mjs';
import { validateEventEnvelope } from '../../scripts/lib/control-plane-contracts.mjs';

const repositoryRoot = path.resolve(import.meta.dirname, '../..');
const execFileAsync = promisify(execFile);

test('dispatch normalizer restores the direct payload shape without changing its envelope', () => {
  const unsignedEnvelope = {
    version: 1,
    delivery_id: '12345678-1234-4234-8234-123456789012',
    repository_id: '1358455028',
    event: 'issue_comment',
    dispatch_timestamp: String(Date.now()),
  };
  const secret = 'dispatch-secret';
  const envelope = {
    ...unsignedEnvelope,
    dispatch_signature: dispatchEnvelopeSignature({ secret, envelope: unsignedEnvelope }),
  };
  const event = {
    repository: { full_name: 'agentic-delivery-lab/agentic-delivery', id: 1358455028 },
    client_payload: packRepositoryDispatchClientPayload(envelope),
  };

  assert.deepEqual(normalizeRepositoryDispatchEvent(event), {
    ...event,
    client_payload: envelope,
  });
  assert.equal(validateDispatchEnvelopeSignature({ secret, envelope, now: Number(envelope.dispatch_timestamp) }).valid, true);

  const shape = repositoryDispatchEventShape(normalizeRepositoryDispatchEvent(event));
  assert.deepEqual(shape.event_keys, ['client_payload', 'repository']);
  assert.deepEqual(shape.client_payload_keys, Object.keys(envelope).sort());
  assert.deepEqual(shape.client_payload_value_types, {
    delivery_id: 'string',
    dispatch_signature: 'string',
    dispatch_timestamp: 'string',
    event: 'string',
    repository_id: 'string',
    version: 'number',
  });
  assert.equal(shape.wrapped_envelope_type, 'missing');
  assert.doesNotMatch(JSON.stringify(shape), /12345678-1234-4234-8234-123456789012|sha256=|dispatch-secret/);
});

test('dispatch shape diagnostics omit arbitrary keys and values', () => {
  const shape = repositoryDispatchEventShape({
    unexpected_root_secret_key: 'root secret value',
    repository: { name: 'private-repository-name' },
    client_payload: {
      envelope: {
        version: 1,
        delivery_id: '12345678-1234-4234-8234-123456789012',
        unexpected_envelope_secret_key: 'nested secret value',
      },
      unexpected_payload_secret_key: 'payload secret value',
    },
  });
  const serialized = JSON.stringify(shape);
  assert.equal(shape.event_unknown_key_count, 1);
  assert.equal(shape.client_payload_unknown_key_count, 1);
  assert.equal(shape.wrapped_envelope_unknown_key_count, 1);
  assert.doesNotMatch(serialized, /unexpected_.*_secret_key|secret value|private-repository-name/);
});

test('dispatch shape diagnostics describe nested client payloads without exposing their values', async (t) => {
  const event = {
    client_payload: {
      client_payload: {
        envelope: {
          version: 1,
          delivery_id: '12345678-1234-4234-8234-123456789012',
          unexpected_nested_secret_key: 'nested secret value',
        },
      },
    },
  };
  const shape = repositoryDispatchEventShape(event);
  assert.deepEqual(shape.client_payload_keys, ['client_payload']);
  assert.deepEqual(shape.nested_client_payload_keys, ['envelope']);
  assert.equal(shape.nested_envelope_type, 'object');
  assert.deepEqual(shape.nested_envelope_keys, ['delivery_id', 'version']);
  assert.equal(shape.nested_envelope_unknown_key_count, 1);
  assert.doesNotMatch(JSON.stringify(shape), /12345678-1234-4234-8234-123456789012|unexpected_nested_secret_key|nested secret value/);

  const root = await mkdtemp(path.join(os.tmpdir(), 'repository-dispatch-shape-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const sourcePath = path.join(root, 'source.json');
  const targetPath = path.join(root, 'normalized.json');
  await writeFile(sourcePath, JSON.stringify(event));
  const { stdout } = await execFileAsync(process.execPath, [
    path.join(repositoryRoot, 'scripts/normalize-repository-dispatch-event.mjs'),
    sourcePath,
    targetPath,
  ], { cwd: repositoryRoot });
  assert.match(stdout, /Repository dispatch source event shape \(values omitted\):/);
  assert.match(stdout, /Repository dispatch normalized event shape \(values omitted\):/);
  assert.match(stdout, /"nested_client_payload_keys":\["envelope"\]/);
  assert.match(stdout, /"nested_envelope_keys":\["delivery_id","version"\]/);
  assert.doesNotMatch(stdout, /12345678-1234-4234-8234-123456789012|unexpected_nested_secret_key|nested secret value/);
});

test('dispatch normalizer preserves legacy direct events and rejects malformed wrappers', () => {
  const legacy = { client_payload: { version: 1, delivery_id: '12345678-1234-4234-8234-123456789012' } };
  assert.equal(normalizeRepositoryDispatchEvent(legacy), legacy);
  assert.throws(
    () => normalizeRepositoryDispatchEvent({ client_payload: { envelope: {}, extra: true } }),
    /wrapped repository dispatch envelope is malformed/,
  );
  assert.throws(
    () => normalizeRepositoryDispatchEvent({ client_payload: { envelope: null } }),
    /wrapped repository dispatch envelope is malformed/,
  );
});

test('dispatch normalizer writes a separate event file for pinned readers', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'agentic-delivery-dispatch-normalizer-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const sourcePath = path.join(root, 'source.json');
  const targetPath = path.join(root, 'normalized.json');
  const cliTargetPath = path.join(root, 'normalized-cli.json');
  const unsignedEnvelope = {
    version: 1,
    delivery_id: '12345678-1234-4234-8234-123456789012',
    repository_id: '1358455028',
    dispatch_timestamp: String(Date.now()),
  };
  const secret = 'dispatch-secret';
  const envelope = {
    ...unsignedEnvelope,
    dispatch_signature: dispatchEnvelopeSignature({ secret, envelope: unsignedEnvelope }),
  };
  const event = { client_payload: packRepositoryDispatchClientPayload(envelope) };
  await writeFile(sourcePath, JSON.stringify(event));

  assert.equal(await normalizeRepositoryDispatchEventFile(sourcePath, targetPath), targetPath);
  assert.deepEqual(JSON.parse(await readFile(sourcePath, 'utf8')), event);
  const normalized = JSON.parse(await readFile(targetPath, 'utf8'));
  assert.deepEqual(normalized, { client_payload: envelope });
  assert.equal(validateDispatchEnvelopeSignature({ secret, envelope: normalized.client_payload, now: Number(envelope.dispatch_timestamp) }).valid, true);
  await assert.rejects(
    normalizeRepositoryDispatchEventFile(sourcePath, targetPath),
    /normalized repository dispatch event file could not be written/,
  );

  const { stdout } = await execFileAsync(process.execPath, [
    path.join(repositoryRoot, 'scripts/normalize-repository-dispatch-event.mjs'),
    sourcePath,
    cliTargetPath,
  ], { cwd: repositoryRoot });
  assert.match(stdout, /Repository dispatch source event shape \(values omitted\):/);
  assert.match(stdout, /"client_payload_keys":\["envelope"\]/);
  assert.match(stdout, /Repository dispatch normalized event shape \(values omitted\):/);
  assert.match(stdout, /"delivery_id":"string"/);
  assert.doesNotMatch(stdout, /12345678-1234-4234-8234-123456789012|sha256=|dispatch-secret/);
});

test('dispatch CLI logs a safe source shape before rejecting a malformed wrapper', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'repository-dispatch-malformed-wrapper-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const sourcePath = path.join(root, 'source.json');
  const targetPath = path.join(root, 'normalized.json');
  await writeFile(sourcePath, JSON.stringify({
    client_payload: {
      envelope: { delivery_id: 'sensitive-delivery-id', hidden_key: 'private-payload-value' },
      extra: 'another-private-value',
    },
  }));

  let failure;
  try {
    await execFileAsync(process.execPath, [
      path.join(repositoryRoot, 'scripts/normalize-repository-dispatch-event.mjs'),
      sourcePath,
      targetPath,
    ], { cwd: repositoryRoot });
  } catch (error) {
    failure = error;
  }

  assert.ok(failure, 'the malformed wrapper should fail normalization');
  assert.equal(failure.code, 1);
  assert.match(failure.stdout, /Repository dispatch source event shape \(values omitted\):/);
  assert.match(failure.stderr, /wrapped repository dispatch envelope is malformed/);
  assert.doesNotMatch(`${failure.stdout}${failure.stderr}`, /sensitive-delivery-id|private-payload-value|another-private-value|hidden_key/);
});

test('dispatch CLI suppresses parser excerpts for malformed JSON', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'repository-dispatch-invalid-json-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const sourcePath = path.join(root, 'source.json');
  const targetPath = path.join(root, 'normalized.json');
  await writeFile(sourcePath, '{"client_payload":{"secret_marker":"parser-excerpt-sensitive-value","bad":}}');

  let failure;
  try {
    await execFileAsync(process.execPath, [
      path.join(repositoryRoot, 'scripts/normalize-repository-dispatch-event.mjs'),
      sourcePath,
      targetPath,
    ], { cwd: repositoryRoot });
  } catch (error) {
    failure = error;
  }

  assert.ok(failure, 'invalid JSON should fail normalization');
  assert.equal(failure.code, 1);
  assert.match(failure.stderr, /source event is not valid JSON/);
  assert.doesNotMatch(`${failure.stdout}${failure.stderr}`, /parser-excerpt-sensitive-value|secret_marker/);
});

test('normalized events pass invocation, observation, and finalizer readers at their immutable pins', async (t) => {
  const release = JSON.parse(await readFile(path.join(repositoryRoot, 'config/controller-release.json'), 'utf8'));
  const workspace = await mkdtemp(path.join(repositoryRoot, '.rdr-'));
  const invocationRoot = path.join(workspace, 'invocation');
  const observationRoot = path.join(workspace, 'observation');
  const worktrees = [];
  t.after(async () => {
    let cleanupError;
    for (const worktree of worktrees.reverse()) {
      try {
        await execFileAsync('git', ['worktree', 'remove', '--force', worktree], { cwd: repositoryRoot });
      } catch (error) {
        cleanupError ??= error;
      }
    }
    await rm(workspace, { recursive: true, force: true });
    if (cleanupError) throw cleanupError;
  });
  await execFileAsync('git', ['worktree', 'add', '--detach', invocationRoot, release.bootstrapCommit], { cwd: repositoryRoot });
  worktrees.push(invocationRoot);
  await execFileAsync('git', ['worktree', 'add', '--detach', observationRoot, release.commit], { cwd: repositoryRoot });
  worktrees.push(observationRoot);

  const invocationReader = await import(pathToFileURL(path.join(invocationRoot, 'scripts/prepare-agent-invocation.mjs')).href);
  const invocationRegistryReader = await import(pathToFileURL(path.join(invocationRoot, 'scripts/lib/participant-registry.mjs')).href);
  const finalizerReader = await import(pathToFileURL(path.join(observationRoot, 'scripts/finalize-agent-invocation.mjs')).href);
  const observationReader = await import(pathToFileURL(path.join(observationRoot, 'scripts/validate-observation-event.mjs')).href);
  const observationRegistryReader = await import(pathToFileURL(path.join(observationRoot, 'scripts/lib/participant-registry.mjs')).href);
  const invocationRegistry = await invocationRegistryReader.loadParticipantRegistry(invocationRoot);
  const observationRegistry = await observationRegistryReader.loadParticipantRegistry(observationRoot);
  assert.equal(invocationRegistry.valid, true);
  assert.equal(observationRegistry.valid, true);
  const invocationParticipant = invocationRegistryReader.participantForRepository(invocationRegistry, '1358455028');
  const observationParticipant = observationRegistryReader.participantForRepository(observationRegistry, '1358455028');
  const secret = 'dispatch-secret';
  const cases = [
    {
      reader: 'invocation',
      controller: invocationParticipant.controller,
      eventName: 'issues',
      action: 'opened',
      source: { kind: 'issue', issue_number: 62, pull_request_number: null, comment_id: null, review_id: null },
      actor: { login: 'sjefsharp', type: 'User' },
      body: 'Canary issue event',
    },
    {
      reader: 'finalizer',
      controller: invocationParticipant.controller,
      eventName: 'issues',
      action: 'opened',
      source: { kind: 'issue', issue_number: 62, pull_request_number: null, comment_id: null, review_id: null },
      actor: { login: 'sjefsharp', type: 'User' },
      body: 'Canary issue event',
    },
    {
      reader: 'observation',
      controller: observationParticipant.controller,
      eventName: 'pull_request',
      action: 'synchronize',
      source: { kind: 'pull_request', issue_number: null, pull_request_number: 27, comment_id: null, review_id: null },
      actor: { login: 'external-contributor', type: 'User' },
      body: 'Pull request observation',
    },
  ];

  for (const [index, fields] of cases.entries()) {
    const dispatchTimestamp = Date.now();
    const envelope = invocationEnvelope({
      deliveryId: `${index + 1}2345678-1234-4234-8234-123456789012`,
      repositoryId: '1358455028',
      organizationId: '327861320',
      installationId: '163255060',
      repositoryFullName: 'agentic-delivery-lab/agentic-delivery',
      receivedAt: new Date().toISOString(),
      dispatchSecret: secret,
      dispatchTimestamp,
      ...fields,
    });
    const sourcePath = path.join(workspace, `${fields.reader}-source.json`);
    const normalizedPath = path.join(workspace, `${fields.reader}-normalized.json`);
    await writeFile(sourcePath, JSON.stringify({
      repository: { full_name: 'agentic-delivery-lab/agentic-delivery', id: 1358455028 },
      client_payload: packRepositoryDispatchClientPayload(envelope),
    }));
    await normalizeRepositoryDispatchEventFile(sourcePath, normalizedPath);
    const normalized = JSON.parse(await readFile(normalizedPath, 'utf8'));
    assert.deepEqual(validateEventEnvelope(normalized.client_payload), { valid: true, errors: [] });
    assert.equal(validateDispatchEnvelopeSignature({
      secret,
      envelope: normalized.client_payload,
      now: dispatchTimestamp,
    }).valid, true);
    assert.equal(normalized.client_payload.event, fields.eventName);
    assert.equal(normalized.client_payload.delivery_id, envelope.delivery_id);

    if (fields.reader === 'observation') {
      const result = await observationReader.validateObservationEvent({
        eventPath: normalizedPath,
        repositoryRoot: observationRoot,
        controllerRepository: 'agentic-delivery-lab/agentic-delivery',
        dispatchSecret: secret,
        now: () => dispatchTimestamp,
      });
      assert.equal(result.status, 'passed');
      assert.equal(result.controller.commit, observationParticipant.controller.commit);
    } else if (fields.reader === 'finalizer') {
      const finalized = [];
      const store = {
        completeController: async (key, options) => finalized.push({ outcome: 'completed', key, ...options }),
        retryController: async (key, options) => finalized.push({ outcome: 'retryable', key, ...options }),
      };
      for (const [resultName, expectedStatus] of [['success', 'completed'], ['failure', 'retryable']]) {
        const result = await finalizerReader.finalizeAgentInvocation({
          env: {
            GITHUB_EVENT_PATH: normalizedPath,
            INVOCATION_RESULT: resultName,
            GITHUB_RUN_ID: '123456',
            GITHUB_RUN_ATTEMPT: '1',
          },
          store,
        });
        assert.deepEqual(result, { status: expectedStatus });
      }
      assert.equal(finalized.length, 2);
      assert.equal(finalized[0].key, `${envelope.installation_id}:${envelope.delivery_id}`);
      assert.equal(finalized[0].leaseToken, '123456:1');
      assert.equal(finalized[1].key, finalized[0].key);
      assert.equal(finalized[1].leaseToken, finalized[0].leaseToken);
    } else {
      const result = await invocationReader.prepareAgentInvocation({
        env: {
          GH_TOKEN: 'fixture-token',
          GITHUB_EVENT_PATH: normalizedPath,
          GITHUB_REPOSITORY: 'agentic-delivery-lab/agentic-delivery',
          CODEX_DELIVERY_DISPATCH_SECRET: secret,
          RUNNER_TEMP: workspace,
          GITHUB_RUN_ID: '123456',
          GITHUB_JOB: 'intake',
          GITHUB_RUN_ATTEMPT: '1',
        },
        participantRegistry: invocationRegistry,
        replayStore: {
          ensureControllerReceipt: async () => undefined,
          claimController: async () => ({ status: 'claimed' }),
        },
        fetchImpl: async (request) => {
          const requestPath = new URL(String(request)).pathname;
          if (requestPath.endsWith('/collaborators/sjefsharp/permission')) {
            return new Response(JSON.stringify({ permission: 'write' }), { status: 200 });
          }
          throw new Error(`Unexpected pinned invocation request: ${requestPath}`);
        },
        now: () => dispatchTimestamp,
      });
      assert.equal(result.accepted, true);
      assert.equal(result.sourceIssue, '62');
      assert.equal(result.originRepository, invocationParticipant.expectedFullName);
    }
  }
});
