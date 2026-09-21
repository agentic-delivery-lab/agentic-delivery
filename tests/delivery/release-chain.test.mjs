import assert from 'node:assert/strict';
import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import path from 'node:path';
import { test } from 'node:test';
import { promisify } from 'node:util';

import { ReleaseChainValidationError, validateReleaseChain } from '../../scripts/validate-release-chain.mjs';

const repositoryRoot = path.resolve(import.meta.dirname, '../..');
const execFileAsync = promisify(execFile);
const siblingRoots = {
  architectureRoot: path.resolve(repositoryRoot, '../agentic-delivery-architecture'),
  primitivesRoot: path.resolve(repositoryRoot, '../agentic-delivery-primitives'),
  distributionRoot: path.resolve(repositoryRoot, '../agentic-delivery-distribution'),
  privateRoot: path.resolve(repositoryRoot, '../.github-private'),
};

async function exists(directory) {
  try {
    await access(directory);
    return true;
  } catch {
    return false;
  }
}

test('release-chain validation requires explicit cross-repository inputs', async () => {
  await assert.rejects(
    validateReleaseChain(),
    (error) => error instanceof ReleaseChainValidationError && error.exitCode === 2 && /architectureRoot/.test(error.message),
  );
});

test('local release graph reproduces all pinned digests and publication refs', async (t) => {
  const available = await Promise.all(Object.values(siblingRoots).map(exists));
  if (!available.every(Boolean)) {
    t.skip('split repositories are not checked out in this workspace');
    return;
  }
  const result = await validateReleaseChain({ controlPlaneRoot: repositoryRoot, ...siblingRoots });
  assert.equal(result.status, 'passed');
  assert.equal(result.controller.version, '0.2.0-draft.34');
  assert.equal(result.controller.bootstrapCommit, '30197d5c8731ea6e682ae4de5e629b964e278aab');
  assert.equal(result.architecture.contentSha256, '3bcc5f617de6ecf93f6b1c55bece5f97c03bcd979ccb1aa1c7d2431199383a3c');
  assert.equal(result.primitives.contentSha256, '36a7e7e95a89ee00288f08a30ac41e4166e11516165e93af47b342026ce894d0');
  assert.equal(result.distribution.automationProjectionRelease, 'urn:agentic-delivery:distribution:0.1.0-draft.5');
});

test('the pinned workflow source contains the validator and reusable workflow entry points', async (t) => {
  const available = await Promise.all(Object.values(siblingRoots).map(exists));
  if (!available.every(Boolean)) {
    t.skip('split repositories are not checked out in this workspace');
    return;
  }
  await assert.doesNotReject(() => validateReleaseChain({ controlPlaneRoot: repositoryRoot, ...siblingRoots }));
});

test('release-chain validation reads Architecture and Primitive manifests from their pinned commits', async (t) => {
  const available = await Promise.all(Object.values(siblingRoots).map(exists));
  if (!available.every(Boolean)) {
    t.skip('split repositories are not checked out in this workspace');
    return;
  }
  const result = await validateReleaseChain({ controlPlaneRoot: repositoryRoot, ...siblingRoots });
  const controller = JSON.parse(await readFile(path.join(repositoryRoot, 'config/controller-release.json'), 'utf8'));
  assert.equal(result.architecture.commit, controller.dependencies.architecture.commit);
  assert.equal(result.primitives.commit, controller.dependencies.primitives.commit);
});

test('release-chain validation executes digest tools from the pinned dependency commits', async (t) => {
  const available = await Promise.all(Object.values(siblingRoots).map(exists));
  if (!available.every(Boolean)) {
    t.skip('split repositories are not checked out in this workspace');
    return;
  }

  const temporaryRoot = await mkdtemp(path.join('/tmp', 'agentic-release-chain-test-'));
  const temporaryArchitectureRoot = path.join(temporaryRoot, 'architecture');
  try {
    await execFileAsync('git', ['clone', '--local', '--no-hardlinks', siblingRoots.architectureRoot, temporaryArchitectureRoot], {
      encoding: 'utf8',
      maxBuffer: 4 * 1024 * 1024,
    });
    // If the validator used the mutable worktree tool, this deliberately
    // invalid implementation would make the release digest fail. A passing
    // result proves that the tool itself is read from the pinned commit.
    await writeFile(
      path.join(temporaryArchitectureRoot, 'tools/architecture-content-digest.mjs'),
      "process.stdout.write(`${'0'.repeat(64)}\\n`);\n",
      'utf8',
    );
    const result = await validateReleaseChain({
      controlPlaneRoot: repositoryRoot,
      ...siblingRoots,
      architectureRoot: temporaryArchitectureRoot,
    });
    assert.equal(result.status, 'passed');
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});
