import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';

import Ajv2020 from 'ajv/dist/2020.js';
import contextSchema from '../../schemas/project-planning-context.v1.schema.json' with { type: 'json' };
import selectionSchema from '../../schemas/project-planning-selection.v1.schema.json' with { type: 'json' };
import selectionPolicySchema from '../../schemas/project-planning-selection-policy.v1.schema.json' with { type: 'json' };
import { authorizeIssueEvent } from '../../scripts/authorize-issue-event.mjs';
import { selectProjectPlanningContext } from '../../scripts/lib/project-planning-selection.mjs';
import { parseRepositoryYaml } from '../../scripts/lib/yaml.mjs';

const root = path.resolve(import.meta.dirname, '../..');
const fixturePath = path.join(root, 'tests/fixtures/project-planning-context/valid-offline-fixture.json');
const policySha256 = 'aef19ae032dd2976e3d6d9deb54a9e01efcb5f9fa7406c666f1d01a81c422490';
const selectionPolicy = {
  schemaVersion: 1,
  policyId: 'offline-selection-fixture',
  version: 1,
  topologyId: 'offline-topology-fixture',
  projects: [
    {
      projectNodeId: 'project-fixture-01',
      fieldSchemaSha256: 'a'.repeat(64),
      priority: 1,
    },
    {
      projectNodeId: 'project-fixture-02',
      fieldSchemaSha256: 'b'.repeat(64),
      priority: 2,
    },
  ],
  sha256: policySha256,
};

const ajv = new Ajv2020({ allErrors: true, strict: true });
ajv.addSchema(contextSchema);
const validateSelectionPolicy = ajv.compile(selectionPolicySchema);
const validateSelection = ajv.compile(selectionSchema);

async function validProjectInput() {
  const fixture = JSON.parse(await readFile(fixturePath, 'utf8'));
  assert.equal(fixture.evidenceKind, 'offline-only');
  return structuredClone(fixture.input);
}

function sourceIssueIdentity(candidate) {
  return {
    repositoryId: candidate.sourceIssue.repositoryId,
    repositoryFullName: candidate.sourceIssue.repositoryFullName,
    issueNumber: candidate.sourceIssue.number,
    issueNodeId: candidate.sourceIssue.nodeId,
  };
}

function candidateFor(base, {
  projectNodeId = 'project-fixture-01',
  itemNodeId = 'item-fixture-01',
  fieldSchemaSha256 = 'a'.repeat(64),
  group = 'factory evolution',
  sequence = 1,
  viewNodeId,
} = {}) {
  const candidate = structuredClone(base);
  delete candidate.approvedProject;
  candidate.project = { nodeId: projectNodeId, fieldSchemaSha256 };
  candidate.item = {
    ...candidate.item,
    nodeId: itemNodeId,
    projectNodeId,
  };
  candidate.planningFields = [
    { key: 'portfolio-group', value: group },
    { key: 'portfolio-sequence', value: sequence },
  ];
  if (viewNodeId !== undefined) candidate.viewNodeId = viewNodeId;
  return candidate;
}

function selectionInput(source, candidates, {
  policy = structuredClone(selectionPolicy),
  expectedPolicySha256 = policy?.sha256,
  projectRead = 'granted',
} = {}) {
  return {
    access: { projectRead },
    sourceIssueIdentity: sourceIssueIdentity(source),
    selectionPolicy: policy,
    expectedPolicySha256,
    candidates,
  };
}

function assertBlocked(result, code) {
  assert.deepEqual(result, { valid: false, errors: [code] });
}

test('selects one approved candidate and returns the exact planning-only identities', async () => {
  const base = await validProjectInput();
  const candidate = candidateFor(base);
  const input = selectionInput(candidate, [candidate]);
  const result = selectProjectPlanningContext(input);

  assert.equal(result.valid, true);
  assert.equal(validateSelectionPolicy(input.selectionPolicy), true, JSON.stringify(validateSelectionPolicy.errors));
  assert.equal(validateSelection(result.value), true, JSON.stringify(validateSelection.errors));
  assert.equal(result.value.candidateCount, 1);
  assert.equal(result.value.selectionPolicy.sha256, policySha256);
  assert.equal(result.value.selectedProjectNodeId, 'project-fixture-01');
  assert.equal(result.value.selectedItemNodeId, 'item-fixture-01');
  assert.equal(result.value.selectedContext.sourceIssue.repository.id, '777777777');
  assert.equal(result.value.selectedContext.sourceIssue.number, 44);
  assert.equal(result.value.selectedContext.authority, 'planning-only');
  assert.equal('executionAuthorization' in result.value, false);
  assert.equal('dispatch' in result.value, false);
});

test('multiple candidates follow pinned policy priority regardless of API order and do not merge fields', async () => {
  const base = await validProjectInput();
  const primary = candidateFor(base, {
    projectNodeId: 'project-fixture-01', itemNodeId: 'item-primary',
    group: 'factory evolution', sequence: 1,
  });
  const secondary = candidateFor(base, {
    projectNodeId: 'project-fixture-02', itemNodeId: 'item-secondary',
    fieldSchemaSha256: 'b'.repeat(64), group: 'product delivery', sequence: 9,
  });

  const forward = selectProjectPlanningContext(selectionInput(primary, [secondary, primary]));
  const reverse = selectProjectPlanningContext(selectionInput(primary, [primary, secondary]));

  assert.equal(forward.valid, true);
  assert.equal(forward.value.candidateCount, 2);
  assert.equal(forward.value.selectedProjectNodeId, 'project-fixture-01');
  assert.deepEqual(forward, reverse);
  assert.deepEqual(forward.value.selectedContext.planningFields, [
    { key: 'portfolio-group', value: 'factory evolution' },
    { key: 'portfolio-sequence', value: 1 },
  ]);
});

test('a single candidate still requires an explicit pinned selection policy', async () => {
  const base = await validProjectInput();
  const candidate = candidateFor(base);
  const input = selectionInput(candidate, [candidate], { policy: null, expectedPolicySha256: null });

  assertBlocked(selectProjectPlanningContext(input), 'PROJECT_SELECTION_POLICY_MISSING');
});

test('a policy pin must match the policy digest', async () => {
  const base = await validProjectInput();
  const candidate = candidateFor(base);
  const input = selectionInput(candidate, [candidate], { expectedPolicySha256: 'c'.repeat(64) });

  assertBlocked(selectProjectPlanningContext(input), 'PROJECT_SELECTION_POLICY_PIN_MISMATCH');
});

test('unknown policy fields are rejected instead of being silently ignored', async () => {
  const base = await validProjectInput();
  const candidate = candidateFor(base);
  const policy = structuredClone(selectionPolicy);
  policy.displayName = 'select by display name';
  const input = selectionInput(candidate, [candidate], { policy });

  assert.equal(validateSelectionPolicy(policy), false);
  assertBlocked(selectProjectPlanningContext(input), 'PROJECT_SELECTION_POLICY_INVALID');
});

test('policy project array order does not change its pinned digest or selected candidate', async () => {
  const base = await validProjectInput();
  const primary = candidateFor(base);
  const secondary = candidateFor(base, {
    projectNodeId: 'project-fixture-02', itemNodeId: 'item-secondary',
    fieldSchemaSha256: 'b'.repeat(64), group: 'product delivery', sequence: 9,
  });
  const policy = structuredClone(selectionPolicy);
  policy.projects.reverse();
  const result = selectProjectPlanningContext(selectionInput(primary, [secondary, primary], { policy }));

  assert.equal(result.valid, true);
  assert.equal(result.value.selectedProjectNodeId, 'project-fixture-01');
  assert.equal(result.value.selectionPolicy.sha256, policySha256);
});

test('a Project absent from the pinned topology cannot be selected', async () => {
  const base = await validProjectInput();
  const unapproved = candidateFor(base, {
    projectNodeId: 'project-not-in-policy',
    fieldSchemaSha256: 'c'.repeat(64),
  });

  assertBlocked(
    selectProjectPlanningContext(selectionInput(unapproved, [unapproved])),
    'PROJECT_CANDIDATE_NOT_APPROVED',
  );
});

test('same-number Issues from different repositories remain isolated', async () => {
  const base = await validProjectInput();
  const foreign = candidateFor(base);
  foreign.originRepository = { id: '888888888', fullName: 'agentic-delivery-lab/service-b' };
  foreign.sourceIssue = {
    ...foreign.sourceIssue,
    repositoryId: '888888888',
    repositoryFullName: 'agentic-delivery-lab/service-b',
    nodeId: 'issue-service-b-44',
  };
  foreign.item.content = {
    ...foreign.item.content,
    repositoryId: '888888888',
    repositoryFullName: 'agentic-delivery-lab/service-b',
    issueNodeId: 'issue-service-b-44',
  };

  assertBlocked(
    selectProjectPlanningContext(selectionInput(base, [foreign])),
    'SOURCE_ISSUE_IDENTITY_MISMATCH',
  );
});

test('two different items for one Project remain ambiguous', async () => {
  const base = await validProjectInput();
  const first = candidateFor(base, { itemNodeId: 'item-first' });
  const second = candidateFor(base, { itemNodeId: 'item-second' });

  assertBlocked(
    selectProjectPlanningContext(selectionInput(first, [first, second])),
    'PROJECT_SELECTION_AMBIGUOUS',
  );
});

test('duplicate events and multiple views of one Project item are idempotent', async () => {
  const base = await validProjectInput();
  const viewOne = candidateFor(base, { viewNodeId: 'view-fixture-one' });
  const viewTwo = candidateFor(base, { viewNodeId: 'view-fixture-two' });
  const withDuplicates = selectProjectPlanningContext(selectionInput(viewOne, [viewTwo, viewOne, viewTwo]));
  const once = selectProjectPlanningContext(selectionInput(viewOne, [viewOne]));

  assert.equal(withDuplicates.valid, true);
  assert.equal(withDuplicates.value.candidateCount, 1);
  assert.deepEqual(withDuplicates, once);
});

test('conflicting observations for the same Project item fail closed', async () => {
  const base = await validProjectInput();
  const first = candidateFor(base, { group: 'factory evolution' });
  const conflicting = candidateFor(base, { group: 'product delivery' });

  assertBlocked(
    selectProjectPlanningContext(selectionInput(first, [first, conflicting])),
    'PROJECT_DUPLICATE_CANDIDATE_CONFLICT',
  );
});

test('an inaccessible Project candidate prevents partial selection', async () => {
  const base = await validProjectInput();
  const readable = candidateFor(base);
  const inaccessible = candidateFor(base, {
    projectNodeId: 'project-fixture-02', itemNodeId: 'item-secondary',
    fieldSchemaSha256: 'b'.repeat(64),
  });
  inaccessible.access.projectRead = 'inaccessible';

  assertBlocked(
    selectProjectPlanningContext(selectionInput(readable, [readable, inaccessible])),
    'PROJECT_CANDIDATE_INACCESSIBLE',
  );
});

test('Project read failure leaves the independent source-Issue authorization route available', async () => {
  const base = await validProjectInput();
  const candidate = candidateFor(base);
  const input = selectionInput(candidate, [candidate], { projectRead: 'missing-scope' });
  const planning = selectProjectPlanningContext(input);
  const authorization = await authorizeIssueEvent({
    env: {
      GITHUB_EVENT_NAME: 'issues',
      GITHUB_REPOSITORY: 'agentic-delivery-lab/service-a',
      GITHUB_ACTOR: 'github-actions[bot]',
      GITHUB_OUTPUT: '',
    },
    fetchImpl: async () => { throw new Error('Internal automation must not require a Project read.'); },
  });

  assertBlocked(planning, 'PROJECT_READ_SCOPE_MISSING');
  assert.equal(authorization.authorized, true);
});

test('Issue-owned lifecycle fields remain rejected by the existing normalizer', async () => {
  const base = await validProjectInput();
  const candidate = candidateFor(base);
  candidate.planningFields = [{ key: 'lifecycle-stage', value: 'implementation' }];

  assertBlocked(
    selectProjectPlanningContext(selectionInput(candidate, [candidate])),
    'ISSUE_OWNED_FIELD_IN_PROJECT',
  );
});

test('selector and versioned schemas are mapped to the Project-planning review surface', async () => {
  const reviewMap = parseRepositoryYaml(
    await readFile(path.join(root, 'docs/architecture/harness-review.yml'), 'utf8'),
    'Harness review map',
  );
  const controlPlane = reviewMap['bounded-contexts'].find(({ id }) => id === 'agentic-delivery-control-plane');
  const projectPlanningSurface = reviewMap['runtime-surfaces'].find(({ id }) => id === 'project-planning');

  assert.ok(controlPlane.paths.includes('scripts/lib/project-planning-selection.mjs'));
  assert.ok(controlPlane.paths.includes('schemas/project-planning-selection-policy.v1.schema.json'));
  assert.ok(controlPlane.paths.includes('schemas/project-planning-selection.v1.schema.json'));
  assert.ok(projectPlanningSurface.paths.includes('scripts/lib/project-planning-selection.mjs'));
  assert.ok(projectPlanningSurface.paths.includes('schemas/project-planning-selection-policy.v1.schema.json'));
  assert.ok(projectPlanningSurface.paths.includes('schemas/project-planning-selection.v1.schema.json'));
  assert.ok(projectPlanningSurface.paths.includes('docs/delivery/project-planning-context-selection.md'));
  assert.ok(projectPlanningSurface.paths.includes('tests/delivery/project-planning-selection.test.mjs'));
});
