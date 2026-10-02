import assert from 'node:assert/strict';
import { test } from 'node:test';

import { resolveIntakePolicy } from '../../scripts/lib/intake-policy.mjs';

test('participant mode and the per-run read-only override stay independent across intake paths', () => {
  const cases = [
    {
      name: 'direct active participant on an issue event',
      input: {
        eventName: 'issues', agentInvocation: false,
        registryParticipantMode: 'active', invocationParticipantMode: 'shadow', forceReadOnly: false,
      },
      expected: { participantMode: 'active', readOnlyRun: false },
    },
    {
      name: 'direct shadow participant ignores a false override',
      input: {
        eventName: 'issues', agentInvocation: false,
        registryParticipantMode: 'shadow', invocationParticipantMode: 'active', forceReadOnly: false,
      },
      expected: { participantMode: 'shadow', readOnlyRun: true },
    },
    {
      name: 'validated invocation uses its envelope mode instead of the direct registry value',
      input: {
        eventName: 'repository_dispatch', agentInvocation: true,
        registryParticipantMode: 'shadow', invocationParticipantMode: 'active', forceReadOnly: false,
      },
      expected: { participantMode: 'active', readOnlyRun: false },
    },
    {
      name: 'validated shadow invocation remains read-only',
      input: {
        eventName: 'issue_comment', agentInvocation: 'true',
        registryParticipantMode: 'active', invocationParticipantMode: 'shadow', forceReadOnly: false,
      },
      expected: { participantMode: 'shadow', readOnlyRun: true },
    },
    {
      name: 'manual active run can request a per-run read-only override',
      input: {
        eventName: 'workflow_dispatch', agentInvocation: false,
        registryParticipantMode: 'active', forceReadOnly: 'true',
      },
      expected: { participantMode: 'active', readOnlyRun: true },
    },
    {
      name: 'manual false override leaves an active participant active',
      input: {
        eventName: 'workflow_dispatch', agentInvocation: false,
        registryParticipantMode: 'active', forceReadOnly: false,
      },
      expected: { participantMode: 'active', readOnlyRun: false },
    },
    {
      name: 'manual false override cannot promote a shadow participant',
      input: {
        eventName: 'workflow_dispatch', agentInvocation: false,
        registryParticipantMode: 'shadow', forceReadOnly: false,
      },
      expected: { participantMode: 'shadow', readOnlyRun: true },
    },
    {
      name: 'a read-only request on a non-manual event does not change participant mode',
      input: {
        eventName: 'issues', agentInvocation: false,
        registryParticipantMode: 'active', forceReadOnly: true,
      },
      expected: { participantMode: 'active', readOnlyRun: false },
    },
  ];

  for (const { name, input, expected } of cases) {
    assert.deepEqual(resolveIntakePolicy(input), expected, name);
  }
});

test('intake policy fails closed on missing modes and malformed booleans', () => {
  assert.throws(() => resolveIntakePolicy({ eventName: 'issues' }), /participant mode must be active or shadow/);
  assert.throws(() => resolveIntakePolicy({
    eventName: 'repository_dispatch', agentInvocation: true, invocationParticipantMode: 'disabled',
  }), /participant mode must be active or shadow/);
  assert.throws(() => resolveIntakePolicy({
    eventName: 'workflow_dispatch', registryParticipantMode: 'active', forceReadOnly: 'yes',
  }), /force_read_only must be true or false/);
});
