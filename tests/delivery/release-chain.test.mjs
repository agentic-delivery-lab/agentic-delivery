import assert from 'node:assert/strict';
import { access } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';

import { ReleaseChainValidationError, validateReleaseChain } from '../../scripts/validate-release-chain.mjs';

const repositoryRoot = path.resolve(import.meta.dirname, '../..');
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
  assert.equal(result.controller.version, '0.2.0-draft.21');
  assert.equal(result.architecture.contentSha256, '8a5143f2a09e5324cf8fcb5cc9652a0c62b5562371c29bc869a6536aeab4f6d3');
  assert.equal(result.primitives.contentSha256, '36a7e7e95a89ee00288f08a30ac41e4166e11516165e93af47b342026ce894d0');
});
