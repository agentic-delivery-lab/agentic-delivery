// agentic-primitive: {"id":"participant-registry-validator","kind":"validator","enforcement":"deterministic","adrs":["ADR-0018"],"domains":["agentic-delivery-control-plane"]}
import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { parseRepositoryYaml } from './yaml.mjs';

const ORGANIZATION = 'agentic-delivery-lab';
const MODES = new Set(['disabled', 'shadow', 'active']);
const EVENT_NAMES = new Set([
  'issues',
  'issue_comment',
  'pull_request',
  'pull_request_review',
  'pull_request_review_comment',
]);
const REPOSITORY_ID = /^[1-9][0-9]*$/;
const FULL_NAME = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const SHA = /^[0-9a-f]{40}$/i;
const SHA256_OR_NULL = /^(?:[0-9a-f]{64})$/i;
const SEMVER = /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

function addError(errors, pathName, message) {
  errors.push(pathName + ' ' + message);
}

function asRepositoryId(value) {
  const id = String(value ?? '');
  return REPOSITORY_ID.test(id) ? id : null;
}

function validSemVer(value) {
  return typeof value === 'string' && SEMVER.test(value);
}

function validateArtifactPin(pin, prefix, expectedRepository, errors) {
  if (!pin || typeof pin !== 'object' || Array.isArray(pin)) {
    addError(errors, prefix, 'must be an object');
    return;
  }
  if (pin.repository !== expectedRepository) addError(errors, `${prefix}.repository`, `must be ${expectedRepository}`);
  if (!validSemVer(pin.version)) addError(errors, `${prefix}.version`, 'must use SemVer');
  if (!SHA.test(String(pin.commit ?? ''))) addError(errors, `${prefix}.commit`, 'must be a 40-character hexadecimal SHA');
  if (pin.contentSha256 !== null && !SHA256_OR_NULL.test(String(pin.contentSha256 ?? ''))) addError(errors, `${prefix}.contentSha256`, 'must be a SHA-256 digest or null');
}

function normalizeAppRepositoryIds(value) {
  if (value instanceof Set) return new Set([...value].map(asRepositoryId).filter(Boolean));
  if (!Array.isArray(value)) return new Set();
  return new Set(value.map(asRepositoryId).filter(Boolean));
}

function validateEntry(repositoryId, entry, errors) {
  const prefix = 'repositories.' + repositoryId;
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
    addError(errors, prefix, 'must be an object');
    return null;
  }
  const dependencies = entry.dependencies;
  if (!dependencies || typeof dependencies !== 'object' || Array.isArray(dependencies)) {
    addError(errors, prefix + '.dependencies', 'must be an object');
  } else {
    validateArtifactPin(dependencies.architecture, prefix + '.dependencies.architecture', `${ORGANIZATION}/agentic-delivery-architecture`, errors);
    validateArtifactPin(dependencies.primitives, prefix + '.dependencies.primitives', `${ORGANIZATION}/agentic-delivery-primitives`, errors);
  }
  if (entry.mode === undefined || !MODES.has(entry.mode)) {
    addError(errors, prefix + '.mode', 'must be one of disabled, shadow, active');
  }
  if (typeof entry.expectedFullName !== 'string' || !FULL_NAME.test(entry.expectedFullName)) {
    addError(errors, prefix + '.expectedFullName', 'must be a GitHub owner/repository name');
  } else if (!entry.expectedFullName.startsWith(ORGANIZATION + '/')) {
    addError(errors, prefix + '.expectedFullName', 'must belong to ' + ORGANIZATION);
  }
  const controller = entry.controller;
  if (!controller || typeof controller !== 'object' || Array.isArray(controller)) {
    addError(errors, prefix + '.controller', 'must be an object');
  } else {
    if (!validSemVer(controller.version)) addError(errors, prefix + '.controller.version', 'must use SemVer');
    if (!SHA.test(String(controller.commit ?? ''))) addError(errors, prefix + '.controller.commit', 'must be a 40-character hexadecimal SHA');
  }
  const contracts = entry.contracts;
  if (!contracts || typeof contracts !== 'object' || Array.isArray(contracts)) {
    addError(errors, prefix + '.contracts', 'must be an object');
  } else {
    if (!Number.isInteger(contracts.eventEnvelope) || contracts.eventEnvelope < 1) {
      addError(errors, prefix + '.contracts.eventEnvelope', 'must be a positive integer');
    }
    for (const name of ['lifecycle', 'stateMachine', 'evidence']) {
      if (!validSemVer(contracts[name])) addError(errors, prefix + '.contracts.' + name, 'must use SemVer');
    }
  }
  if (typeof entry.configurationProfile !== 'string' || entry.configurationProfile.length === 0) {
    addError(errors, prefix + '.configurationProfile', 'must be a non-empty string');
  }
  if (!Array.isArray(entry.events) || entry.events.length === 0) {
    addError(errors, prefix + '.events', 'must be a non-empty array');
  } else {
    for (const eventName of entry.events) {
      if (!EVENT_NAMES.has(eventName)) addError(errors, prefix + '.events', 'contains unsupported event name ' + eventName);
    }
  }
  const integration = entry.localIntegration;
  if (!integration || typeof integration !== 'object' || Array.isArray(integration)) {
    addError(errors, prefix + '.localIntegration', 'must be an object');
  } else {
    if (typeof integration.workflowBundle !== 'string' || integration.workflowBundle.length === 0) {
      addError(errors, prefix + '.localIntegration.workflowBundle', 'must be a non-empty string');
    }
    if (typeof integration.managedByApp !== 'boolean') {
      addError(errors, prefix + '.localIntegration.managedByApp', 'must be boolean');
    }
  }
  return {
    repositoryId,
    expectedFullName: entry.expectedFullName,
    mode: entry.mode,
    controller: entry.controller,
    contracts: entry.contracts,
    dependencies: entry.dependencies,
    configurationProfile: entry.configurationProfile,
    events: [...(entry.events ?? [])],
    localIntegration: entry.localIntegration,
  };
}

export function parseParticipantRegistry(registry, { organization = ORGANIZATION } = {}) {
  const errors = [];
  if (!registry || typeof registry !== 'object' || Array.isArray(registry)) {
    return { valid: false, errors: ['registry must be an object'], participants: new Map() };
  }
  if (registry.version !== 1) addError(errors, 'version', 'must be 1');
  if (registry.organization !== organization) addError(errors, 'organization', 'must be ' + organization);
  if (!registry.repositories || typeof registry.repositories !== 'object' || Array.isArray(registry.repositories)) {
    addError(errors, 'repositories', 'must be an object keyed by numeric repository ID');
    return { valid: false, errors, participants: new Map() };
  }
  const participants = new Map();
  for (const [rawId, entry] of Object.entries(registry.repositories)) {
    const repositoryId = asRepositoryId(rawId);
    if (!repositoryId) {
      addError(errors, 'repositories.' + rawId, 'key must be a positive numeric repository ID');
      continue;
    }
    participants.set(repositoryId, validateEntry(repositoryId, entry, errors));
  }
  return { valid: errors.length === 0, errors, participants };
}

export async function loadParticipantRegistry(repositoryRoot = process.cwd()) {
  const file = path.join(path.resolve(repositoryRoot), 'config', 'participants.yml');
  const source = await readFile(file, 'utf8');
  return parseParticipantRegistry(parseRepositoryYaml(source, 'participant registry'));
}

export function participantForRepository(registry, repositoryId) {
  const id = asRepositoryId(repositoryId);
  return id ? (registry?.participants?.get(id) ?? null) : null;
}

export function authorizeParticipation({
  registry,
  repositoryId,
  repositoryFullName,
  appRepositoryIds,
  appAccessVerified = false,
} = {}) {
  if (!registry?.valid) return { allowed: false, reason: 'The participant registry is invalid.' };
  const id = asRepositoryId(repositoryId);
  if (!id) return { allowed: false, reason: 'The event repository ID is invalid.' };
  const participant = participantForRepository(registry, id);
  if (!participant) return { allowed: false, reason: 'The repository is not enrolled in the participant registry.' };
  if (participant.mode === 'disabled') return { allowed: false, reason: 'The participant registry mode is disabled.' };
  if (participant.expectedFullName !== repositoryFullName) {
    return { allowed: false, reason: 'The event repository full name does not match the participant registry.' };
  }
  if (!appAccessVerified && !normalizeAppRepositoryIds(appRepositoryIds).has(id)) {
    return { allowed: false, reason: 'The GitHub App installation access does not include the event repository.' };
  }
  return { allowed: true, participant };
}

export { EVENT_NAMES, MODES, ORGANIZATION };
