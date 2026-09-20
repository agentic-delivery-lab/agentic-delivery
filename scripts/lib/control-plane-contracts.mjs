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
const SOURCE_KINDS = new Set([
  'issue',
  'issue_comment',
  'pull_request_comment',
  'pull_request_review',
  'pull_request_review_comment',
]);

function addError(errors, path, message) {
  errors.push(`${path} ${message}`);
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

export { DELIVERY_ID, REPOSITORY_ID, SHA256 };
