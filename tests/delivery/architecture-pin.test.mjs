import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { promisify } from 'node:util';

import { ArchitecturePinValidationError, validateArchitecturePin } from '../../scripts/validate-architecture-pin.mjs';

const repositoryRoot = path.resolve(import.meta.dirname, '../..');
const architectureRoot = process.env.ARCHITECTURE_PIN_TEST_ROOT ?? path.resolve(repositoryRoot, '../agentic-delivery-architecture');
const currentArchitectureCommit = '59df514a3a6dc8a75b79b3fc75fe61aae4e6fdf3';
const previousArchitectureCommit = '6392c3770219304a78393faac42276e12eb1525f';
const execFileAsync = promisify(execFile);

async function controllerRelease() {
  // Retain the exact historical reader case after the current graph advances.
  return JSON.parse((await execFileAsync('git', ['-C', repositoryRoot, 'show',
    '52d1dea2f6259d365723f90ce01d771da802edc9:config/controller-release.json'])).stdout);
}

async function pinnedArchitectureCheckout(t, commit, sourceRoot = architectureRoot) {
  const fixtureContainer = `${repositoryRoot}.worktrees`;
  await mkdir(fixtureContainer, { recursive: true });
  const temporaryRoot = await mkdtemp(path.join(fixtureContainer, 'architecture-pin-test-'));
  t.after(() => rm(temporaryRoot, { recursive: true, force: true }));
  await execFileAsync('git', ['clone', '--quiet', '--no-local', sourceRoot, temporaryRoot], { encoding: 'utf8' });
  await execFileAsync('git', ['-C', temporaryRoot, 'checkout', '--quiet', '--detach', commit], { encoding: 'utf8' });
  return temporaryRoot;
}

test('Architecture review retains the historical exact release, digest, policy, and model sources', async (t) => {
  const release = await controllerRelease();
  const pinnedRoot = await pinnedArchitectureCheckout(t, release.dependencies.architecture.commit);
  const result = await validateArchitecturePin({
    architectureRoot: pinnedRoot,
    architectureCommit: release.dependencies.architecture.commit,
    architectureDigest: release.dependencies.architecture.contentSha256,
    architectureVersion: release.dependencies.architecture.version,
  });
  assert.equal(result.status, 'passed');
  assert.equal(result.schemaVersion, 2);
  assert.equal(result.commit, release.dependencies.architecture.commit);
  assert.equal(result.sourceCommit, '4d089b17e8c7ef9b2e6f61151a3beaad3c98c16d');
  assert.ok(result.decisionIds.includes('ADR-0022'));
  assert.equal(result.contentSha256, release.dependencies.architecture.contentSha256);
  assert.equal(result.reproducedDigest, result.contentSha256);
});

test('Architecture review reproduces both reviewed 5.1 releases with historical and current index contracts', async (t) => {
  for (const commit of [previousArchitectureCommit, currentArchitectureCommit]) {
    const pinnedRoot = await pinnedArchitectureCheckout(t, commit);
    const manifest = JSON.parse(await readFile(path.join(pinnedRoot, 'architecture/generated/architecture-release.json'), 'utf8'));
    const result = await validateArchitecturePin({
      architectureRoot: pinnedRoot,
      architectureCommit: commit,
      architectureVersion: manifest.version,
      architectureDigest: manifest.contentSha256,
    });
    assert.equal(result.status, 'passed');
    assert.equal(result.commit, commit);
    assert.equal(result.reproducedDigest, manifest.contentSha256);
    assert.equal(manifest.status, 'draft');
    await assert.rejects(validateArchitecturePin({
      architectureRoot: pinnedRoot,
      architectureCommit: commit,
      architectureDigest: '0'.repeat(64),
    }), (error) => error instanceof ArchitecturePinValidationError && /requested review pin/.test(error.message));
  }
});

test('Architecture review rejects mixed, unknown and incomplete contract sets', async (t) => {
  const pinnedRoot = await pinnedArchitectureCheckout(t, currentArchitectureCommit);
  const manifestPath = path.join(pinnedRoot, 'architecture/generated/architecture-release.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  for (const mutation of [
    { architectureRelease: '4.0.0' },
    { decisionInventory: '1.0.0' },
    { adrPrimitiveIndex: '99.0.0' },
    { requirementsReference: undefined },
    { evaluationReport: '99.0.0' },
    { unexpectedContract: '1.0.0' },
  ]) {
    const changed = structuredClone(manifest);
    Object.assign(changed.contractVersions, mutation);
    await writeFile(manifestPath, `${JSON.stringify(changed, null, 2)}\n`);
    await execFileAsync('git', ['-C', pinnedRoot, 'add', 'architecture/generated/architecture-release.json']);
    await execFileAsync('git', ['-C', pinnedRoot, '-c', 'user.name=Architecture pin fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '--quiet', '-m', 'Synthetic incompatible contract fixture']);
    const { stdout } = await execFileAsync('git', ['-C', pinnedRoot, 'rev-parse', 'HEAD']);
    await assert.rejects(validateArchitecturePin({
      architectureRoot: pinnedRoot,
      architectureCommit: stdout.trim(),
      architectureDigest: manifest.contentSha256,
    }), (error) => error instanceof ArchitecturePinValidationError && /contract versions are unsupported/.test(error.message));
  }
});

test('Architecture review fails closed on a mismatched release digest', async (t) => {
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

test('Architecture pins identify commit objects rather than annotated tag objects', async (t) => {
  const pinnedRoot = await pinnedArchitectureCheckout(t, currentArchitectureCommit);
  await execFileAsync('git', ['-C', pinnedRoot, '-c', 'user.name=Pin fixture', '-c', 'user.email=fixture@example.invalid', 'tag', '-a', 'synthetic-pin-tag', '-m', 'Synthetic tag fixture', currentArchitectureCommit]);
  const { stdout } = await execFileAsync('git', ['-C', pinnedRoot, 'rev-parse', 'refs/tags/synthetic-pin-tag']);
  await assert.rejects(validateArchitecturePin({
    architectureRoot: pinnedRoot, architectureCommit: stdout.trim(), requireHead: false,
  }), /commit object/);
});

test('Architecture pin reads and pinned digest children ignore local replacement refs', async (t) => {
  const pinnedRoot = await pinnedArchitectureCheckout(t, currentArchitectureCommit);
  const file = path.join(pinnedRoot, 'architecture/generated/architecture-release.json');
  const manifest = JSON.parse(await readFile(file, 'utf8'));
  await writeFile(file, `${JSON.stringify({ ...manifest, version: '0.1.0-synthetic-replacement' }, null, 2)}\n`);
  await execFileAsync('git', ['-C', pinnedRoot, 'add', 'architecture/generated/architecture-release.json']);
  await execFileAsync('git', ['-C', pinnedRoot, '-c', 'user.name=Pin fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-qm', 'Synthetic replacement fixture']);
  const { stdout } = await execFileAsync('git', ['-C', pinnedRoot, 'rev-parse', 'HEAD']);
  await execFileAsync('git', ['-C', pinnedRoot, 'replace', currentArchitectureCommit, stdout.trim()]);
  const result = await validateArchitecturePin({
    architectureRoot: pinnedRoot, architectureCommit: currentArchitectureCommit,
    architectureVersion: manifest.version, architectureDigest: manifest.contentSha256, requireHead: false,
  });
  assert.equal(result.version, manifest.version);
  assert.equal(result.reproducedDigest, manifest.contentSha256);
});

test('Architecture digest reproduction works through a symlinked temporary directory', async (t) => {
  const scratch = await mkdtemp(path.join(os.tmpdir(), 'architecture-pin-temp-alias-'));
  t.after(() => rm(scratch, { recursive: true, force: true }));
  const physical = path.join(scratch, 'physical');
  const alias = path.join(scratch, 'alias');
  await mkdir(physical);
  await symlink(physical, alias, process.platform === 'win32' ? 'junction' : 'dir');
  const pinnedRoot = await pinnedArchitectureCheckout(t, currentArchitectureCommit);
  const manifest = JSON.parse(await readFile(path.join(pinnedRoot, 'architecture/generated/architecture-release.json'), 'utf8'));
  const { stdout } = await execFileAsync(process.execPath, [
    path.join(repositoryRoot, 'scripts/validate-architecture-pin.mjs'),
    '--architecture-root', pinnedRoot,
    '--architecture-commit', currentArchitectureCommit,
    '--architecture-digest', manifest.contentSha256,
  ], {
    encoding: 'utf8',
    env: { ...process.env, TMPDIR: alias, TMP: alias, TEMP: alias },
  });
  assert.match(stdout, /Architecture pin passed:/);
});

test('Architecture pin CLI accepts the pnpm option separator', async (t) => {
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
