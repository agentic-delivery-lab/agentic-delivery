import assert from 'node:assert/strict';
import { access, mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

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
const candidateRef = 'refs/heads/work/migration-main-snapshot';
const execFileAsync = promisify(execFile);

async function targetAvailable(root) {
  try {
    await access(path.join(root, 'migration/manifest.json'));
    return true;
  } catch {
    return false;
  }
}

async function candidateManifestRoot(repositoryRoot) {
  try {
    const { stdout } = await execFileAsync('git', ['-C', repositoryRoot, 'rev-parse', '--verify', candidateRef], { encoding: 'utf8' });
    const ref = stdout.trim();
    const root = await mkdtemp(path.join(tmpdir(), 'agentic-extraction-candidate-'));
    await mkdir(path.join(root, 'migration'), { recursive: true });
    for (const relativePath of ['migration/manifest.json', 'migration/source-commit-map.csv']) {
      const { stdout: contents } = await execFileAsync('git', ['-C', repositoryRoot, 'show', `${ref}:${relativePath}`], { encoding: 'buffer' });
      await writeFile(path.join(root, relativePath), contents);
    }
    return root;
  } catch {
    return null;
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

test('extraction source validation accepts the filtered main-snapshot candidates', async (t) => {
  const [architectureCandidate, primitivesCandidate] = await Promise.all([
    candidateManifestRoot(architectureRoot),
    candidateManifestRoot(primitivesRoot),
  ]);
  if (!architectureCandidate || !primitivesCandidate) {
    if (architectureCandidate) await rm(architectureCandidate, { recursive: true, force: true });
    if (primitivesCandidate) await rm(primitivesCandidate, { recursive: true, force: true });
    t.skip('main-snapshot candidate branches are not available in this workspace');
    return;
  }
  t.after(async () => {
    await Promise.all([
      rm(architectureCandidate, { recursive: true, force: true }),
      rm(primitivesCandidate, { recursive: true, force: true }),
    ]);
  });
  const result = await validateExtractionSource({
    sourceRoot: repositoryRoot,
    sourceCommit: mainCommit,
    sourceRef: 'refs/heads/main',
    targetRoots: [architectureCandidate, primitivesCandidate],
  });
  assert.equal(result.status, 'passed');
  assert.deepEqual(result.targets.map((target) => target.mappedCommits), [143, 143]);
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
