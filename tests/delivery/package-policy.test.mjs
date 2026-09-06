import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { spawn } from 'node:child_process';

import { PNPM_COMMAND, runToolchainPreflight } from '../../scripts/lib/toolchain.mjs';
import { createMockPackageRegistry } from '../helpers/mock-package-registry.mjs';

const expectedVersion = '12.3.4';

async function createProject({
  packageManager = `pnpm@${expectedVersion}`,
  workspace = [
    'minimumReleaseAge: 2880',
    'minimumReleaseAgeStrict: true',
    'minimumReleaseAgeIgnoreMissingTime: false',
  ].join('\n'),
  lockfile = 'lockfileVersion: 9.0\n',
  packageLock = false,
} = {}) {
  const repositoryRoot = await mkdtemp(path.join(os.tmpdir(), 'agentic-delivery-toolchain-'));
  await mkdir(path.join(repositoryRoot, 'node_modules'), { recursive: true });
  await writeFile(
    path.join(repositoryRoot, 'package.json'),
    JSON.stringify({
      name: 'toolchain-fixture',
      packageManager,
      engines: { node: '>=24.0.0' },
    }),
  );
  await writeFile(path.join(repositoryRoot, 'pnpm-workspace.yaml'), `${workspace}\n`);
  if (lockfile !== null) {
    await writeFile(path.join(repositoryRoot, 'pnpm-lock.yaml'), lockfile);
  }
  if (packageLock) {
    await writeFile(path.join(repositoryRoot, 'package-lock.json'), '{}\n');
  }
  return repositoryRoot;
}

async function createInstallProject({ dependencies, workspace }) {
  const repositoryRoot = await mkdtemp(path.join(os.tmpdir(), 'agentic-delivery-pnpm-'));
  await writeFile(
    path.join(repositoryRoot, 'package.json'),
    JSON.stringify({ name: 'pnpm-policy-fixture', version: '1.0.0', private: true, dependencies }),
  );
  await writeFile(path.join(repositoryRoot, 'pnpm-workspace.yaml'), `${workspace}\n`);
  return repositoryRoot;
}

function releaseAgePolicy(minimumReleaseAge) {
  return [
    `minimumReleaseAge: ${minimumReleaseAge}`,
    'minimumReleaseAgeStrict: true',
    'minimumReleaseAgeIgnoreMissingTime: false',
  ].join('\n');
}

function runPnpm(repositoryRoot, registryUrl, args, { storeDirectory = path.join(repositoryRoot, '.pnpm-store') } = {}) {
  return new Promise((resolve) => {
    const child = spawn(PNPM_COMMAND, [
      ...args,
      '--ignore-scripts',
      '--reporter=append-only',
      '--store-dir',
      storeDirectory,
      '--registry',
      registryUrl,
    ], {
      cwd: repositoryRoot,
      env: process.env,
      windowsHide: true,
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', (error) => resolve({ status: null, stdout, stderr, error }));
    child.on('close', (status) => resolve({ status, stdout, stderr }));
  });
}

async function withRegistry(t, packages, callback) {
  const registry = await createMockPackageRegistry(packages);
  const repositoryRoots = [];
  t.after(async () => {
    await registry.close();
    await Promise.all(repositoryRoots.map((root) => rm(root, { recursive: true, force: true })));
  });
  const createRoot = async (options) => {
    const root = await createInstallProject(options);
    repositoryRoots.push(root);
    return root;
  };
  return callback({ registry, createRoot });
}

function pnpmVersion(stdout = `${expectedVersion}\n`) {
  return async () => ({ stdout, stderr: '' });
}

test('accepts the exact pnpm version and strict release-age policy', async () => {
  const repositoryRoot = await createProject();

  const result = await runToolchainPreflight({
    repositoryRoot,
    execFileImpl: pnpmVersion(),
  });

  assert.equal(result.pnpmVersion, expectedVersion);
  assert.equal(result.policy.minimumReleaseAge, 2880);
});

test('rejects a missing pnpm executable before command execution', async () => {
  const repositoryRoot = await createProject();
  let executionAttempted = false;
  const missingExecutable = async () => {
    executionAttempted = true;
    const error = new Error('not found');
    error.code = 'ENOENT';
    throw error;
  };

  await assert.rejects(
    runToolchainPreflight({ repositoryRoot, execFileImpl: missingExecutable }),
    /pnpm executable is not available on PATH/,
  );
  assert.equal(executionAttempted, true);
});

test('rejects a mismatched pnpm executable version', async () => {
  const repositoryRoot = await createProject();

  await assert.rejects(
    runToolchainPreflight({
      repositoryRoot,
      execFileImpl: pnpmVersion('11.25.0\n'),
    }),
    /expected 12\.3\.4, found 11\.25\.0/,
  );
});

test('rejects a missing lockfile before invoking pnpm', async () => {
  const repositoryRoot = await createProject({ lockfile: null });
  let executionAttempted = false;
  const unexpectedExecution = async () => {
    executionAttempted = true;
    return { stdout: `${expectedVersion}\n`, stderr: '' };
  };

  await assert.rejects(
    runToolchainPreflight({ repositoryRoot, execFileImpl: unexpectedExecution }),
    /missing pnpm-lock\.yaml/,
  );
  assert.equal(executionAttempted, false);
});

test('rejects malformed release-age policy before invoking pnpm', async () => {
  const repositoryRoot = await createProject({
    workspace: 'minimumReleaseAge: 60\nminimumReleaseAgeStrict: true\nminimumReleaseAgeIgnoreMissingTime: false',
  });
  let executionAttempted = false;
  const unexpectedExecution = async () => {
    executionAttempted = true;
    return { stdout: `${expectedVersion}\n`, stderr: '' };
  };

  await assert.rejects(
    runToolchainPreflight({ repositoryRoot, execFileImpl: unexpectedExecution }),
    /minimumReleaseAge must be exactly 2880 minutes/,
  );
  assert.equal(executionAttempted, false);
});

test('rejects a competing npm lockfile', async () => {
  const repositoryRoot = await createProject({ packageLock: true });

  await assert.rejects(
    runToolchainPreflight({ repositoryRoot, execFileImpl: pnpmVersion() }),
    /competing package-lock\.json/,
  );
});

test('allows a mature direct dependency from a local registry', async (t) => {
  await withRegistry(t, {
    'mature-direct': {
      version: '1.0.0',
      publishedAt: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString(),
    },
  }, async ({ registry, createRoot }) => {
    const repositoryRoot = await createRoot({
      dependencies: { 'mature-direct': '1.0.0' },
      workspace: releaseAgePolicy(2880),
    });
    const result = await runPnpm(repositoryRoot, registry.url, ['install']);

    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.match(result.stdout, /mature-direct/);
  });
});

test('rejects a younger direct dependency from a local registry', async (t) => {
  await withRegistry(t, {
    'young-direct': {
      version: '1.0.0',
      publishedAt: new Date(Date.now() + 60 * 1000).toISOString(),
    },
  }, async ({ registry, createRoot }) => {
    const repositoryRoot = await createRoot({
      dependencies: { 'young-direct': '1.0.0' },
      workspace: releaseAgePolicy(2880),
    });
    const result = await runPnpm(repositoryRoot, registry.url, ['install']);

    assert.notEqual(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.match(`${result.stdout}\n${result.stderr}`, /young-direct|minimumReleaseAge|release age/i);
  });
});

test('rejects a younger transitive dependency from a local registry', async (t) => {
  await withRegistry(t, {
    'mature-parent': {
      version: '1.0.0',
      publishedAt: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString(),
      dependencies: { 'young-transitive': '1.0.0' },
    },
    'young-transitive': {
      version: '1.0.0',
      publishedAt: new Date(Date.now() + 60 * 1000).toISOString(),
    },
  }, async ({ registry, createRoot }) => {
    const repositoryRoot = await createRoot({
      dependencies: { 'mature-parent': '1.0.0' },
      workspace: releaseAgePolicy(2880),
    });
    const result = await runPnpm(repositoryRoot, registry.url, ['install']);

    assert.notEqual(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.match(`${result.stdout}\n${result.stderr}`, /young-transitive|minimumReleaseAge|release age/i);
  });
});

test('rejects a package without a publication timestamp', async (t) => {
  await withRegistry(t, {
    'missing-time': {
      version: '1.0.0',
      publishedAt: null,
    },
  }, async ({ registry, createRoot }) => {
    const repositoryRoot = await createRoot({
      dependencies: { 'missing-time': '1.0.0' },
      workspace: releaseAgePolicy(2880),
    });
    const result = await runPnpm(repositoryRoot, registry.url, ['install']);

    assert.notEqual(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.match(`${result.stdout}\n${result.stderr}`, /missing-time|publication|time|minimumReleaseAge/i);
  });
});

test('rechecks a frozen lockfile created under a weaker policy', async (t) => {
  await withRegistry(t, {
    'young-frozen': {
      version: '1.0.0',
      publishedAt: new Date(Date.now() + 60 * 1000).toISOString(),
    },
  }, async ({ registry, createRoot }) => {
    const repositoryRoot = await createRoot({
      dependencies: { 'young-frozen': '1.0.0' },
      workspace: releaseAgePolicy(0),
    });
    const initialInstall = await runPnpm(repositoryRoot, registry.url, ['install']);
    assert.equal(initialInstall.status, 0, `${initialInstall.stdout}\n${initialInstall.stderr}`);

    await writeFile(path.join(repositoryRoot, 'pnpm-workspace.yaml'), `${releaseAgePolicy(2880)}\n`);
    const frozenInstall = await runPnpm(
      repositoryRoot,
      registry.url,
      ['install', '--frozen-lockfile'],
      { storeDirectory: path.join(repositoryRoot, '.strict-store') },
    );

    assert.notEqual(frozenInstall.status, 0, `${frozenInstall.stdout}\n${frozenInstall.stderr}`);
    assert.match(
      `${frozenInstall.stdout}\n${frozenInstall.stderr}`,
      /young-frozen|minimumReleaseAge|release age/i,
    );
  });
});
