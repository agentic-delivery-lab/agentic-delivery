// agentic-primitive: {"id":"control-plane-contract-validator","kind":"validator","enforcement":"deterministic","adrs":["ADR-0018"],"domains":["agentic-delivery-control-plane"]}
import { invocationEventSupported } from './agent-invocation.mjs';

export const EVENT_ENVELOPE_VERSION = 1;
export const CONTRACT_VERSIONS = Object.freeze({
  eventEnvelope: EVENT_ENVELOPE_VERSION,
  lifecycle: '1.0.0',
  stateMachine: '1.0.0',
  evidence: '1.0.0',
});

const DELIVERY_ID = /^[0-9a-f-]{20,}$/i;
const REPOSITORY_ID = /^[1-9][0-9]*$/;
const LOGIN = /^[A-Za-z0-9_.\[\]-]+$/;
const SHA256 = /^[0-9a-f]{64}$/i;
const SHA1 = /^[0-9a-f]{40}$/i;
const SEMVER = /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
const SOURCE_KINDS = new Set([
  'issue',
  'issue_comment',
  'pull_request_comment',
  'pull_request_review',
  'pull_request_review_comment',
]);
const ARTIFACT_REPOSITORIES = Object.freeze({
  architecture: 'agentic-delivery-lab/agentic-delivery-architecture',
  primitives: 'agentic-delivery-lab/agentic-delivery-primitives',
});

function addError(errors, path, message) {
  errors.push(`${path} ${message}`);
}

function validateArtifactPin(pin, path, expectedRepository, errors) {
  if (!pin || typeof pin !== 'object' || Array.isArray(pin)) {
    addError(errors, path, 'must be an object');
    return;
  }
  if (pin.repository !== expectedRepository) addError(errors, `${path}.repository`, `must be ${expectedRepository}`);
  if (typeof pin.version !== 'string' || !SEMVER.test(pin.version)) addError(errors, `${path}.version`, 'must use SemVer');
  if (typeof pin.commit !== 'string' || !SHA1.test(pin.commit)) addError(errors, `${path}.commit`, 'must be a 40-character hexadecimal SHA');
  if (pin.contentSha256 !== null && (typeof pin.contentSha256 !== 'string' || !SHA256.test(pin.contentSha256))) addError(errors, `${path}.contentSha256`, 'must be a SHA-256 digest or null');
}

function validateDependencies(dependencies, path, errors) {
  if (!dependencies || typeof dependencies !== 'object' || Array.isArray(dependencies)) {
    addError(errors, path, 'must be an object');
    return;
  }
  for (const [name, repository] of Object.entries(ARTIFACT_REPOSITORIES)) validateArtifactPin(dependencies[name], `${path}.${name}`, repository, errors);
}

function validIssueNumber(value) {
  return Number.isSafeInteger(value) && value > 0;
}

function validNullableIssueNumber(value) {
  return value === null || validIssueNumber(value);
}

function validateSource(source, event, errors) {
  if (!source || typeof source !== 'object' || Array.isArray(source)) {
    addError(errors, 'source', 'must be an object');
    return;
  }
  if (!SOURCE_KINDS.has(source.kind)) addError(errors, 'source.kind', 'is unsupported');
  if (!validNullableIssueNumber(source.issue_number)) addError(errors, 'source.issue_number', 'must be a positive integer or null');
  if (!validNullableIssueNumber(source.pull_request_number)) addError(errors, 'source.pull_request_number', 'must be a positive integer or null');
  if (!validNullableIssueNumber(source.comment_id)) addError(errors, 'source.comment_id', 'must be a positive integer or null');
  if (!validNullableIssueNumber(source.review_id)) addError(errors, 'source.review_id', 'must be a positive integer or null');

  const expectedKinds = {
    issues: new Set(['issue']),
    issue_comment: new Set(['issue_comment', 'pull_request_comment']),
    pull_request_review: new Set(['pull_request_review']),
    pull_request_review_comment: new Set(['pull_request_review_comment']),
  }[event];
  if (expectedKinds && !expectedKinds.has(source.kind)) addError(errors, 'source.kind', `does not match event ${event}`);
  if (event === 'issues' && !validIssueNumber(source.issue_number)) addError(errors, 'source.issue_number', 'is required for issue events');
  if (event === 'issue_comment' && !validIssueNumber(source.issue_number)) addError(errors, 'source.issue_number', 'is required for issue comments');
  if (['pull_request_review', 'pull_request_review_comment'].includes(event)
    && !validIssueNumber(source.pull_request_number)) addError(errors, 'source.pull_request_number', 'is required for pull-request review events');
}

/**
 * Validate the immutable payload sent from the organization webhook to the
 * central controller. This is deliberately independent of GitHub API calls;
 * the controller must reject malformed identity before it reads or mutates a
 * repository.
 */
export function validateEventEnvelope(envelope) {
  const errors = [];
  if (!envelope || typeof envelope !== 'object' || Array.isArray(envelope)) {
    return { valid: false, errors: ['envelope must be an object'] };
  }
  if (envelope.version !== EVENT_ENVELOPE_VERSION) addError(errors, 'version', `must be ${EVENT_ENVELOPE_VERSION}`);
  if (typeof envelope.delivery_id !== 'string' || !DELIVERY_ID.test(envelope.delivery_id)) {
    addError(errors, 'delivery_id', 'must be a GitHub delivery identifier');
  }
  if (typeof envelope.event !== 'string' || typeof envelope.action !== 'string'
    || !invocationEventSupported(envelope.event, envelope.action)) {
    addError(errors, 'event/action', 'must be a supported invocation event and action');
  }
  if (typeof envelope.repository_id !== 'string' || !REPOSITORY_ID.test(envelope.repository_id)) {
    addError(errors, 'repository_id', 'must be a positive numeric repository ID');
  }
  validateSource(envelope.source, envelope.event, errors);
  if (!envelope.actor || typeof envelope.actor !== 'object' || Array.isArray(envelope.actor)) {
    addError(errors, 'actor', 'must be an object');
  } else {
    if (typeof envelope.actor.login !== 'string' || !LOGIN.test(envelope.actor.login)) addError(errors, 'actor.login', 'must be a valid GitHub login');
    if (typeof envelope.actor.type !== 'string' || envelope.actor.type.length === 0) addError(errors, 'actor.type', 'must be a non-empty string');
  }
  if (!Number.isInteger(envelope.hop) || envelope.hop < 0 || envelope.hop > 1) addError(errors, 'hop', 'must be 0 or 1');
  // Older central-dispatch fixtures omitted this optional-in-practice field.
  // Treat omission as the v1 null value during migration; newly generated
  // envelopes always include it and the published schema requires it.
  if (envelope.parent_delivery_id !== undefined && envelope.parent_delivery_id !== null
    && (typeof envelope.parent_delivery_id !== 'string' || !DELIVERY_ID.test(envelope.parent_delivery_id))) {
    addError(errors, 'parent_delivery_id', 'must be null or a GitHub delivery identifier');
  }
  if (typeof envelope.body_digest !== 'string' || !SHA256.test(envelope.body_digest)) addError(errors, 'body_digest', 'must be a SHA-256 digest');
  if (envelope.controller !== undefined) {
    if (!envelope.controller || typeof envelope.controller !== 'object' || Array.isArray(envelope.controller)) addError(errors, 'controller', 'must be an object');
    else {
      if (typeof envelope.controller.version !== 'string' || !SEMVER.test(envelope.controller.version)) addError(errors, 'controller.version', 'must use SemVer');
      if (typeof envelope.controller.commit !== 'string' || !SHA1.test(envelope.controller.commit)) addError(errors, 'controller.commit', 'must be a 40-character hexadecimal SHA');
    }
  }
  return { valid: errors.length === 0, errors };
}

export function assertEventEnvelope(envelope) {
  const result = validateEventEnvelope(envelope);
  if (!result.valid) {
    const error = new Error(`Invalid event envelope: ${result.errors.join('; ')}`);
    error.code = 'INVALID_EVENT_ENVELOPE';
    error.validation = result;
    throw error;
  }
  return envelope;
}

export function validateControllerRelease(release) {
  const errors = [];
  if (!release || typeof release !== 'object' || Array.isArray(release)) return { valid: false, errors: ['release must be an object'] };
  if (release.schemaVersion !== 1) addError(errors, 'schemaVersion', 'must be 1');
  if (release.controllerId !== 'agentic-delivery') addError(errors, 'controllerId', 'must be agentic-delivery');
  if (typeof release.version !== 'string' || !SEMVER.test(release.version)) addError(errors, 'version', 'must use SemVer');
  if (typeof release.commit !== 'string' || !SHA1.test(release.commit)) addError(errors, 'commit', 'must be a 40-character hexadecimal SHA');
  const contracts = release.contracts;
  if (!contracts || typeof contracts !== 'object' || Array.isArray(contracts)) addError(errors, 'contracts', 'must be an object');
  else {
    if (!Number.isInteger(contracts.eventEnvelope) || contracts.eventEnvelope < 1) addError(errors, 'contracts.eventEnvelope', 'must be a positive integer');
    for (const name of ['lifecycle', 'stateMachine', 'evidence']) {
      if (typeof contracts[name] !== 'string' || !SEMVER.test(contracts[name])) addError(errors, `contracts.${name}`, 'must use SemVer');
    }
  }
  validateDependencies(release.dependencies, 'dependencies', errors);
  if (!release.compatibility || typeof release.compatibility !== 'object' || Array.isArray(release.compatibility)) {
    addError(errors, 'compatibility', 'must be an object');
  } else {
    for (const name of ['eventEnvelope', 'lifecycle', 'stateMachine', 'evidence']) {
      if (name === 'eventEnvelope') {
        if (!Number.isInteger(release.compatibility[name]) || release.compatibility[name] < 1) addError(errors, `compatibility.${name}`, 'must be a positive integer');
      } else if (typeof release.compatibility[name] !== 'string' || !SEMVER.test(release.compatibility[name])) {
        addError(errors, `compatibility.${name}`, 'must use SemVer');
      }
    }
    if (!Array.isArray(release.compatibility.controllers) || release.compatibility.controllers.length === 0) {
      addError(errors, 'compatibility.controllers', 'must contain at least one supported controller pin');
    } else {
      const pins = new Set();
      for (const [index, pin] of release.compatibility.controllers.entries()) {
        if (!pin || typeof pin !== 'object' || Array.isArray(pin)) {
          addError(errors, `compatibility.controllers.${index}`, 'must be an object');
          continue;
        }
        if (typeof pin.version !== 'string' || !SEMVER.test(pin.version)) addError(errors, `compatibility.controllers.${index}.version`, 'must use SemVer');
        if (typeof pin.commit !== 'string' || !SHA1.test(pin.commit)) addError(errors, `compatibility.controllers.${index}.commit`, 'must be a 40-character hexadecimal SHA');
        const identity = `${pin.version}@${pin.commit}`;
        if (pins.has(identity)) addError(errors, `compatibility.controllers.${index}`, 'duplicates a controller pin');
        pins.add(identity);
        const pinContracts = pin.contracts;
        if (!pinContracts || typeof pinContracts !== 'object' || Array.isArray(pinContracts)) addError(errors, `compatibility.controllers.${index}.contracts`, 'must be an object');
        else {
          if (!Number.isInteger(pinContracts.eventEnvelope) || pinContracts.eventEnvelope < 1) addError(errors, `compatibility.controllers.${index}.contracts.eventEnvelope`, 'must be a positive integer');
          for (const name of ['lifecycle', 'stateMachine', 'evidence']) if (typeof pinContracts[name] !== 'string' || !SEMVER.test(pinContracts[name])) addError(errors, `compatibility.controllers.${index}.contracts.${name}`, 'must use SemVer');
        }
        validateDependencies(pin.dependencies, `compatibility.controllers.${index}.dependencies`, errors);
      }
    }
  }
  return { valid: errors.length === 0, errors };
}

export function controllerPinMatchesRelease(release, participant) {
  const expected = participant?.controller;
  const expectedContracts = participant?.contracts;
  const expectedDependencies = participant?.dependencies;
  if (!expected || !expectedContracts || !release?.compatibility?.controllers) return false;
  return release.compatibility.controllers.some((pin) => pin.version === expected.version
    && pin.commit.toLowerCase() === String(expected.commit).toLowerCase()
    && JSON.stringify(pin.contracts) === JSON.stringify(expectedContracts)
    && JSON.stringify(pin.dependencies) === JSON.stringify(expectedDependencies));
}

export { DELIVERY_ID, REPOSITORY_ID, SHA1, SHA256 };
