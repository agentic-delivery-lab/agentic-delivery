import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

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
  for (const workflow of [smokeWorkflow, codexWorkflow]) {
    assert.match(workflow, /HOME: \/var\/lib\/github-runner/);
    assert.match(workflow, /CODEX_HOME: \/var\/lib\/github-runner\/\.codex/);
  }
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
