import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';

import { issueMetadata } from '../../scripts/lib/issue-metadata.mjs';
import { applyIssueMetadataMigration, organizationMetadataManifest, planIssueMetadataMigration } from '../../scripts/lib/issue-metadata-migration.mjs';
import { parseRepositoryYaml } from '../../scripts/lib/yaml.mjs';

const root = path.resolve(import.meta.dirname, '../..');
const config = parseRepositoryYaml(await readFile(path.join(root, 'config/issue-metadata.yml'), 'utf8'), 'issue metadata');

function liveCatalog() {
  return ['lifecycle_stage', 'readiness'].map((key) => ({
    id: `live-${config.fields[key].id}`,
    name: config.fields[key].name,
    dataType: 'SINGLE_SELECT',
    options: config.fields[key].options.map(({ id, name }) => ({ id: `live-${id}`, name })),
  }));
}

function liveBindings() {
  return {
    fields: Object.fromEntries(['lifecycle_stage', 'readiness'].map((key) => [key, {
      id: `live-${config.fields[key].id}`,
      options: Object.fromEntries(config.fields[key].options.map(({ id }) => [id, `live-${id}`])),
    }])),
  };
}

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

test('live catalog absence blocks migration before legacy labels can be removed', () => {
  const plan = planIssueMetadataMigration({
    issue: { number: 9, state: 'open', labels: [{ name: 'type:task' }, { name: 'state:ready-for-plan' }] },
    config,
    organizationIssueTypes: [{ id: 'IT_task', name: 'Task', isEnabled: true }],
    organizationIssueFields: [],
  });

  assert.equal(plan.blocked.length, 2);
  assert.ok(plan.actions.every((action) => action.kind !== 'remove-legacy-labels'));
});

test('migration application preflights blocked organization metadata without partial writes', async () => {
  const calls = [];
  const plan = planIssueMetadataMigration({
    issue: { number: 10, state: 'open', labels: [{ name: 'type:task' }, { name: 'state:ready-for-plan' }] },
    config,
    organizationIssueTypes: [{ id: 'IT_task', name: 'Task', isEnabled: true }],
    organizationIssueFields: [],
  });

  await assert.rejects(() => applyIssueMetadataMigration({
    plan,
    issue: { id: 'I_10' },
    config,
    graphql: async () => { calls.push('graphql'); },
    updateLabels: async () => { calls.push('labels'); },
  }), /Cannot migrate metadata automatically/);
  assert.deepEqual(calls, []);
});

test('migration application preflights runtime bindings before native type or field writes', async () => {
  const calls = [];
  const plan = planIssueMetadataMigration({
    issue: { number: 11, state: 'open', labels: [{ name: 'type:task' }, { name: 'state:ready-for-plan' }] },
    config,
    organizationIssueTypes: [{ id: 'IT_task', name: 'Task', isEnabled: true }],
    organizationIssueFields: liveCatalog(),
    bindings: liveBindings(),
  });

  await assert.rejects(() => applyIssueMetadataMigration({
    plan,
    issue: { id: 'I_11' },
    config,
    organizationIssueFields: liveCatalog(),
    graphql: async () => { calls.push('graphql'); },
    updateLabels: async () => { calls.push('labels'); },
  }), /runtime binding/);
  assert.deepEqual(calls, []);
});

test('migration planning reports incomplete runtime bindings before field writes', () => {
  const plan = planIssueMetadataMigration({
    issue: { number: 13, state: 'open', labels: [{ name: 'type:task' }, { name: 'state:ready-for-plan' }] },
    config,
    organizationIssueTypes: [{ id: 'IT_task', name: 'Task', isEnabled: true }],
    organizationIssueFields: liveCatalog(),
  });

  assert.equal(plan.blocked.length, 2);
  assert.ok(plan.actions.every((action) => action.kind !== 'remove-legacy-labels'));
});

test('migration applies provisioned fields with explicit runtime bindings', async () => {
  const calls = [];
  const plan = planIssueMetadataMigration({
    issue: { number: 12, state: 'open', labels: [{ name: 'type:task' }, { name: 'state:ready-for-plan' }] },
    config,
    organizationIssueTypes: [{ id: 'IT_task', name: 'Task', isEnabled: true }],
    organizationIssueFields: liveCatalog(),
    bindings: liveBindings(),
  });

  const result = await applyIssueMetadataMigration({
    plan,
    issue: { id: 'I_12', labels: [{ name: 'type:task' }, { name: 'state:ready-for-plan' }] },
    config,
    organizationIssueFields: liveCatalog(),
    bindings: liveBindings(),
    graphql: async (query, variables) => { calls.push({ query, variables }); },
    updateLabels: async (labels) => { calls.push({ labels }); },
  });
  assert.equal(result.applied, true);
  assert.deepEqual(calls.filter((call) => call.variables).map((call) => call.variables.input), [
    { issueId: 'I_12', issueTypeId: 'IT_task' },
    { issueId: 'I_12', issueFields: [
      { fieldId: 'live-lifecycle-stage', singleSelectOptionId: 'live-planning' },
      { fieldId: 'live-delivery-readiness', singleSelectOptionId: 'live-ready' },
    ] },
  ]);
  assert.deepEqual(calls.at(-1).labels, []);
});
