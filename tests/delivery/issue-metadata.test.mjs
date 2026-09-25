import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';

import { parseRepositoryYaml } from '../../scripts/lib/yaml.mjs';
import {
  fieldValue,
  issueMetadata,
  validateIssueMetadataConfig,
  validateFieldMutation,
} from '../../scripts/lib/issue-metadata.mjs';

const repositoryRoot = path.resolve(import.meta.dirname, '../..');
const config = parseRepositoryYaml(
  await readFile(path.join(repositoryRoot, 'config/issue-metadata.yml'), 'utf8'),
  'issue metadata configuration',
);

test('issue metadata config defines orthogonal native types, lifecycle fields, governance, and execution boundaries', () => {
  assert.deepEqual(validateIssueMetadataConfig(config), { valid: true, errors: [] });
  assert.equal(config.authority.issue_type, 'organization-native');
  assert.equal(config.authority.lifecycle, 'organization-issue-field');
  assert.equal(config.authority.execution_state, 'runner-local');
  assert.equal(config.fields.lifecycle_stage.name, 'Lifecycle Stage');
  assert.equal(config.fields.lifecycle_stage.kind, 'single-select');
  assert.equal(config.fields.readiness.name, 'Delivery Readiness');
  assert.ok(config.fields.lifecycle_stage.pinned_to.includes('issues-without-type'));
  assert.ok(!config.fields.lifecycle_stage.options.some((option) => option.id === 'needs-triage'));
});

test('issue metadata config rejects unsupported and duplicate field pin targets', () => {
  const unsupported = structuredClone(config);
  unsupported.fields.lifecycle_stage.pinned_to = ['bug'];
  assert.match(validateIssueMetadataConfig(unsupported).errors.join(' '), /unsupported pin target/);

  const duplicate = structuredClone(config);
  duplicate.fields.readiness.pinned_to = ['issues-without-type', 'issues-without-type'];
  assert.match(validateIssueMetadataConfig(duplicate).errors.join(' '), /repeats a pin target/);

  const malformed = structuredClone(config);
  malformed.fields.readiness.pinned_to = 'all-issue-types';
  assert.match(validateIssueMetadataConfig(malformed).errors.join(' '), /must be a pinned single-select field/);
});

test('native issue type wins and legacy type labels are only a migration fallback', () => {
  const native = issueMetadata({
    issueType: { name: 'Feature' },
    labels: [{ name: 'type:bug' }],
    fields: { 'Lifecycle Stage': 'Definition', 'Delivery Readiness': 'Not ready' },
  }, config);
  assert.equal(native.issueType.id, 'feature');
  assert.equal(native.issueType.source, 'native');
  assert.deepEqual(native.conflicts, []);
  assert.equal(native.lifecycleStage, 'definition');
  assert.equal(native.readiness, 'not-ready');

  const legacy = issueMetadata({
    labels: [{ name: 'type:research' }, { name: 'state:investigating' }],
  }, config);
  assert.equal(legacy.issueType.id, 'research');
  assert.equal(legacy.issueType.source, 'legacy-label');
  assert.equal(legacy.lifecycleStage, 'discovery');
  assert.equal(legacy.migrationRequired, true);
});

test('field values can be read from simple maps and GitHub GraphQL-shaped values', () => {
  assert.equal(fieldValue({ fields: { 'Lifecycle Stage': 'Execution' } }, config.fields.lifecycle_stage), 'Execution');
  assert.equal(fieldValue({ issueFieldValues: [{ field: { name: 'Lifecycle Stage' }, value: 'Validation' }] }, config.fields.lifecycle_stage), 'Validation');
  assert.equal(fieldValue({ issueFieldValues: [{ name: 'Lifecycle Stage', value: 'Acceptance' }] }, config.fields.lifecycle_stage), 'Acceptance');
});

test('field mutation accepts only a deterministic controller decision', () => {
  const valid = validateFieldMutation({
    config,
    issueState: 'open',
    field: 'lifecycle_stage',
    from: 'planning',
    to: 'execution',
    workType: 'implementation',
    governance: [],
    actor: 'controller',
  });
  assert.equal(valid.allowed, true);

  assert.equal(validateFieldMutation({
    config, issueState: 'open', field: 'lifecycle_stage', from: 'planning', to: 'execution',
    workType: 'implementation', governance: [], actor: 'model',
  }).allowed, false);
  assert.equal(validateFieldMutation({
    config, issueState: 'open', field: 'lifecycle_stage', from: 'planning', to: 'acceptance',
    workType: 'implementation', governance: [], actor: 'controller',
  }).allowed, false);
});
