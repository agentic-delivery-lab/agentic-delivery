import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';

import { loadOrganizationIssueForms } from '../helpers/organization-issue-forms.mjs';

const repositoryRoot = path.resolve(import.meta.dirname, '../..');
const decisionsDirectory = path.join(repositoryRoot, 'docs/decisions');

async function assertFile(relativePath) {
  await access(path.join(repositoryRoot, relativePath));
}

async function text(relativePath) {
  return readFile(path.join(repositoryRoot, relativePath), 'utf8');
}

test('repository decision and runner contracts are present', async () => {
  for (const file of [
    'docs/decisions/README.md',
    'docs/decisions/adr-template.md',
    'AGENTS.md',
    '.github/workflows/self-hosted-runner-smoke.yml',
  ]) await assertFile(file);

  const decisions = await text('docs/decisions/README.md');
  for (const phrase of [
    'The template intentionally lives beside README.md and the numbered records',
    'main', 'ADR tracking issue', 'Closes #', 'Approval alone does not close',
    'adr:needed', 'adr:proposed', 'adr:removal', 'adr:rejected',
    'Do not add an `adr:accepted` label',
  ]) assert.ok(decisions.includes(phrase), `missing decision contract: ${phrase}`);
  assert.ok(decisions.includes('(0012-use-github-as-the-lifecycle-control-plane.md)'));
  const lifecycleDecision = await text('docs/decisions/0012-use-github-as-the-lifecycle-control-plane.md');
  for (const phrase of ['Native organization issue types', 'Lifecycle Stage', 'Delivery Readiness', 'state:*', 'adr:needed', 'not planned', 'execution state']) {
    assert.ok(lifecycleDecision.includes(phrase), `missing lifecycle decision contract: ${phrase}`);
  }
  for (const record of ['0013-derive-adr-traceability-from-agentic-primitives.md', '0014-use-a-repository-scoped-github-app.md', '0015-isolate-resumable-runner-execution.md']) {
    await assertFile(`docs/decisions/${record}`);
    assert.ok(decisions.includes(`(${record})`));
  }
  const agents = await text('AGENTS.md');
  for (const phrase of ['Closes #', 'never create a pull request from `main`', 'is only the protected base']) {
    assert.ok(agents.includes(phrase), `missing agent contract: ${phrase}`);
  }
  const { forms } = await loadOrganizationIssueForms();
  const issueTemplate = forms['architecture-decision.yml'];
  const operation = issueTemplate.body.find((item) => item.id === 'operation');
  assert.ok(operation);
  assert.equal(operation.attributes.options.includes('Create or update an ADR'), true);
  assert.equal(operation.attributes.options.includes('Remove an existing ADR'), true);
  assert.equal(operation.validations.required, true);

  const smoke = await text('.github/workflows/self-hosted-runner-smoke.yml');
  for (const phrase of ['workflow_dispatch:', 'runs-on: [self-hosted, linux, x64, omarchy]', 'uses: actions/checkout@fbc6f3992d24b796d5a048ff273f7fcc4a7b6c09', 'Check the dedicated runner']) {
    assert.ok(smoke.includes(phrase), `missing runner contract: ${phrase}`);
  }
});

test('obsolete automatic ADR acceptance files remain absent', async () => {
  for (const relativePath of [
    '.github/workflows/adr-approval-signal.yml',
    '.github/workflows/adr-accept-on-approval.yml',
    'scripts/accept-adr-on-approval.sh',
    'scripts/accept-proposed-adr.sh',
  ]) {
    await assert.rejects(access(path.join(repositoryRoot, relativePath)));
  }
  await access(decisionsDirectory);
});
