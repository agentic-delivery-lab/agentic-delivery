import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';

import { ArchitecturePinValidationError, validateArchitecturePin } from '../../scripts/validate-architecture-pin.mjs';

const repositoryRoot = path.resolve(import.meta.dirname, '../..');
const architectureRoot = path.resolve(repositoryRoot, '../agentic-delivery-architecture');

async function controllerRelease() {
  return JSON.parse(await readFile(path.join(repositoryRoot, 'config/controller-release.json'), 'utf8'));
}

test('Architecture review pins the exact release, digest, policy, and model sources', async (t) => {
  try {
    await readFile(path.join(architectureRoot, 'architecture/generated/architecture-release.json'));
  } catch {
    t.skip('Architecture Authority checkout is not available in this workspace');
    return;
  }
  const release = await controllerRelease();
  const result = await validateArchitecturePin({
    architectureRoot,
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
  await assert.rejects(
    validateArchitecturePin({
      architectureRoot,
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
