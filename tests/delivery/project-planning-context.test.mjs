import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';

import Ajv2020 from 'ajv/dist/2020.js';
import schema from '../../schemas/project-planning-context.v1.schema.json' with { type: 'json' };
import { githubApi } from '../../scripts/issue-intake.mjs';
import { authorizeIssueEvent } from '../../scripts/authorize-issue-event.mjs';
import { normalizeProjectPlanningInput } from '../../scripts/lib/project-planning-context.mjs';
import { parseRepositoryYaml } from '../../scripts/lib/yaml.mjs';

const root = path.resolve(import.meta.dirname, '../..');
const fixturePath = path.join(root, 'tests/fixtures/project-planning-context/valid-offline-fixture.json');

async function validInput() {
  const fixture = JSON.parse(await readFile(fixturePath, 'utf8'));
  assert.equal(fixture.evidenceKind, 'offline-only');
  return structuredClone(fixture.input);
}

function assertBlocked(result, code) {
  assert.deepEqual(result, { valid: false, errors: [code] });
}

test('invalid top-level inputs return a fixed error instead of throwing', () => {
  for (const input of [null, undefined, 'unexpected', []]) {
    assertBlocked(normalizeProjectPlanningInput(input), 'PLANNING_INPUT_INVALID');
  }
});

test('Project planning input is normalized as non-authorizing context with immutable identities', async () => {
  const input = await validInput();
  const result = normalizeProjectPlanningInput(input);
  assert.deepEqual(result.errors, []);
  assert.equal(result.valid, true);
  assert.deepEqual(result.value, {
    schemaVersion: 1,
    authority: 'planning-only',
    trust: 'untrusted-planning-data',
    project: {
      nodeId: 'project-fixture-01',
      fieldSchemaSha256: 'a'.repeat(64),
    },
    item: {
      nodeId: 'item-fixture-01',
      projectNodeId: 'project-fixture-01',
    },
    sourceIssue: {
      repository: {
        id: '777777777',
        fullName: 'agentic-delivery-lab/service-a',
      },
      number: 44,
      nodeId: 'issue-fixture-44',
    },
    planningFields: input.planningFields,
    requiredBeforeExecution: 'revalidate-origin-issue-authorization',
  });

  const ajv = new Ajv2020({ allErrors: true, strict: true });
  assert.equal(ajv.validate(schema, result.value), true, JSON.stringify(ajv.errors));
  assert.equal('executionAuthorization' in result.value, false);
  assert.equal('dispatch' in result.value, false);
});

test('safe numeric GitHub repository IDs normalize to schema strings', async () => {
  const input = await validInput();
  input.originRepository.id = 777777777;
  input.sourceIssue.repositoryId = 777777777;
  input.item.content.repositoryId = 777777777;
  input.planningFields = [{
    key: 'planning-dependencies',
    value: [{
      repositoryId: 888888888,
      repositoryFullName: 'agentic-delivery-lab/service-b',
      issueNumber: 43,
      issueNodeId: 'issue-fixture-43',
    }],
  }];

  const result = normalizeProjectPlanningInput(input);
  assert.equal(result.valid, true);
  assert.equal(result.value.sourceIssue.repository.id, '777777777');
  assert.equal(result.value.planningFields[0].value[0].repositoryId, '888888888');

  const ajv = new Ajv2020({ allErrors: true, strict: true });
  assert.equal(ajv.validate(schema, result.value), true, JSON.stringify(ajv.errors));
});

test('dependency repository names must be strings instead of coercible arrays', async () => {
  const input = await validInput();
  input.planningFields = [{
    key: 'planning-dependencies',
    value: [{
      repositoryId: '888888888',
      repositoryFullName: ['agentic-delivery-lab/service-b'],
      issueNumber: 43,
      issueNodeId: 'issue-fixture-43',
    }],
  }];

  assertBlocked(normalizeProjectPlanningInput(input), 'PROJECT_FIELDS_INVALID');
});

test('the context schema rejects duplicate supported planning-field keys', async () => {
  const input = await validInput();
  const result = normalizeProjectPlanningInput(input);
  const ambiguousContext = structuredClone(result.value);
  ambiguousContext.planningFields = [
    { key: 'portfolio-group', value: 'service reliability' },
    { key: 'portfolio-group', value: 'urgent escalation' },
  ];

  const ajv = new Ajv2020({ allErrors: true, strict: true });
  assert.equal(ajv.validate(schema, ambiguousContext), false);

  input.planningFields = ambiguousContext.planningFields;
  assertBlocked(normalizeProjectPlanningInput(input), 'DUPLICATE_PROJECT_FIELD');
});

test('the context schema rejects whitespace-only portfolio groups', async () => {
  const input = await validInput();
  input.planningFields = [{ key: 'portfolio-group', value: 'service reliability' }];
  const result = normalizeProjectPlanningInput(input);
  assert.equal(result.valid, true);

  const whitespaceContext = structuredClone(result.value);
  whitespaceContext.planningFields[0].value = '   ';
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  assert.equal(ajv.validate(schema, whitespaceContext), false);

  input.planningFields[0].value = '   ';
  assertBlocked(normalizeProjectPlanningInput(input), 'PROJECT_FIELDS_INVALID');
});

test('a valid Project planning fixture still re-fetches and authorizes its origin Issue through existing gates', async () => {
  const input = await validInput();
  const linkedProjectItemContent = structuredClone(input.item.content);
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(url);
    if (url.endsWith('/collaborators/sjefsharp/permission')) {
      return { ok: true, status: 200, json: async () => ({ permission: 'write' }) };
    }
    if (url.endsWith('/repos/agentic-delivery-lab/service-a/')) {
      return { ok: true, status: 200, json: async () => ({
        id: 777777777,
        full_name: 'agentic-delivery-lab/service-a',
      }) };
    }
    if (url.endsWith('/issues/44')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({ number: 44, node_id: 'issue-fixture-44', updated_at: '2026-10-09T09:00:00Z' }),
      };
    }
    throw new Error(`Unexpected URL ${url}`);
  };
  const permission = await authorizeIssueEvent({
    env: {
      GITHUB_EVENT_NAME: 'issues',
      GITHUB_REPOSITORY: input.originRepository.fullName,
      GITHUB_ACTOR: 'sjefsharp',
      GH_TOKEN: 'offline-fixture-token',
      GITHUB_OUTPUT: '',
    },
    fetchImpl,
  });
  assert.equal(permission.authorized, true);

  const readIssue = githubApi({ repository: input.originRepository.fullName, token: 'offline-fixture-token', fetchImpl });
  const readRepository = githubApi({ repository: input.originRepository.fullName, token: 'offline-fixture-token', fetchImpl });
  const currentRepository = await readRepository('/');
  const currentIssue = await readIssue('/issues/44');
  input.actorAuthorization = permission;
  input.originRepository = {
    id: currentRepository.id,
    fullName: currentRepository.full_name,
  };
  input.sourceIssue = {
    repositoryId: currentRepository.id,
    repositoryFullName: currentRepository.full_name,
    number: currentIssue.number,
    nodeId: currentIssue.node_id,
    updatedAt: currentIssue.updated_at,
  };
  assert.deepEqual(input.item.content, linkedProjectItemContent);
  const planningContext = normalizeProjectPlanningInput(input);

  assert.equal(planningContext.valid, true);
  assert.deepEqual(calls, [
    `https://api.github.com/repos/${input.originRepository.fullName}/collaborators/sjefsharp/permission`,
    `https://api.github.com/repos/${input.originRepository.fullName}/`,
    `https://api.github.com/repos/${input.originRepository.fullName}/issues/44`,
  ]);
  assert.equal(planningContext.value.sourceIssue.number, 44);
  assert.equal(planningContext.value.requiredBeforeExecution, 'revalidate-origin-issue-authorization');
});

test('approved internal automation can pass the source-Issue gate without a collaborator permission field', async () => {
  const input = await validInput();
  const authorization = await authorizeIssueEvent({
    env: {
      GITHUB_EVENT_NAME: 'issues',
      GITHUB_REPOSITORY: input.originRepository.fullName,
      GITHUB_ACTOR: 'github-actions[bot]',
      GITHUB_OUTPUT: '',
    },
    fetchImpl: async () => { throw new Error('Exact internal automation must not require a collaborator lookup.'); },
  });
  assert.equal(authorization.authorized, true);
  assert.equal(authorization.actorKind, 'internal-automation');
  assert.equal(authorization.permission, undefined);
  input.actorAuthorization = authorization;

  assert.equal(normalizeProjectPlanningInput(input).valid, true);
});

test('Project-only cards stop without producing execution context', async () => {
  const input = await validInput();
  input.item.content = { type: 'draft-issue' };
  const result = normalizeProjectPlanningInput(input);

  assertBlocked(result, 'PROJECT_ONLY_CARD');
});

test('foreign source repository identity stops Project planning normalization', async () => {
  const input = await validInput();
  input.sourceIssue.repositoryId = '999999999';
  input.sourceIssue.repositoryFullName = 'agentic-delivery-lab/foreign';
  const result = normalizeProjectPlanningInput(input);

  assertBlocked(result, 'ORIGIN_REPOSITORY_IDENTITY_MISMATCH');
});

test('Project read scope and Project access failures are distinguished from Issue access failures', async () => {
  const noProjectScope = await validInput();
  noProjectScope.access.projectRead = 'missing-scope';
  assertBlocked(normalizeProjectPlanningInput(noProjectScope), 'PROJECT_READ_SCOPE_MISSING');

  const inaccessibleProject = await validInput();
  inaccessibleProject.access.projectRead = 'inaccessible';
  assertBlocked(normalizeProjectPlanningInput(inaccessibleProject), 'PROJECT_INACCESSIBLE');

  const noIssueRead = await validInput();
  noIssueRead.access.sourceIssueRead = 'denied';
  assertBlocked(normalizeProjectPlanningInput(noIssueRead), 'SOURCE_ISSUE_ACCESS_DENIED');

  const noIssuePermission = await validInput();
  noIssuePermission.actorAuthorization = {
    authorized: false,
    actorKind: 'repository-member',
    permission: 'read',
  };
  assertBlocked(normalizeProjectPlanningInput(noIssuePermission), 'SOURCE_ISSUE_PERMISSION_DENIED');
});

test('unapproved or mismatched Project identity fails closed', async () => {
  const noApprovedIdentity = await validInput();
  noApprovedIdentity.approvedProject = null;
  assertBlocked(normalizeProjectPlanningInput(noApprovedIdentity), 'PROJECT_IDENTITY_NOT_APPROVED');

  const mismatchedIdentity = await validInput();
  mismatchedIdentity.project.nodeId = 'project-fixture-02';
  assertBlocked(normalizeProjectPlanningInput(mismatchedIdentity), 'PROJECT_IDENTITY_MISMATCH');
});

test('stale linked Issues, stale field schemas, unsupported Project fields, and Issue-owned fields are rejected', async () => {
  const staleIssue = await validInput();
  staleIssue.sourceIssue.updatedAt = '2026-10-09T09:05:00Z';
  assertBlocked(normalizeProjectPlanningInput(staleIssue), 'STALE_PROJECT_ISSUE_SNAPSHOT');

  const staleFieldSchema = await validInput();
  staleFieldSchema.project.fieldSchemaSha256 = 'b'.repeat(64);
  assertBlocked(normalizeProjectPlanningInput(staleFieldSchema), 'STALE_PROJECT_FIELD_SCHEMA');

  const unsupportedField = await validInput();
  unsupportedField.planningFields.push({ key: 'sprint', value: 'week 42' });
  assertBlocked(normalizeProjectPlanningInput(unsupportedField), 'UNSUPPORTED_PROJECT_FIELD');

  for (const key of ['issue-priority', 'lifecycle-stage', 'delivery-state', 'execution-state']) {
    const duplicatedIssueAuthority = await validInput();
    duplicatedIssueAuthority.planningFields = [{ key, value: 'offline-fixture-value' }];
    assertBlocked(normalizeProjectPlanningInput(duplicatedIssueAuthority), 'ISSUE_OWNED_FIELD_IN_PROJECT');
  }
});

test('a Project item linked to a foreign repository Issue cannot be normalized', async () => {
  const input = await validInput();
  input.item.content.repositoryId = '999999999';
  input.item.content.repositoryFullName = 'agentic-delivery-lab/foreign';
  assertBlocked(normalizeProjectPlanningInput(input), 'PROJECT_SOURCE_ISSUE_MISMATCH');
});

test('Project field bindings are not retained in normalized planning input', async () => {
  const input = await validInput();
  input.planningFields[0].bindingId = 'offline-secret-field-binding-fixture';
  const result = normalizeProjectPlanningInput(input);

  assert.equal(result.valid, true);
  assert.doesNotMatch(JSON.stringify(result.value), /offline-secret-field-binding-fixture/);
});

test('a Project dependency alone remains planning-only and cannot authorize or block execution', async () => {
  const input = await validInput();
  input.planningFields = [{
    key: 'planning-dependencies',
    value: [{
      repositoryId: '777777777',
      repositoryFullName: 'agentic-delivery-lab/service-a',
      issueNumber: 43,
      issueNodeId: 'issue-fixture-43',
      executionStatus: 'blocked',
      bindingId: 'offline-secret-dependency-binding',
    }],
  }];
  const result = normalizeProjectPlanningInput(input);

  assert.equal(result.valid, true);
  assert.equal(result.value.authority, 'planning-only');
  assert.equal(result.value.requiredBeforeExecution, 'revalidate-origin-issue-authorization');
  assert.deepEqual(result.value.planningFields[0].value, [{
    repositoryId: '777777777',
    repositoryFullName: 'agentic-delivery-lab/service-a',
    issueNumber: 43,
    issueNodeId: 'issue-fixture-43',
  }]);
  assert.equal('executionAuthorization' in result.value, false);
  assert.equal('executionStatus' in result.value, false);
  assert.doesNotMatch(JSON.stringify(result.value), /offline-secret-dependency-binding/);
});

test('Project planning schema and normalizer are mapped to the Control Plane review surface', async () => {
  const reviewMap = parseRepositoryYaml(
    await readFile(path.join(root, 'docs/architecture/harness-review.yml'), 'utf8'),
    'Harness review map',
  );
  const controlPlane = reviewMap['bounded-contexts'].find(
    ({ id }) => id === 'agentic-delivery-control-plane',
  );
  const projectPlanningSurface = reviewMap['runtime-surfaces'].find(
    ({ id }) => id === 'project-planning',
  );

  assert.ok(controlPlane.paths.includes('scripts/lib/project-planning-context.mjs'));
  assert.ok(controlPlane.paths.includes('schemas/project-planning-context.v1.schema.json'));
  assert.ok(projectPlanningSurface);
  assert.ok(projectPlanningSurface.paths.includes('scripts/lib/project-planning-context.mjs'));
  assert.ok(projectPlanningSurface.paths.includes('schemas/project-planning-context.v1.schema.json'));
  assert.ok(projectPlanningSurface.paths.includes('tests/delivery/project-planning-context.test.mjs'));
});
