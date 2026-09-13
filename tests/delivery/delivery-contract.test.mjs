import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';

import { parseRepositoryYaml } from '../../scripts/lib/yaml.mjs';

const repositoryRoot = path.resolve(import.meta.dirname, '../..');

async function text(relativePath) {
  return readFile(path.join(repositoryRoot, relativePath), 'utf8');
}

test('delivery tooling uses pnpm and portable ESM entry points', async () => {
  for (const relativePath of [
    'CHANGELOG.md', 'package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml', '.node-version',
    'commitlint.config.mjs', 'scripts/start-issue-branch.mjs', 'scripts/validate-branch-name.mjs',
    'scripts/validate-commit-range.mjs', 'scripts/validate-gitmoji.mjs', 'scripts/validate-source-issue.mjs',
    'scripts/validate-changelog.mjs', 'scripts/validate-main-history.mjs', 'scripts/validate-config-files.mjs',
    'scripts/lib/toolchain.mjs', 'scripts/lib/yaml.mjs', '.agents/skills/delivery-workflow/SKILL.md',
    '.agents/skills/delivery-workflow/agents/openai.yaml', '.github/pull_request_template.md',
    '.github/workflows/delivery-quality.yml', '.github/workflows/issue-intake.yml',
    '.github/workflows/codex-delivery.yml', '.github/issue-metadata.yml', '.github/orchestration-policy.yml',
    'scripts/issue-intake.mjs', 'scripts/lib/issue-routing.mjs', 'scripts/lib/issue-metadata.mjs',
    'scripts/lib/orchestration-policy.mjs', '.github/ISSUE_TEMPLATE/bug.yml', '.github/ISSUE_TEMPLATE/feature.yml',
    '.github/ISSUE_TEMPLATE/idea.yml', '.github/ISSUE_TEMPLATE/task.yml', '.github/ISSUE_TEMPLATE/research.yml',
    '.github/ISSUE_TEMPLATE/requirements.yml', '.github/ISSUE_TEMPLATE/implementation.yml',
    '.github/ISSUE_TEMPLATE/validation.yml', '.github/ISSUE_TEMPLATE/architecture-decision.yml',
  ]) await access(path.join(repositoryRoot, relativePath));

  const packageJson = JSON.parse(await text('package.json'));
  assert.equal(packageJson.packageManager, 'pnpm@12.3.4');
  assert.equal(packageJson.scripts['branch:start'], 'node scripts/start-issue-branch.mjs');
  assert.equal(packageJson.scripts['lint:branch'], 'node scripts/validate-branch-name.mjs');
  assert.equal(packageJson.scripts['lint:commits'], 'node scripts/validate-commit-range.mjs');
  assert.match(packageJson.scripts.test, /^node --test/);
  for (const dependency of ['@commitlint/cli', '@commitlint/config-conventional', 'gitmojis', 'yaml']) {
    assert.ok(packageJson.devDependencies[dependency]);
  }

  const workflow = await text('.github/workflows/delivery-quality.yml');
  for (const phrase of [
    'pull_request:', 'push:', 'branches: [main]', 'fetch-depth: 0', 'issues: read',
    'actions/checkout@fbc6f3992d24b796d5a048ff273f7fcc4a7b6c09',
    'pnpm/setup@84cb39b217b10273981911c288cd62326dc7c6d2', 'runtime: node@24', 'cache: true', 'install: false',
    'node scripts/validate-toolchain.mjs', 'pnpm install --frozen-lockfile --ignore-scripts',
    'node scripts/validate-pull-request-branch.mjs', 'node scripts/validate-pull-request-title.mjs',
    'node scripts/validate-commit-range.mjs', 'node scripts/validate-main-history.mjs', 'pnpm test',
    'node scripts/validate-changelog.mjs', 'node scripts/validate-config-files.mjs', 'pnpm audit --audit-level=high',
    'ubuntu-latest', 'macos-latest', 'windows-latest',
  ]) assert.ok(workflow.includes(phrase), `missing delivery workflow contract: ${phrase}`);
  for (const obsolete of ['npm ci', 'run: npm audit', 'npx commitlint', 'ruby -e', 'validate-changelog.rb', 'validate-source-issue.sh']) {
    assert.ok(!workflow.includes(obsolete), `obsolete workflow reference: ${obsolete}`);
  }
  const intake = await text('.github/workflows/issue-intake.yml');
  assert.ok(intake.includes('node scripts/issue-intake.mjs'));
  assert.ok(intake.includes('ISSUE_FIELD_BINDINGS_JSON'));
  assert.ok(intake.includes('CODEX_DELIVERY_STATE_DIR'));
  assert.ok(intake.includes('lifecycle_stage'));
  assert.ok(intake.includes('readiness'));
  const delivery = await text('.github/workflows/codex-delivery.yml');
  assert.ok(delivery.includes('workflow_call:'));
  assert.ok(!delivery.includes('types: [opened]'));

  const docs = await text('docs/delivery/README.md');
  assert.ok(docs.includes('pnpm branch:start'));
  assert.ok(docs.includes('pnpm lint:branch'));
  assert.ok(docs.includes('npx get-pnpm 12.3.4'));
  assert.ok(docs.includes('curl -fsSL https://get.pnpm.io/install.sh'));
  assert.ok(docs.includes('Invoke-WebRequest https://get.pnpm.io/install.ps1'));
});

test('repository instructions and ADR-0007 point to pnpm commands', async () => {
  const agents = await text('AGENTS.md');
  const skill = await text('.agents/skills/delivery-workflow/SKILL.md');
  const adr = await text('docs/decisions/0007-use-issue-linked-conventional-branch-names.md');
  for (const source of [agents, skill, adr]) {
    assert.ok(source.includes('pnpm'));
    assert.ok(!source.includes('npm run branch:start'));
  }
  const decisions = await text('docs/decisions/README.md');
  assert.ok(decisions.includes('(0008-use-pnpm-with-delayed-dependency-adoption.md)'));

  const workflowDocument = parseRepositoryYaml(await text('.github/workflows/delivery-quality.yml'), 'delivery workflow');
  assert.ok(workflowDocument.jobs.portability);
  assert.deepEqual(workflowDocument.jobs.portability.strategy.matrix.os, ['ubuntu-latest', 'macos-latest', 'windows-latest']);
});

test('Codex delivery reserves time for a recoverable outer shutdown', async () => {
  const workflowDocument = parseRepositoryYaml(await text('.github/workflows/codex-delivery.yml'), 'Codex delivery workflow');
  assert.equal(workflowDocument.jobs.deliver['timeout-minutes'],350);

  const controller = await text('scripts/codex-delivery.mjs');
  assert.match(controller,/5\.5 \* 60 \* 60_000/);
});
