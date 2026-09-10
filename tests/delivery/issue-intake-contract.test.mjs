import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';

import { parseRepositoryYaml } from '../../scripts/lib/yaml.mjs';

const repositoryRoot = path.resolve(import.meta.dirname, '../..');

async function text(relativePath) {
  return readFile(path.join(repositoryRoot, relativePath), 'utf8');
}

test('issue intake configuration keeps work type, lifecycle state, and governance separate', async () => {
  const config = parseRepositoryYaml(await text('.github/issue-lifecycle.yml'), 'issue lifecycle configuration');
  assert.deepEqual(config.types.map((type) => type.name), ['Bug', 'Feature', 'Task', 'Idea', 'Research', 'Architecture']);
  assert.ok(config.states.some((state) => state.label === 'state:investigating'));
  assert.ok(config.states.some((state) => state.label === 'state:parked'));
  assert.ok(config.states.some((state) => state.label === 'state:ready-for-plan'));
  assert.ok(config.states.some((state) => state.label === 'state:ready-for-agent'));
  assert.ok(config.governance.some((item) => item.label === 'adr:needed'));
  assert.ok(!config.governance.some((item) => item.label === 'adr:required'));
  assert.deepEqual(config.readiness.delivery_types, ['bug', 'feature', 'task', 'architecture']);
  assert.deepEqual(config.readiness.blocking_governance, ['adr:needed', 'adr:proposed', 'adr:removal']);
});

test('structured issue forms and generic fallback are present', async () => {
  const templateRoot = path.join(repositoryRoot, '.github', 'ISSUE_TEMPLATE');
  for (const template of ['bug.yml', 'feature.yml', 'idea.yml', 'task.yml']) {
    await access(path.join(templateRoot, template));
    const form = parseRepositoryYaml(await text(`.github/ISSUE_TEMPLATE/${template}`), template);
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
  assert.equal(intakeWorkflow.jobs.deliver.permissions.contents, 'read');
  assert.equal(intakeWorkflow.jobs.deliver.permissions.issues, 'write');
  assert.equal(intakeWorkflow.jobs.deliver.permissions['pull-requests'], undefined);
  assert.equal(
    intakeWorkflow.jobs.deliver.secrets.CODEX_DELIVERY_PUBLISH_TOKEN,
    '${{ secrets.CODEX_DELIVERY_PUBLISH_TOKEN }}',
  );
  assert.equal(deliveryWorkflow.on.workflow_call.inputs.issue.required, true);
  assert.equal(deliveryWorkflow.on.workflow_call.inputs.route.required, true);
  assert.equal(deliveryWorkflow.on.workflow_call.secrets.CODEX_DELIVERY_PUBLISH_TOKEN.required, true);
  assert.equal(deliveryWorkflow.jobs.deliver.permissions.contents, 'read');
  assert.equal(deliveryWorkflow.jobs.deliver.permissions['pull-requests'], undefined);
  assert.ok(!deliveryWorkflow.on.issues);
  assert.ok(!deliveryWorkflow.on.issue_comment);
});
