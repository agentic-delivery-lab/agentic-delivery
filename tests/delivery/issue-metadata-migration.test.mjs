import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';

import { issueMetadata } from '../../scripts/lib/issue-metadata.mjs';
import { organizationMetadataManifest, planIssueMetadataMigration } from '../../scripts/lib/issue-metadata-migration.mjs';
import { parseRepositoryYaml } from '../../scripts/lib/yaml.mjs';

const root = path.resolve(import.meta.dirname, '../..');
const config = parseRepositoryYaml(await readFile(path.join(root, '.github/issue-metadata.yml'), 'utf8'), 'issue metadata');

test('migration manifests preserve the four separate metadata concepts', () => {
  const manifest = organizationMetadataManifest(config);
  assert.equal(manifest.organization, 'agentic-delivery-lab');
  assert.deepEqual(manifest.pinnedIssueFields.map((field) => field.name), ['Lifecycle Stage', 'Delivery Readiness']);
  assert.ok(manifest.issueTypes.some((type) => type.name === 'Architecture Decision'));
  assert.equal(manifest.templateSource.precedence, 'repository-local-overrides-organization');
});

test('legacy migration is idempotent and removes state labels only after field authority is planned', () => {
  const issue = { number: 7, state: 'open', labels: [{ name: 'type:task' }, { name: 'state:ready-for-plan' }, { name: 'adr:needed' }] };
  const plan = planIssueMetadataMigration({ issue, config, organizationIssueTypes: [{ id: 'IT_task', name: 'Task', isEnabled: true }] });
  assert.equal(plan.idempotent, true);
  assert.ok(plan.actions.some((action) => action.kind === 'set-issue-type'));
  assert.deepEqual(plan.actions.find((action) => action.kind === 'set-field' && action.field === 'lifecycle_stage').value, 'planning');
  assert.ok(plan.actions.some((action) => action.kind === 'remove-legacy-labels'));
  const current = issueMetadata({ issueType: { name: 'Task' }, fields: { 'Lifecycle Stage': 'Planning', 'Delivery Readiness': 'Ready' }, labels: ['adr:needed'] }, config);
  const repeat = planIssueMetadataMigration({ issue: { ...issue, issueType: { name: 'Task' }, fields: { 'Lifecycle Stage': 'Planning', 'Delivery Readiness': 'Ready' }, labels: ['adr:needed'] }, config, organizationIssueTypes: [{ id: 'IT_task', name: 'Task', isEnabled: true }] });
  assert.equal(current.migrationRequired, false);
  assert.deepEqual(repeat.actions, []);
});

test('migration fills a missing field even when a legacy label has the same value', () => {
  const plan = planIssueMetadataMigration({
    issue: {
      number: 8,
      state: 'open',
      issueType: { name: 'Task' },
      labels: [{ name: 'state:ready-for-plan' }],
    },
    config,
    organizationIssueTypes: [{ id: 'IT_task', name: 'Task', isEnabled: true }],
  });

  assert.deepEqual(plan.actions.filter((action) => action.kind === 'set-field').map((action) => [action.field, action.value]), [
    ['lifecycle_stage', 'planning'],
    ['readiness', 'ready'],
  ]);
});
