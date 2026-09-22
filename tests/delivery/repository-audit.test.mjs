import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import { parseRepositoryYaml } from '../../scripts/lib/yaml.mjs';

const repositoryRoot = path.resolve(import.meta.dirname, '../..');
const execFileAsync = promisify(execFile);

async function text(relativePath) {
  return readFile(path.join(repositoryRoot, relativePath), 'utf8');
}

test('the tracked migration surface contains no obsolete package lock or shell/Ruby validator', async () => {
  const { stdout } = await execFileAsync('git', ['-C', repositoryRoot, 'ls-files'], { encoding: 'utf8' });
  const tracked = stdout.split(/\r?\n/).filter(Boolean);
  assert.deepEqual(tracked.filter((file) => /(?:^|\/)(?:[^/]+\.(?:sh|rb)|package-lock\.json)$/.test(file)), []);

  const packageJson = JSON.parse(await text('package.json'));
  assert.deepEqual(
    Object.entries(packageJson.scripts).filter(([, command]) => /\bnpm\b|\bnpx\b|\.sh\b|\.rb\b/.test(command)),
    [],
  );
  const workspace = await text('pnpm-workspace.yaml');
  for (const line of ['minimumReleaseAge: 2880', 'minimumReleaseAgeStrict: true', 'minimumReleaseAgeIgnoreMissingTime: false']) {
    assert.ok(workspace.includes(line), `missing release-age setting: ${line}`);
  }
});

test('quality workflows use the pinned pnpm action and preserve the infrastructure boundary', async () => {
  const adrWorkflow = await text('.github/workflows/adr-quality.yml');
  const deliveryWorkflow = await text('.github/workflows/delivery-quality.yml');
  for (const workflow of [adrWorkflow, deliveryWorkflow]) {
    assert.match(workflow, /pnpm\/setup@[0-9a-f]{40} # v2/);
    assert.ok(!workflow.includes('actions/setup-node@'));
    assert.ok(!workflow.includes('npm ci'));
    assert.ok(!/\bnpm\s+audit\b/.test(workflow));
    assert.ok(!workflow.includes('ruby -e'));
    assert.ok(!workflow.includes('shell: bash'));
  }
  const smokeWorkflow = await text('.github/workflows/self-hosted-runner-smoke.yml');
  assert.ok(smokeWorkflow.includes('shell: bash'));
  assert.ok(smokeWorkflow.includes('runs-on: [self-hosted, linux, x64, omarchy]'));
  assert.ok(smokeWorkflow.includes('run: node scripts/codex-sandbox-check.mjs'));
  const preflight = await text('scripts/codex-preflight.mjs');
  for (const phrase of ['startThread(cwd)', 'resumeThread(cwd, sessionId)', 'no persisted rollout', 'No model turn was started']) {
    assert.ok(preflight.includes(phrase), `missing persistent-thread preflight check: ${phrase}`);
  }
  const codexWorkflow = await text('.github/workflows/codex-delivery.yml');
  assert.match(codexWorkflow, /CODEX_DELIVERY_APP_PRIVATE_KEY: \$\{\{ secrets\.CODEX_DELIVERY_APP_PRIVATE_KEY \}\}/);
  assert.doesNotMatch(codexWorkflow, /CODEX_DELIVERY_PUBLISH_TOKEN|PUBLISH_TOKEN:/);
  assert.match(codexWorkflow, /CODEX_AUTH_HOME: \/var\/lib\/github-runner\/\.codex/);
  const intakeWorkflow = await text('.github/workflows/issue-intake.yml');
  assert.ok(intakeWorkflow.includes('types: [opened, edited, reopened, typed, untyped, closed]'));
  assert.ok(!intakeWorkflow.includes('labeled, unlabeled'));
  assert.ok(intakeWorkflow.includes('uses: ./.github/workflows/codex-delivery.yml'));
  assert.ok(codexWorkflow.includes('workflow_call:'));
  assert.ok(!codexWorkflow.includes('types: [opened]'));
});

test('the hosted portability matrix is internal-only and tests the frozen install once per platform', async () => {
  const workflow = await text('.github/workflows/delivery-quality.yml');
  assert.match(workflow, /github\.event_name == 'pull_request'/);
  assert.match(workflow, /github\.event\.pull_request\.head\.repo\.full_name == github\.repository/);
  for (const runner of ['ubuntu-latest', 'macos-latest', 'windows-latest']) assert.ok(workflow.includes(runner));
  const portability = workflow.slice(workflow.indexOf('  portability:'));
  assert.equal((portability.match(/pnpm install --frozen-lockfile --ignore-scripts/g) ?? []).length, 1);
  assert.equal((portability.match(/pnpm test/g) ?? []).length, 1);
});

test('pull request body workflow always reports a trusted read-only check', async () => {
  const source = await text('.github/workflows/pull-request-body.yml');
  const workflow = parseRepositoryYaml(source, 'pull request body workflow');
  assert.deepEqual(workflow.on.pull_request_target.types, [
    'opened', 'edited', 'reopened', 'synchronize', 'ready_for_review',
  ]);
  assert.deepEqual(workflow.permissions, { contents: 'read' });
  const job = workflow.jobs.validate;
  assert.equal(job.name, 'Validate pull request body');
  assert.equal(job['runs-on'], 'ubuntu-latest');
  assert.ok(!job.if);
  const checkout = job.steps.find((step) => step.uses?.startsWith('actions/checkout@'));
  assert.equal(checkout.with.ref, '${{ github.event.pull_request.base.sha }}');
  assert.equal(checkout.with['persist-credentials'], false);
  const validate = job.steps.find((step) => step.run === 'node scripts/validate-pull-request-body.mjs');
  assert.equal(validate.env.PR_AUTHOR, '${{ github.event.pull_request.user.login }}');
  assert.equal(validate.env.PR_BODY, '${{ github.event.pull_request.body }}');
  assert.ok(!source.includes('secrets.'));
  assert.ok(!source.includes('github.event.pull_request.head'));
});

test('control-plane subdomains have explicit scoped instructions', async () => {
  const required = {
    'api/github/AGENTS.md': ['GitHub App ingress boundary', 'participant enrollment', 'Do not implement lifecycle transitions'],
    'config/AGENTS.md': ['Control Plane contract configuration', 'participants.yml', 'immutable commits and schema versions'],
    '.github/workflows/AGENTS.md': ['Central workflow boundary', 'controller checkout and originating-repository checkout separate', 'secrets: inherit'],
    'scripts/lib/AGENTS.md': ['Delivery controller runtime libraries', 'origin repository', 'GitHub Issues and organization fields'],
    'migration/AGENTS.md': ['Migration boundary', 'history-preserving extraction', 'local-prepared'],
  };
  for (const [file, phrases] of Object.entries(required)) {
    const source = await text(file);
    for (const phrase of phrases) assert.ok(source.includes(phrase), `${file} is missing scoped boundary guidance: ${phrase}`);
  }
});
