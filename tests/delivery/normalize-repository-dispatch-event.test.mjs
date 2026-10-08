import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { promisify } from 'node:util';
import { pathToFileURL } from 'node:url';

import {
  normalizeRepositoryDispatchEvent,
  normalizeRepositoryDispatchEventFile,
} from '../../scripts/normalize-repository-dispatch-event.mjs';
import {
  dispatchEnvelopeSignature,
  invocationEnvelope,
  packRepositoryDispatchClientPayload,
  validateDispatchEnvelopeSignature,
} from '../../scripts/lib/agent-invocation.mjs';
import { validateEventEnvelope } from '../../scripts/lib/control-plane-contracts.mjs';
import { parseRepositoryYaml } from '../../scripts/lib/yaml.mjs';

const repositoryRoot = path.resolve(import.meta.dirname, '../..');
const execFileAsync = promisify(execFile);

function reorderJsonObjects(value) {
  if (Array.isArray(value)) return value.map(reorderJsonObjects);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, reorderJsonObjects(value[key])]));
}

test('signed envelopes survive object-key reordering in repository dispatch transport', () => {
  const secret = 'fixture-dispatch-secret';
  const envelope = invocationEnvelope({
    deliveryId: '12345678-1234-4234-8234-123456789012',
    eventName: 'pull_request', action: 'opened', repositoryId: '1358455028',
    source: { kind: 'pull_request', issue_number: null, pull_request_number: 62, comment_id: null, review_id: null },
    actor: { login: 'fixture-writer', type: 'User' },
    controller: { version: '0.2.0', commit: 'a'.repeat(40) },
    dispatchSecret: secret, dispatchTimestamp: 1789992000000,
  });
  const transported = reorderJsonObjects(JSON.parse(JSON.stringify({ client_payload: packRepositoryDispatchClientPayload(envelope) })));
  const normalized = normalizeRepositoryDispatchEvent(transported);
  assert.equal(JSON.stringify(normalized.client_payload), JSON.stringify(envelope));
  assert.equal(validateDispatchEnvelopeSignature({ secret, envelope: normalized.client_payload, now: 1789992000000 }).valid, true);
});

test('the dispatch normalizer decodes opaque JSON without installed packages and redacts malformed text', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dispatch-standalone-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, 'lib'));
  await copyFile(path.join(repositoryRoot, 'scripts/normalize-repository-dispatch-event.mjs'), path.join(root, 'normalizer.mjs'));
  await copyFile(path.join(repositoryRoot, 'scripts/lib/repository-dispatch-transport.mjs'), path.join(root, 'lib/repository-dispatch-transport.mjs'));
  const envelope = { version: 1, delivery_id: '12345678-1234-4234-8234-123456789012', source: { kind: 'issue', issue_number: 62 } };
  const source = path.join(root, 'event.json');
  const target = path.join(root, 'normalized.json');
  await writeFile(source, JSON.stringify(reorderJsonObjects({ client_payload: packRepositoryDispatchClientPayload(envelope) })));
  await execFileAsync(process.execPath, [path.join(root, 'normalizer.mjs'), source, target], { cwd: root });
  assert.equal(JSON.stringify(JSON.parse(await readFile(target, 'utf8')).client_payload), JSON.stringify(envelope));
  await writeFile(source, JSON.stringify({ client_payload: { envelope: { json: 'PRIVATE-PARSER-MARKER', delivery_id: envelope.delivery_id } } }));
  await assert.rejects(execFileAsync(process.execPath, [path.join(root, 'normalizer.mjs'), source, `${target}.bad`], { cwd: root }), (error) => {
    assert.equal(error.code, 1);
    assert.equal(error.stderr, 'The wrapped repository dispatch envelope is malformed.\n');
    assert.ok(!error.stderr.includes('PRIVATE-PARSER-MARKER'));
    return true;
  });
});

test('normalized event consumers pass the event path at process launch instead of overriding runner defaults', async () => {
  let consumers = 0;
  for (const file of ['issue-intake.yml', 'agent-observation.yml']) {
    const workflow = parseRepositoryYaml(await readFile(path.join(repositoryRoot, '.github/workflows', file), 'utf8'), file);
    for (const job of Object.values(workflow.jobs)) {
      for (const step of job.steps ?? []) {
        const eventPath = step.env?.CONTROLLER_EVENT_PATH ?? step.env?.GITHUB_EVENT_PATH;
        if (!eventPath?.includes('steps.') || !eventPath.includes('event_path')) continue;
        consumers += 1;
        assert.equal(step.env.GITHUB_EVENT_PATH, undefined, `${step.name}: GitHub overwrites this runner default`);
        assert.match(step.run, /^GITHUB_EVENT_PATH="\$CONTROLLER_EVENT_PATH" /);
        assert.match(step.run, / node /);
        for (const variable of ['GITHUB_EVENT_NAME', 'GITHUB_TRIGGERING_ACTOR']) {
          assert.equal(step.env[variable], undefined, `${step.name}: reserved runner variable ${variable}`);
        }
      }
    }
  }
  assert.equal(consumers, 5);
  const delivery = parseRepositoryYaml(await readFile(path.join(repositoryRoot, '.github/workflows/codex-delivery.yml'), 'utf8'), 'codex delivery');
  const job = delivery.jobs.deliver;
  assert.equal(job.env.GITHUB_EVENT_NAME, undefined);
  assert.equal(job.env.GITHUB_TRIGGERING_ACTOR, undefined);
  assert.match(job.env.CONTROLLER_EVENT_NAME, /inputs.invocation_event_name/);
  assert.match(job.env.CONTROLLER_TRIGGERING_ACTOR, /inputs.invocation_actor/);
  for (const name of ['resolve', 'deliver']) {
    const steps = delivery.jobs[name].steps;
    const boundary = steps.find((step) => step.name === 'Check out dispatch normalization boundary');
    const normalizer = steps.find((step) => step.id === 'normalized-event');
    assert.equal(boundary.with.ref, '${{ github.sha }}');
    assert.equal(boundary.with['persist-credentials'], false);
    assert.equal(normalizer.if, "${{ github.event_name == 'repository_dispatch' }}");
    assert.match(normalizer.run, /node dispatch-boundary\/scripts\/normalize-repository-dispatch-event.mjs/);
    const reader = steps.find((step) => step.id === 'participant-policy' || step.name === 'Run source issue delivery');
    assert.match(reader.env.EVENT_PAYLOAD_PATH ?? reader.env.CONTROLLER_EVENT_PATH, /steps.normalized-event.outputs.event_path/);
    assert.ok(steps.indexOf(normalizer) < steps.indexOf(reader));
  }
  const launch = job.steps.find((step) => step.name === 'Run source issue delivery');
  assert.equal(launch.run, 'GITHUB_EVENT_PATH="$CONTROLLER_EVENT_PATH" GITHUB_EVENT_NAME="$CONTROLLER_EVENT_NAME" GITHUB_TRIGGERING_ACTOR="$CONTROLLER_TRIGGERING_ACTOR" node scripts/codex-delivery.mjs');
});

test('workflow launch assignments replace runner event defaults for the reader process', { skip: process.platform === 'win32' }, async () => {
  const workflow = parseRepositoryYaml(await readFile(path.join(repositoryRoot, '.github/workflows/issue-intake.yml'), 'utf8'), 'issue intake');
  const step = workflow.jobs.classify.steps.find((item) => item.name === 'Reason about and validate issue routing');
  const assignments = step.run.slice(0, step.run.indexOf('node '));
  const script = `${assignments} "${process.execPath}" -e 'process.stdout.write(JSON.stringify([process.env.GITHUB_EVENT_PATH, process.env.GITHUB_EVENT_NAME, process.env.GITHUB_TRIGGERING_ACTOR]))'`;
  const { stdout } = await execFileAsync('sh', ['-c', script], {
    env: {
      ...process.env,
      GITHUB_EVENT_PATH: '/runner/original-wrapped.json',
      GITHUB_EVENT_NAME: 'repository_dispatch',
      GITHUB_TRIGGERING_ACTOR: 'dispatch-app[bot]',
      CONTROLLER_EVENT_PATH: '/runner/normalized event.json',
      CONTROLLER_EVENT_NAME: 'issue_comment',
      CONTROLLER_TRIGGERING_ACTOR: 'fixture-writer',
    },
  });
  assert.deepEqual(JSON.parse(stdout), ['/runner/normalized event.json', 'issue_comment', 'fixture-writer']);
});

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
});

test('dispatch normalizer preserves legacy direct events and rejects malformed wrappers', () => {
  const legacy = { client_payload: { version: 1, delivery_id: '12345678-1234-4234-8234-123456789012' } };
  assert.equal(normalizeRepositoryDispatchEvent(legacy), legacy);
  assert.deepEqual(normalizeRepositoryDispatchEvent({ client_payload: { envelope: legacy.client_payload } }), legacy);
  for (const envelope of [
    { json: 'private-invalid-json', delivery_id: '123' },
    { json: '[]', delivery_id: '123' },
    { json: 'null', delivery_id: '123' },
    { json: '{}', delivery_id: '123' },
    { json: '{"delivery_id":"other"}', delivery_id: '123' },
    { json: '{"delivery_id":"123"}', delivery_id: '123', extra: true },
  ]) {
    assert.throws(() => normalizeRepositoryDispatchEvent({ client_payload: { envelope } }), { message: 'The wrapped repository dispatch envelope is malformed.' });
  }
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
  await assert.rejects(normalizeRepositoryDispatchEventFile(sourcePath, targetPath), /EEXIST/);
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
  const policyReader = await import(pathToFileURL(path.join(invocationRoot, 'scripts/lib/resolve-delivery-participant.mjs')).href);
  const deliveryReader = await import(pathToFileURL(path.join(observationRoot, 'scripts/codex-delivery.mjs')).href);
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
      const policy = policyReader.resolveDeliveryParticipant({
        controllerRepository: 'agentic-delivery-lab/agentic-delivery',
        eventName: 'repository_dispatch', githubRef: 'refs/heads/main',
        callerWorkflowRef: 'agentic-delivery-lab/agentic-delivery/.github/workflows/agent-invocation.yml@refs/heads/main',
        route: 'plan', originRepository: invocationParticipant.expectedFullName,
        originRepositoryId: invocationParticipant.repositoryId,
      }, invocationRegistry, normalized);
      assert.equal(policy.controllerCommit, invocationParticipant.controller.commit);
      const deliveryEnv = {
        ORIGIN_REPOSITORY: invocationParticipant.expectedFullName,
        ORIGIN_REPOSITORY_ID: invocationParticipant.repositoryId,
        SOURCE_ISSUE: '62', GITHUB_EVENT_NAME: 'issues', GITHUB_TRIGGERING_ACTOR: 'sjefsharp',
      };
      const originEvent = deliveryReader.normalizeOriginEvent(normalized, deliveryEnv);
      assert.equal(originEvent.action, 'opened');
      assert.equal(originEvent.issue.number, 62);
      assert.equal(deliveryReader.intakeEvent(originEvent, deliveryEnv).issue, '62');
      assert.equal(result.accepted, true);
      assert.equal(result.sourceIssue, '62');
      assert.equal(result.originRepository, invocationParticipant.expectedFullName);
    }
  }
});
