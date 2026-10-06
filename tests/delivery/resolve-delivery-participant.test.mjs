import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';

import { parseRepositoryYaml } from '../../scripts/lib/yaml.mjs';
import { packRepositoryDispatchClientPayload } from '../../scripts/lib/agent-invocation.mjs';
import { parseParticipantRegistry } from '../../scripts/lib/participant-registry.mjs';
import { resolveDeliveryParticipant } from '../../scripts/lib/resolve-delivery-participant.mjs';

const repositoryRoot = path.resolve(import.meta.dirname, '../..');

async function participantRegistry() {
  const source = await readFile(path.join(repositoryRoot, 'config/participants.yml'), 'utf8');
  return parseParticipantRegistry(parseRepositoryYaml(source, 'participant registry'));
}

function context(overrides = {}) {
  return {
    controllerRepository: 'agentic-delivery-lab/agentic-delivery',
    eventName: 'issues',
    githubRef: 'refs/heads/main',
    callerWorkflowRef: 'agentic-delivery-lab/agentic-delivery/.github/workflows/issue-intake.yml@refs/heads/main',
    route: 'plan',
    originRepository: 'agentic-delivery-lab/agentic-delivery',
    originRepositoryId: '1358455028',
    eventRepository: 'agentic-delivery-lab/agentic-delivery',
    eventRepositoryId: '1358455028',
    ...overrides,
  };
}

test('delivery policy derives mode, controller pin, and read-only status from the trusted registry', async () => {
  const registry = await participantRegistry();
  const result = resolveDeliveryParticipant(context(), registry, {
    repository: { full_name: 'agentic-delivery-lab/agentic-delivery', id: 1358455028 },
  });
  const participant = registry.participants.get('1358455028');
  assert.deepEqual(result, {
    participantMode: participant.mode,
    controllerCommit: participant.controller.commit,
    readOnlyRun: participant.mode === 'shadow',
  });
});

test('an active registry participant resolves as writable and a manual override can only restrict the run', async () => {
  const registry = await participantRegistry();
  const repositoryId = '1358455028';
  const participant = registry.participants.get(repositoryId);
  registry.participants.set(repositoryId, { ...participant, mode: 'active' });
  const event = { repository: { full_name: 'agentic-delivery-lab/agentic-delivery', id: 1358455028 } };

  assert.deepEqual(resolveDeliveryParticipant(context(), registry, event), {
    participantMode: 'active',
    controllerCommit: participant.controller.commit,
    readOnlyRun: false,
  });

  const manualContext = context({
    eventName: 'workflow_dispatch',
    route: '',
    callerWorkflowRef: 'agentic-delivery-lab/agentic-delivery/.github/workflows/codex-delivery.yml@refs/heads/main',
    forceReadOnly: true,
  });
  assert.deepEqual(resolveDeliveryParticipant(manualContext, registry, event), {
    participantMode: 'active',
    controllerCommit: participant.controller.commit,
    readOnlyRun: true,
  });
  assert.equal(resolveDeliveryParticipant({ ...manualContext, forceReadOnly: false }, registry, event).readOnlyRun, false);
});

test('delivery policy rejects forged caller mode, controller pin, or read-only inputs', async () => {
  const registry = await participantRegistry();
  for (const forged of [
    { participantMode: 'active' },
    { controllerCommit: 'a'.repeat(40) },
    { readOnlyRun: false },
  ]) {
    assert.throws(
      () => resolveDeliveryParticipant(context(forged), registry, {
        repository: { full_name: 'agentic-delivery-lab/agentic-delivery', id: 1358455028 },
      }),
      /Caller-supplied .* is not an accepted delivery input/,
    );
  }
});

test('delivery policy rejects an unregistered caller or source identity', async () => {
  const registry = await participantRegistry();
  const event = { repository: { full_name: 'agentic-delivery-lab/agentic-delivery', id: 1358455028 } };
  assert.throws(
    () => resolveDeliveryParticipant(context({ callerWorkflowRef: 'attacker/workflow.yml@refs/heads/main' }), registry, event),
    /may be called only by the central/,
  );
  assert.throws(
    () => resolveDeliveryParticipant(context({ originRepositoryId: '1380894616' }), registry, event),
    /does not match the triggering event/,
  );
});

test('dispatch envelope identity and controller pin must match the registry selection', async () => {
  const registry = await participantRegistry();
  const participant = registry.participants.get('1358455028');
  const dispatchContext = context({
    eventName: 'repository_dispatch',
    callerWorkflowRef: 'agentic-delivery-lab/agentic-delivery/.github/workflows/agent-invocation.yml@refs/heads/main',
    eventRepository: 'agentic-delivery-lab/agentic-delivery',
    eventRepositoryId: '1358455028',
  });
  const validEvent = {
    repository: { full_name: 'agentic-delivery-lab/agentic-delivery' },
    client_payload: packRepositoryDispatchClientPayload({
      repository_id: '1358455028',
      repository_full_name: participant.expectedFullName,
      controller: { version: participant.controller.version, commit: participant.controller.commit },
    }),
  };
  assert.equal(resolveDeliveryParticipant(dispatchContext, registry, validEvent).controllerCommit, participant.controller.commit);
  assert.throws(
    () => resolveDeliveryParticipant(dispatchContext, registry, {
      ...validEvent,
      client_payload: packRepositoryDispatchClientPayload({
        ...validEvent.client_payload.envelope,
        controller: { ...validEvent.client_payload.envelope.controller, commit: 'a'.repeat(40) },
      }),
    }),
    /dispatch controller pin does not match/,
  );
});

test('manual read-only defaults fail closed when missing and cannot promote a shadow participant', async () => {
  const registry = await participantRegistry();
  const manualContext = context({
    eventName: 'workflow_dispatch',
    route: '',
    callerWorkflowRef: 'agentic-delivery-lab/agentic-delivery/.github/workflows/codex-delivery.yml@refs/heads/main',
  });
  const event = { repository: { full_name: 'agentic-delivery-lab/agentic-delivery', id: 1358455028 } };
  assert.throws(() => resolveDeliveryParticipant(manualContext, registry, event), /must be true or false/);
  assert.equal(resolveDeliveryParticipant({ ...manualContext, forceReadOnly: false }, registry, event).readOnlyRun, true);
});
