import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';

import { parseRepositoryYaml } from '../../scripts/lib/yaml.mjs';
import {
  EXPECTED_ORGANIZATION_ISSUE_FORMS,
  loadOrganizationIssueForms,
} from '../helpers/organization-issue-forms.mjs';
import { validateIssueMetadataConfig } from '../../scripts/lib/issue-metadata.mjs';

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
  assert.equal(config.authority.delivery_state, 'organization-issue-field');
  assert.equal(config.authority.execution_state, 'runner-local');
  assert.deepEqual(config.field_compatibility, {
    canonical_key: 'delivery_state',
    canonical_name: 'Delivery State',
    legacy_key: 'readiness',
    legacy_id: 'delivery-readiness',
    legacy_name: 'Delivery Readiness',
    mode: 'legacy-authoritative',
    migration_adr: 'ADR-0019',
    duplicate_field_forbidden: true,
    option_identity: 'preserve',
  });
  assert.deepEqual(validateIssueMetadataConfig(config), { valid: true, errors: [] });
});

test('structured issue forms and generic fallback are present', async () => {
  const { forms, config } = await loadOrganizationIssueForms();
  for (const [template, expectedType] of Object.entries(EXPECTED_ORGANIZATION_ISSUE_FORMS)) {
    const form = forms[template];
    assert.ok(form);
    assert.equal(form.type, expectedType);
    assert.ok(Array.isArray(form.body) && form.body.length > 1);
  }
  assert.equal(config.blank_issues_enabled, true);
});

test('repository has no local issue-form override', async () => {
  await assert.rejects(
    access(path.join(repositoryRoot, '.github', 'ISSUE_TEMPLATE')),
    (error) => error.code === 'ENOENT',
  );
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
  assert.ok(intakeWorkflow.jobs.classify.outputs.invocation_accepted);
  assert.ok(intakeWorkflow.jobs.classify.outputs.participant_mode);
  assert.ok(intakeWorkflow.jobs.classify.outputs.controller_version);
  assert.ok(intakeWorkflow.jobs.classify.outputs.controller_commit);
  assert.match(
    await text('.github/workflows/issue-intake.yml'),
    /steps\.invocation\.outputs\.controller_commit \|\| github\.event\.client_payload\.controller\.commit/,
  );
  const intakeSource = await text('.github/workflows/issue-intake.yml');
  assert.match(intakeSource, /Check out the validated controller release/);
  assert.match(intakeSource, /ref: main/);
  assert.ok(intakeSource.indexOf('Validate and normalize explicit agent invocation')
    < intakeSource.indexOf('Check out the validated controller release'));
  assert.equal(intakeWorkflow.jobs.classify.needs, 'authorize');
  assert.ok(intakeWorkflow.jobs.authorize);
  assert.equal(intakeWorkflow.jobs.authorize['runs-on'], 'ubuntu-latest');
  assert.equal(intakeWorkflow.jobs.authorize.permissions.issues, 'read');
  assert.match(await text('.github/workflows/issue-intake.yml'), /authorize-issue-event\.mjs/);
  assert.match(await text('.github/workflows/issue-intake.yml'), /steps\.invocation\.outputs\.accepted == 'true'/);
  assert.doesNotMatch(await text('.github/workflows/issue-intake.yml'), /\n\s*issue_comment:\s*\n/);
  assert.equal(intakeWorkflow.jobs.deliver.permissions.contents, 'read');
  assert.equal(intakeWorkflow.jobs.deliver.permissions.issues, 'write');
  assert.equal(intakeWorkflow.jobs.deliver.permissions['pull-requests'], undefined);
  assert.equal(intakeWorkflow.jobs.deliver.secrets.CODEX_DELIVERY_APP_ID, '${{ secrets.CODEX_DELIVERY_APP_ID }}');
  assert.equal(intakeWorkflow.jobs.deliver.secrets.CODEX_DELIVERY_APP_PRIVATE_KEY, '${{ secrets.CODEX_DELIVERY_APP_PRIVATE_KEY }}');
  assert.equal(deliveryWorkflow.on.workflow_call.inputs.issue.required, true);
  assert.equal(deliveryWorkflow.on.workflow_call.inputs.route.required, true);
  assert.equal(deliveryWorkflow.on.workflow_call.inputs.participant_mode.required, false);
  assert.equal(deliveryWorkflow.on.workflow_call.inputs.controller_commit.required, false);
  assert.equal(deliveryWorkflow.on.workflow_call.secrets.CODEX_DELIVERY_APP_PRIVATE_KEY.required, true);
  assert.equal(deliveryWorkflow.on.workflow_call.secrets.CODEX_DELIVERY_APP_ID.required, true);
  assert.equal(deliveryWorkflow.jobs.deliver.permissions.contents, 'read');
  assert.equal(deliveryWorkflow.jobs.deliver.permissions['pull-requests'], undefined);
  assert.ok(!deliveryWorkflow.on.issues);
  assert.ok(!deliveryWorkflow.on.issue_comment);
});
