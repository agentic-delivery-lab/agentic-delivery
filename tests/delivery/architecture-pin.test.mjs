import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { promisify } from 'node:util';

import { ArchitecturePinValidationError, validateArchitecturePin } from '../../scripts/validate-architecture-pin.mjs';

const repositoryRoot = path.resolve(import.meta.dirname, '../..');
const architectureRoot = path.resolve(repositoryRoot, '../agentic-delivery-architecture');
const execFileAsync = promisify(execFile);

async function controllerRelease() {
  return JSON.parse(await readFile(path.join(repositoryRoot, 'config/controller-release.json'), 'utf8'));
}

async function pinnedArchitectureCheckout(t, commit) {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), 'agentic-architecture-pin-test-'));
  t.after(() => rm(temporaryRoot, { recursive: true, force: true }));
  await execFileAsync('git', ['clone', '--quiet', '--no-local', architectureRoot, temporaryRoot], { encoding: 'utf8' });
  await execFileAsync('git', ['-C', temporaryRoot, 'checkout', '--quiet', '--detach', commit], { encoding: 'utf8' });
  return temporaryRoot;
}

test('Architecture review pins the exact release, digest, policy, and model sources', async (t) => {
  try {
    await readFile(path.join(architectureRoot, 'architecture/generated/architecture-release.json'));
  } catch {
    t.skip('Architecture Authority checkout is not available in this workspace');
    return;
  }
  const release = await controllerRelease();
  const pinnedRoot = await pinnedArchitectureCheckout(t, release.dependencies.architecture.commit);
  const result = await validateArchitecturePin({
    architectureRoot: pinnedRoot,
    architectureCommit: release.dependencies.architecture.commit,
    architectureDigest: release.dependencies.architecture.contentSha256,
    architectureVersion: release.dependencies.architecture.version,
  });
  assert.equal(result.status, 'passed');
  assert.equal(result.commit, release.dependencies.architecture.commit);
  assert.equal(result.contentSha256, release.dependencies.architecture.contentSha256);
  assert.equal(result.reproducedDigest, result.contentSha256);
});

test('Architecture review fails closed on a mismatched release digest', async (t) => {
  try {
    await readFile(path.join(architectureRoot, 'architecture/generated/architecture-release.json'));
  } catch {
    t.skip('Architecture Authority checkout is not available in this workspace');
    return;
  }
  const release = await controllerRelease();
  const pinnedRoot = await pinnedArchitectureCheckout(t, release.dependencies.architecture.commit);
  await assert.rejects(
    validateArchitecturePin({
      architectureRoot: pinnedRoot,
      architectureCommit: release.dependencies.architecture.commit,
      architectureDigest: '0'.repeat(64),
      architectureVersion: release.dependencies.architecture.version,
    }),
    (error) => error instanceof ArchitecturePinValidationError && /requested review pin|release digest/.test(error.message),
  );
});

test('Architecture review rejects mutable or implicit source selection', async () => {
  await assert.rejects(
    validateArchitecturePin({ architectureRoot, architectureCommit: 'main' }),
    (error) => error instanceof ArchitecturePinValidationError && error.exitCode === 2,
  );
  await assert.rejects(
    validateArchitecturePin({ architectureRoot }),
    (error) => error instanceof ArchitecturePinValidationError && error.exitCode === 2,
  );
});

test('Architecture pin CLI accepts the pnpm option separator', async (t) => {
  try {
    await readFile(path.join(architectureRoot, 'architecture/generated/architecture-release.json'));
  } catch {
    t.skip('Architecture Authority checkout is not available in this workspace');
    return;
  }
  const release = await controllerRelease();
  const pinnedRoot = await pinnedArchitectureCheckout(t, release.dependencies.architecture.commit);
  const script = path.join(repositoryRoot, 'scripts/validate-architecture-pin.mjs');
  const { stdout } = await execFileAsync(process.execPath, [
    script,
    '--',
    '--architecture-root', pinnedRoot,
    '--architecture-commit', release.dependencies.architecture.commit,
    '--architecture-digest', release.dependencies.architecture.contentSha256,
    '--architecture-version', release.dependencies.architecture.version,
  ], { encoding: 'utf8' });
  assert.match(stdout, /Architecture pin passed:/);
});
