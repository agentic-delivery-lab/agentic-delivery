import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';

import { parseRepositoryYaml } from '../../scripts/lib/yaml.mjs';

const repositoryRoot = path.resolve(import.meta.dirname, '../..');

async function text(relativePath) {
  return readFile(path.join(repositoryRoot, relativePath), 'utf8');
}

test('issue intake configuration keeps issue type, lifecycle stage, readiness, and governance separate', async () => {
  const config = parseRepositoryYaml(await text('.github/issue-metadata.yml'), 'issue metadata configuration');
  assert.deepEqual(config.issue_types.map((type) => type.name), [
    'Idea', 'Research', 'Feature / Outcome', 'Bug', 'Task', 'Requirements',
    'Architecture Decision', 'Implementation', 'Validation',
  ]);
  assert.ok(config.issue_types.every((type) => type.native_name));
  assert.deepEqual(config.fields.lifecycle_stage.options.map((option) => option.id), [
    'intake', 'discovery', 'definition', 'decision', 'planning', 'execution',
    'validation', 'acceptance', 'done', 'parked',
  ]);
  assert.deepEqual(config.fields.readiness.options.map((option) => option.id), [
    'not-ready', 'needs-info', 'ready', 'working', 'waiting', 'awaiting-human', 'blocked',
  ]);
  assert.deepEqual(config.fields.lifecycle_stage.pinned_to, ['all-issue-types', 'issues-without-type']);
  assert.deepEqual(config.fields.readiness.pinned_to, ['all-issue-types', 'issues-without-type']);
  assert.ok(config.governance.labels.some((item) => item.name === 'adr:needed'));
  assert.ok(!config.governance.labels.some((item) => item.name === 'adr:required'));
  assert.deepEqual(config.readiness.planning_types, ['bug', 'feature', 'task', 'implementation']);
  assert.deepEqual(config.readiness.blocking_governance, ['adr:needed', 'adr:proposed', 'adr:removal']);
  assert.equal(config.authority.issue_type, 'organization-native');
  assert.equal(config.authority.lifecycle, 'organization-issue-field');
  assert.equal(config.authority.execution_state, 'runner-local');
});

test('structured issue forms and generic fallback are present', async () => {
  const templateRoot = path.join(repositoryRoot, '.github', 'ISSUE_TEMPLATE');
  const expectedTypes = {
    'bug.yml': 'Bug',
    'feature.yml': 'Feature',
    'idea.yml': 'Idea',
    'task.yml': 'Task',
    'research.yml': 'Research',
    'requirements.yml': 'Requirements',
    'architecture-decision.yml': 'Architecture Decision',
    'implementation.yml': 'Implementation',
    'validation.yml': 'Validation',
  };
  for (const template of Object.keys(expectedTypes)) {
    await access(path.join(templateRoot, template));
    const form = parseRepositoryYaml(await text(`.github/ISSUE_TEMPLATE/${template}`), template);
    assert.equal(form.type, expectedTypes[template]);
    assert.ok(Array.isArray(form.body) && form.body.length > 1);
  }
  const issueConfig = parseRepositoryYaml(await text('.github/ISSUE_TEMPLATE/config.yml'), 'issue template config');
  assert.equal(issueConfig.blank_issues_enabled, true);
});

test('issue events invoke intake and only an authorized route invokes reusable delivery', async () => {
  const intakeWorkflow = parseRepositoryYaml(await text('.github/workflows/issue-intake.yml'), 'issue intake workflow');
  const deliveryWorkflow = parseRepositoryYaml(await text('.github/workflows/codex-delivery.yml'), 'codex delivery workflow');
  assert.ok(intakeWorkflow.on.issues.types.includes('opened'));
  assert.ok(intakeWorkflow.on.issues.types.includes('closed'));
  assert.ok(intakeWorkflow.jobs.classify);
  assert.ok(intakeWorkflow.jobs.deliver.uses?.includes('codex-delivery.yml'));
  assert.ok(intakeWorkflow.jobs.classify.outputs.lifecycle_stage);
  assert.ok(intakeWorkflow.jobs.classify.outputs.readiness);
  assert.equal(intakeWorkflow.jobs.deliver.permissions.contents, 'read');
  assert.equal(intakeWorkflow.jobs.deliver.permissions.issues, 'write');
  assert.equal(intakeWorkflow.jobs.deliver.permissions['pull-requests'], undefined);
  assert.equal(intakeWorkflow.jobs.deliver.secrets.CODEX_DELIVERY_APP_ID, '${{ secrets.CODEX_DELIVERY_APP_ID }}');
  assert.equal(intakeWorkflow.jobs.deliver.secrets.CODEX_DELIVERY_APP_PRIVATE_KEY, '${{ secrets.CODEX_DELIVERY_APP_PRIVATE_KEY }}');
  assert.equal(deliveryWorkflow.on.workflow_call.inputs.issue.required, true);
  assert.equal(deliveryWorkflow.on.workflow_call.inputs.route.required, true);
  assert.equal(deliveryWorkflow.on.workflow_call.secrets.CODEX_DELIVERY_APP_PRIVATE_KEY.required, true);
  assert.equal(deliveryWorkflow.on.workflow_call.secrets.CODEX_DELIVERY_APP_ID.required, true);
  assert.equal(deliveryWorkflow.jobs.deliver.permissions.contents, 'read');
  assert.equal(deliveryWorkflow.jobs.deliver.permissions['pull-requests'], undefined);
  assert.ok(!deliveryWorkflow.on.issues);
  assert.ok(!deliveryWorkflow.on.issue_comment);
});
