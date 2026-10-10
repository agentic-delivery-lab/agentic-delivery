// agentic-primitive: {"id":"project-planning-context-selector","kind":"validator","enforcement":"deterministic","adrs":["ADR-0018"],"domains":["agentic-delivery-control-plane"]}

import { createHash } from 'node:crypto';

import { normalizeProjectPlanningInput } from './project-planning-context.mjs';

const PROJECT_READ_STATES = new Set(['granted', 'missing-scope', 'inaccessible', 'denied', 'unknown']);
const REPOSITORY_ID = /^[1-9][0-9]*$/;
const REPOSITORY_FULL_NAME = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const SHA256 = /^[a-f0-9]{64}$/;
const POLICY_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;
const TOPOLOGY_ID = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$/;
const POLICY_KEYS = new Set(['schemaVersion', 'policyId', 'version', 'topologyId', 'projects', 'sha256']);
const PROJECT_POLICY_KEYS = new Set(['projectNodeId', 'fieldSchemaSha256', 'priority']);

function fail(code) {
  return { valid: false, errors: [code] };
}

function normalizeRepositoryId(value) {
  if (typeof value === 'string' && REPOSITORY_ID.test(value)) return value;
  if (Number.isSafeInteger(value) && value > 0) return String(value);
  return null;
}

function canonicalPolicy(policy) {
  return {
    schemaVersion: policy.schemaVersion,
    policyId: policy.policyId,
    version: policy.version,
    topologyId: policy.topologyId,
    projects: [...policy.projects]
      .sort((left, right) => left.priority - right.priority)
      .map(({ projectNodeId, fieldSchemaSha256, priority }) => ({
        projectNodeId,
        fieldSchemaSha256,
        priority,
      })),
  };
}

function validateSelectionPolicy(policy, expectedPolicySha256) {
  if (policy === undefined || policy === null) return { error: 'PROJECT_SELECTION_POLICY_MISSING' };
  if (!policy || typeof policy !== 'object' || Array.isArray(policy)
    || Object.keys(policy).some((key) => !POLICY_KEYS.has(key))
    || policy.schemaVersion !== 1
    || typeof policy.policyId !== 'string' || !POLICY_ID.test(policy.policyId)
    || !Number.isSafeInteger(policy.version) || policy.version < 1
    || typeof policy.topologyId !== 'string' || !TOPOLOGY_ID.test(policy.topologyId)
    || !Array.isArray(policy.projects) || policy.projects.length === 0
    || typeof policy.sha256 !== 'string' || !SHA256.test(policy.sha256)) {
    return { error: 'PROJECT_SELECTION_POLICY_INVALID' };
  }

  const projectIds = new Set();
  const priorities = new Set();
  for (const project of policy.projects) {
    if (!project || typeof project !== 'object' || Array.isArray(project)
      || Object.keys(project).some((key) => !PROJECT_POLICY_KEYS.has(key))
      || typeof project.projectNodeId !== 'string' || project.projectNodeId.trim().length === 0
      || typeof project.fieldSchemaSha256 !== 'string' || !SHA256.test(project.fieldSchemaSha256)
      || !Number.isSafeInteger(project.priority) || project.priority < 1
      || projectIds.has(project.projectNodeId) || priorities.has(project.priority)) {
      return { error: 'PROJECT_SELECTION_POLICY_INVALID' };
    }
    projectIds.add(project.projectNodeId);
    priorities.add(project.priority);
  }

  if (typeof expectedPolicySha256 !== 'string' || !SHA256.test(expectedPolicySha256)) {
    return { error: 'PROJECT_SELECTION_POLICY_PIN_MISSING' };
  }

  const digest = createHash('sha256')
    .update(JSON.stringify(canonicalPolicy(policy)))
    .digest('hex');
  if (policy.sha256 !== digest) return { error: 'PROJECT_SELECTION_POLICY_DIGEST_MISMATCH' };
  if (expectedPolicySha256 !== digest) return { error: 'PROJECT_SELECTION_POLICY_PIN_MISMATCH' };

  return {
    digest,
    projects: new Map(policy.projects.map((project) => [project.projectNodeId, project])),
  };
}

function normalizeSourceIssueIdentity(identity) {
  if (!identity || typeof identity !== 'object' || Array.isArray(identity)) return null;
  const repositoryId = normalizeRepositoryId(identity.repositoryId);
  if (!repositoryId
    || typeof identity.repositoryFullName !== 'string'
    || !REPOSITORY_FULL_NAME.test(identity.repositoryFullName)
    || !Number.isSafeInteger(identity.issueNumber) || identity.issueNumber < 1
    || typeof identity.issueNodeId !== 'string' || identity.issueNodeId.trim().length === 0) {
    return null;
  }
  return {
    repositoryId,
    repositoryFullName: identity.repositoryFullName,
    issueNumber: identity.issueNumber,
    issueNodeId: identity.issueNodeId,
  };
}

function sameSourceIssue(left, right) {
  return left.repositoryId === right.repositoryId
    && left.repositoryFullName === right.repositoryFullName
    && left.issueNumber === right.issueNumber
    && left.issueNodeId === right.issueNodeId;
}

function compareDependency(left, right) {
  const fields = ['repositoryId', 'repositoryFullName', 'issueNumber', 'issueNodeId'];
  for (const field of fields) {
    if (left[field] < right[field]) return -1;
    if (left[field] > right[field]) return 1;
  }
  return 0;
}

function canonicalPlanningContext(context) {
  return {
    ...context,
    planningFields: context.planningFields
      .map((field) => (field.key === 'planning-dependencies'
        ? { ...field, value: [...field.value].sort(compareDependency) }
        : field))
      .sort((left, right) => (left.key < right.key ? -1 : left.key > right.key ? 1 : 0)),
  };
}

function projectReadError(state) {
  if (!PROJECT_READ_STATES.has(state)) return 'PROJECT_CANDIDATE_ACCESS_UNKNOWN';
  if (state === 'missing-scope') return 'PROJECT_READ_SCOPE_MISSING';
  if (state !== 'granted') return 'PROJECT_CANDIDATE_INACCESSIBLE';
  return null;
}

/**
 * Select a single offline Project planning context from the linked Project items
 * for one source Issue. The policy pin must come from a separately validated,
 * immutable topology contract; selection never authorizes execution.
 */
export function selectProjectPlanningContext(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return fail('PROJECT_SELECTION_INPUT_INVALID');
  }

  const projectReadFailure = projectReadError(input.access?.projectRead);
  if (projectReadFailure === 'PROJECT_READ_SCOPE_MISSING') return fail(projectReadFailure);
  if (projectReadFailure === 'PROJECT_CANDIDATE_ACCESS_UNKNOWN') return fail('PROJECT_READ_ACCESS_UNKNOWN');
  if (projectReadFailure) return fail('PROJECT_INACCESSIBLE');

  const policyResult = validateSelectionPolicy(input.selectionPolicy, input.expectedPolicySha256);
  if (policyResult.error) return fail(policyResult.error);

  const targetIssue = normalizeSourceIssueIdentity(input.sourceIssueIdentity);
  if (!targetIssue) return fail('SOURCE_ISSUE_IDENTITY_INVALID');
  if (!Array.isArray(input.candidates)) return fail('PROJECT_CANDIDATES_INVALID');
  if (input.candidates.length === 0) return fail('PROJECT_CONTEXT_NOT_FOUND');

  const uniqueByItem = new Map();
  for (const candidate of input.candidates) {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)
      || !candidate.project || typeof candidate.project.nodeId !== 'string'
      || !candidate.item || typeof candidate.item.nodeId !== 'string') {
      return fail('PROJECT_CANDIDATE_INVALID');
    }

    const candidateReadFailure = projectReadError(candidate.access?.projectRead);
    if (candidateReadFailure) return fail(candidateReadFailure);

    const approvedProject = policyResult.projects.get(candidate.project.nodeId);
    if (!approvedProject) return fail('PROJECT_CANDIDATE_NOT_APPROVED');

    const normalized = normalizeProjectPlanningInput({
      access: candidate.access,
      actorAuthorization: candidate.actorAuthorization,
      approvedProject: {
        nodeId: approvedProject.projectNodeId,
        fieldSchemaSha256: approvedProject.fieldSchemaSha256,
      },
      project: candidate.project,
      item: candidate.item,
      originRepository: candidate.originRepository,
      sourceIssue: candidate.sourceIssue,
      planningFields: candidate.planningFields,
    });
    if (!normalized.valid) return fail(normalized.errors[0] ?? 'PROJECT_CANDIDATE_INVALID');

    const candidateIssue = normalizeSourceIssueIdentity({
      repositoryId: normalized.value.sourceIssue.repository.id,
      repositoryFullName: normalized.value.sourceIssue.repository.fullName,
      issueNumber: normalized.value.sourceIssue.number,
      issueNodeId: normalized.value.sourceIssue.nodeId,
    });
    if (!sameSourceIssue(candidateIssue, targetIssue)) return fail('SOURCE_ISSUE_IDENTITY_MISMATCH');

    const context = canonicalPlanningContext(normalized.value);
    const itemKey = JSON.stringify([candidate.project.nodeId, candidate.item.nodeId]);
    const fingerprint = JSON.stringify(context);
    const prior = uniqueByItem.get(itemKey);
    if (prior) {
      if (prior.fingerprint !== fingerprint) return fail('PROJECT_DUPLICATE_CANDIDATE_CONFLICT');
      continue;
    }

    uniqueByItem.set(itemKey, {
      projectNodeId: candidate.project.nodeId,
      itemNodeId: candidate.item.nodeId,
      context,
      fingerprint,
    });
  }

  const candidates = [...uniqueByItem.values()];
  const itemByProject = new Map();
  for (const candidate of candidates) {
    if (itemByProject.has(candidate.projectNodeId)) return fail('PROJECT_SELECTION_AMBIGUOUS');
    itemByProject.set(candidate.projectNodeId, candidate);
  }

  candidates.sort((left, right) => (
    policyResult.projects.get(left.projectNodeId).priority
    - policyResult.projects.get(right.projectNodeId).priority
  ));
  const selected = candidates[0];

  return {
    valid: true,
    errors: [],
    value: {
      schemaVersion: 1,
      authority: 'planning-only',
      trust: 'untrusted-planning-data',
      selectionPolicy: {
        policyId: input.selectionPolicy.policyId,
        policyVersion: input.selectionPolicy.version,
        topologyId: input.selectionPolicy.topologyId,
        sha256: policyResult.digest,
      },
      candidateCount: candidates.length,
      selectedProjectNodeId: selected.projectNodeId,
      selectedItemNodeId: selected.itemNodeId,
      selectedContext: selected.context,
    },
  };
}
