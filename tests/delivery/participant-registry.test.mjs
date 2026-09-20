import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  authorizeParticipation,
  parseParticipantRegistry,
  participantForRepository,
} from '../../scripts/lib/participant-registry.mjs';

const repositoryId = '1358455028';
const validEntry = {
  expectedFullName: 'agentic-delivery-lab/agentic-delivery',
  mode: 'shadow',
  controller: {
    version: '0.1.0',
    commit: '0123456789abcdef0123456789abcdef01234567',
  },
  contracts: {
    eventEnvelope: 1,
    lifecycle: '1.0.0',
    stateMachine: '1.0.0',
    evidence: '1.0.0',
  },
  configurationProfile: 'standard',
  events: ['issues', 'issue_comment'],
  localIntegration: {
    workflowBundle: 'none',
    managedByApp: false,
  },
};

function validRegistry() {
  return {
    version: 1,
    organization: 'agentic-delivery-lab',
    repositories: { [repositoryId]: structuredClone(validEntry) },
  };
}

test('accepts a participant registry with immutable controller and contract pins', () => {
  const result = parseParticipantRegistry(validRegistry());

  assert.equal(result.valid, true, result.errors.join('\n'));
  assert.equal(result.participants.get(repositoryId).repositoryId, repositoryId);
  assert.equal(result.participants.get(repositoryId).controller.commit.length, 40);
});

test('rejects malformed identities, modes, pins, contracts, and event catalogs', () => {
  const registry = validRegistry();
  registry.organization = 'other-org';
  registry.repositories[repositoryId].mode = 'enabled';
  registry.repositories[repositoryId].expectedFullName = 'other-org/repo';
  registry.repositories[repositoryId].controller.commit = 'main';
  registry.repositories[repositoryId].contracts.lifecycle = 'latest';
  registry.repositories[repositoryId].events = ['unknown-event'];

  const result = parseParticipantRegistry(registry);

  assert.equal(result.valid, false);
  for (const phrase of [
    'organization must be agentic-delivery-lab',
    'mode must be one of disabled, shadow, active',
    'expectedFullName must belong to agentic-delivery-lab',
    'controller.commit must be a 40-character hexadecimal SHA',
    'contracts.lifecycle must use SemVer',
    'events contains unsupported event name unknown-event',
  ]) assert.ok(result.errors.some((error) => error.includes(phrase)), phrase);
});

test('requires both App repository access and registry enrollment', () => {
  const registry = parseParticipantRegistry(validRegistry());
  const enrolled = authorizeParticipation({
    registry,
    repositoryId,
    repositoryFullName: validEntry.expectedFullName,
    appRepositoryIds: [repositoryId],
  });
  assert.equal(enrolled.allowed, true);

  const tokenVerified = authorizeParticipation({
    registry,
    repositoryId,
    repositoryFullName: validEntry.expectedFullName,
    appAccessVerified: true,
  });
  assert.equal(tokenVerified.allowed, true);

  const noAppAccess = authorizeParticipation({
    registry,
    repositoryId,
    repositoryFullName: validEntry.expectedFullName,
    appRepositoryIds: [],
  });
  assert.equal(noAppAccess.allowed, false);
  assert.match(noAppAccess.reason, /App installation access/);

  const notEnrolled = authorizeParticipation({
    registry,
    repositoryId: '999999',
    repositoryFullName: 'agentic-delivery-lab/other',
    appRepositoryIds: ['999999'],
  });
  assert.equal(notEnrolled.allowed, false);
  assert.match(notEnrolled.reason, /participant registry/);
});

test('keeps repository ID authoritative and rejects rename or disabled mismatches', () => {
  const renamed = validRegistry();
  renamed.repositories[repositoryId].expectedFullName = 'agentic-delivery-lab/renamed';
  const registry = parseParticipantRegistry(renamed);
  const renameMismatch = authorizeParticipation({
    registry,
    repositoryId,
    repositoryFullName: validEntry.expectedFullName,
    appRepositoryIds: [repositoryId],
  });
  assert.equal(renameMismatch.allowed, false);
  assert.match(renameMismatch.reason, /does not match the participant registry/);

  const disabled = validRegistry();
  disabled.repositories[repositoryId].mode = 'disabled';
  const disabledRegistry = parseParticipantRegistry(disabled);
  const disabledResult = authorizeParticipation({
    registry: disabledRegistry,
    repositoryId,
    repositoryFullName: validEntry.expectedFullName,
    appRepositoryIds: [repositoryId],
  });
  assert.equal(disabledResult.allowed, false);
  assert.match(disabledResult.reason, /mode is disabled/);
});

test('returns an enrolled participant by numeric repository identity', () => {
  const registry = parseParticipantRegistry(validRegistry());
  assert.equal(participantForRepository(registry, repositoryId).expectedFullName, validEntry.expectedFullName);
  assert.equal(participantForRepository(registry, 1358455028).repositoryId, repositoryId);
  assert.equal(participantForRepository(registry, '404'), null);
});
