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
  const launch = job.steps.find((step) => step.name === 'Run source issue delivery');
  assert.equal(launch.run, 'GITHUB_EVENT_NAME="$CONTROLLER_EVENT_NAME" GITHUB_TRIGGERING_ACTOR="$CONTROLLER_TRIGGERING_ACTOR" node scripts/codex-delivery.mjs');
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
