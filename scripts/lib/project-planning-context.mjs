// agentic-primitive: {"id":"project-planning-context-validator","kind":"validator","enforcement":"deterministic","adrs":["ADR-0018"],"domains":["agentic-delivery-control-plane"]}

const WRITER_PERMISSIONS = new Set(['write', 'maintain', 'admin']);
const PROJECT_READ_STATES = new Set(['granted', 'missing-scope', 'inaccessible', 'denied', 'unknown']);
const ISSUE_READ_STATES = new Set(['granted', 'inaccessible', 'denied', 'unknown']);
const PROJECT_FIELD_KEYS = new Set(['portfolio-group', 'portfolio-sequence', 'planning-dependencies']);
const ISSUE_OWNED_FIELD_KEYS = new Set(['issue-priority', 'lifecycle-stage', 'delivery-state', 'execution-state']);
const FULL_NAME = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const REPOSITORY_ID = /^[1-9][0-9]*$/;
const SHA256 = /^[a-f0-9]{64}$/;

function fail(code) {
  return { valid: false, errors: [code] };
}

function validTimestamp(value) {
  return typeof value === 'string' && Number.isFinite(Date.parse(value));
}

function normalizeRepositoryId(value) {
  if (typeof value === 'string' && REPOSITORY_ID.test(value)) return value;
  if (Number.isSafeInteger(value) && value > 0) return String(value);
  return null;
}

function validRepositoryFullName(value) {
  return typeof value === 'string' && FULL_NAME.test(value);
}

function authorizedSourceIssueWriter(authorization) {
  if (authorization?.authorized !== true) return false;
  if (authorization.actorKind === 'internal-automation') return true;
  return authorization.actorKind === 'repository-writer'
    && WRITER_PERMISSIONS.has(authorization.permission);
}

function validatePlanningFields(fields) {
  if (!Array.isArray(fields)) return 'PROJECT_FIELDS_INVALID';
  const seen = new Set();
  for (const field of fields) {
    const key = field?.key;
    if (ISSUE_OWNED_FIELD_KEYS.has(key)) return 'ISSUE_OWNED_FIELD_IN_PROJECT';
    if (!PROJECT_FIELD_KEYS.has(key)) return 'UNSUPPORTED_PROJECT_FIELD';
    if (seen.has(key)) return 'DUPLICATE_PROJECT_FIELD';
    seen.add(key);

    if (key === 'portfolio-group'
      && (typeof field.value !== 'string' || field.value.trim().length === 0 || field.value.length > 200)) {
      return 'PROJECT_FIELDS_INVALID';
    }
    if (key === 'portfolio-sequence' && (!Number.isSafeInteger(field.value) || field.value < 1)) {
      return 'PROJECT_FIELDS_INVALID';
    }
    if (key === 'planning-dependencies') {
      if (!Array.isArray(field.value)) return 'PROJECT_FIELDS_INVALID';
      for (const dependency of field.value) {
        if (!dependency || !normalizeRepositoryId(dependency.repositoryId)
          || !validRepositoryFullName(dependency.repositoryFullName)
          || !Number.isSafeInteger(dependency.issueNumber) || dependency.issueNumber < 1
          || typeof dependency.issueNodeId !== 'string' || dependency.issueNodeId.length === 0) {
          return 'PROJECT_FIELDS_INVALID';
        }
      }
    }
  }
  return null;
}

/**
 * Normalize an offline Project read into planning-only context. This function
 * performs no GitHub access, authorization write-back, or execution dispatch.
 */
export function normalizeProjectPlanningInput(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return fail('PLANNING_INPUT_INVALID');
  const access = input.access ?? {};
  if (!PROJECT_READ_STATES.has(access.projectRead)) return fail('PROJECT_READ_ACCESS_UNKNOWN');
  if (access.projectRead === 'missing-scope') return fail('PROJECT_READ_SCOPE_MISSING');
  if (access.projectRead !== 'granted') return fail('PROJECT_INACCESSIBLE');

  if (!ISSUE_READ_STATES.has(access.sourceIssueRead)) return fail('SOURCE_ISSUE_ACCESS_UNKNOWN');
  if (access.sourceIssueRead !== 'granted') return fail('SOURCE_ISSUE_ACCESS_DENIED');
  if (!authorizedSourceIssueWriter(input.actorAuthorization)) return fail('SOURCE_ISSUE_PERMISSION_DENIED');

  const approvedProject = input.approvedProject;
  if (!approvedProject || typeof approvedProject.nodeId !== 'string' || approvedProject.nodeId.length === 0) {
    return fail('PROJECT_IDENTITY_NOT_APPROVED');
  }
  if (typeof approvedProject.fieldSchemaSha256 !== 'string' || !SHA256.test(approvedProject.fieldSchemaSha256)) {
    return fail('PROJECT_FIELD_SCHEMA_NOT_APPROVED');
  }

  const project = input.project;
  if (!project || typeof project.nodeId !== 'string' || project.nodeId !== approvedProject.nodeId) {
    return fail('PROJECT_IDENTITY_MISMATCH');
  }
  if (typeof project.fieldSchemaSha256 !== 'string' || !SHA256.test(project.fieldSchemaSha256)
    || project.fieldSchemaSha256 !== approvedProject.fieldSchemaSha256) {
    return fail('STALE_PROJECT_FIELD_SCHEMA');
  }

  const item = input.item;
  if (!item || typeof item.nodeId !== 'string' || item.nodeId.length === 0
    || item.projectNodeId !== project.nodeId) return fail('PROJECT_ITEM_IDENTITY_MISMATCH');
  const content = item.content;
  if (!content || content.type !== 'issue') return fail('PROJECT_ONLY_CARD');

  const originRepository = input.originRepository;
  const sourceIssue = input.sourceIssue;
  const originRepositoryId = normalizeRepositoryId(originRepository?.id);
  const sourceRepositoryId = normalizeRepositoryId(sourceIssue?.repositoryId);
  const contentRepositoryId = normalizeRepositoryId(content.repositoryId);
  if (!originRepositoryId
    || !validRepositoryFullName(originRepository?.fullName)
    || !sourceRepositoryId
    || !validRepositoryFullName(sourceIssue?.repositoryFullName)
    || !Number.isSafeInteger(sourceIssue.number) || sourceIssue.number < 1
    || typeof sourceIssue.nodeId !== 'string' || sourceIssue.nodeId.length === 0
    || !validTimestamp(sourceIssue.updatedAt)) {
    return fail('SOURCE_ISSUE_IDENTITY_INVALID');
  }
  if (!contentRepositoryId) return fail('PROJECT_SOURCE_ISSUE_MISMATCH');
  if (sourceRepositoryId !== originRepositoryId
    || sourceIssue.repositoryFullName !== originRepository.fullName) {
    return fail('ORIGIN_REPOSITORY_IDENTITY_MISMATCH');
  }
  if (contentRepositoryId !== sourceRepositoryId
    || content.repositoryFullName !== sourceIssue.repositoryFullName
    || content.issueNumber !== sourceIssue.number
    || content.issueNodeId !== sourceIssue.nodeId
    || !validTimestamp(content.updatedAt)) {
    return fail('PROJECT_SOURCE_ISSUE_MISMATCH');
  }
  if (Date.parse(content.updatedAt) < Date.parse(sourceIssue.updatedAt)) {
    return fail('STALE_PROJECT_ISSUE_SNAPSHOT');
  }
  if (Date.parse(content.updatedAt) > Date.parse(sourceIssue.updatedAt)) {
    return fail('PROJECT_SOURCE_ISSUE_MISMATCH');
  }

  const fieldError = validatePlanningFields(input.planningFields);
  if (fieldError) return fail(fieldError);

  return {
    valid: true,
    errors: [],
    value: {
      schemaVersion: 1,
      authority: 'planning-only',
      trust: 'untrusted-planning-data',
      project: {
        nodeId: project.nodeId,
        fieldSchemaSha256: project.fieldSchemaSha256,
      },
      item: {
        nodeId: item.nodeId,
        projectNodeId: project.nodeId,
      },
      sourceIssue: {
        repository: {
          id: sourceRepositoryId,
          fullName: sourceIssue.repositoryFullName,
        },
        number: sourceIssue.number,
        nodeId: sourceIssue.nodeId,
      },
      planningFields: input.planningFields.map(({ key, value }) => ({
        key,
        value: key === 'planning-dependencies'
          ? value.map(({ repositoryId, repositoryFullName, issueNumber, issueNodeId }) => ({
            repositoryId: normalizeRepositoryId(repositoryId),
            repositoryFullName,
            issueNumber,
            issueNodeId,
          }))
          : value,
      })),
      sourceIssueAuthorizationPrecondition: 'revalidate-origin-issue-authorization-at-runtime-before-consumption',
    },
  };
}
