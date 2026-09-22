import assert from 'node:assert/strict';
import { access } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';

import {
  ExtractionSourceValidationError,
  validateExtractionSource,
} from '../../scripts/validate-extraction-source.mjs';

const repositoryRoot = path.resolve(import.meta.dirname, '../..');
const architectureRoot = path.resolve(repositoryRoot, '../agentic-delivery-architecture');
const primitivesRoot = path.resolve(repositoryRoot, '../agentic-delivery-primitives');
const planningCommit = '67d328b46d84ae599ebfe65ef550d156f689e112';
const planningRef = 'refs/heads/docs/issue-52-persist-repository-split-plan';
const mainCommit = '8b9bd77e1cb6008ce9dab3bbe8652ab7979b4c99';

async function targetAvailable(root) {
  try {
    await access(path.join(root, 'migration/manifest.json'));
    return true;
  } catch {
    return false;
  }
}

test('extraction source validation accepts the prepared Architecture draft source', async (t) => {
  if (!(await targetAvailable(architectureRoot))) {
    t.skip('Architecture Authority checkout is not available in this workspace');
    return;
  }
  const result = await validateExtractionSource({
    sourceRoot: repositoryRoot,
    sourceCommit: planningCommit,
    sourceRef: planningRef,
    targetRoots: [architectureRoot],
  });
  assert.equal(result.status, 'passed');
  assert.equal(result.targets.length, 1);
  assert.ok(result.targets[0].mappedCommits > 100);
});

test('extraction source validation rejects a draft that is not based on the supplied main snapshot', async (t) => {
  if (!(await targetAvailable(architectureRoot))) {
    t.skip('Architecture Authority checkout is not available in this workspace');
    return;
  }
  await assert.rejects(
    validateExtractionSource({
      sourceRoot: repositoryRoot,
      sourceCommit: mainCommit,
      sourceRef: 'refs/heads/main',
      targetRoots: [architectureRoot],
    }),
    (error) => error instanceof ExtractionSourceValidationError
      && /source\.commit must equal|source\.ref must equal/.test(error.message),
  );
});

test('extraction source validation catches a source map commit outside its declared source ref', async (t) => {
  if (!(await targetAvailable(primitivesRoot))) {
    t.skip('Agentic Primitives checkout is not available in this workspace');
    return;
  }
  await assert.rejects(
    validateExtractionSource({
      sourceRoot: repositoryRoot,
      sourceCommit: planningCommit,
      sourceRef: planningRef,
      targetRoots: [primitivesRoot],
    }),
    (error) => error instanceof ExtractionSourceValidationError
      && /not an ancestor of source snapshot/.test(error.message),
  );
});
