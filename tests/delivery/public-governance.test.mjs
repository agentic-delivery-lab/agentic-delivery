import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';

import { validatePublicGovernance } from '../../scripts/validate-public-governance.mjs';
import { parseRepositoryYaml } from '../../scripts/lib/yaml.mjs';

const repositoryRoot = path.resolve(import.meta.dirname, '../..');
const candidateSurfaceRoot = path.resolve(repositoryRoot, '../.github-public-candidate');
const defaultSurfaceRoot = path.resolve(repositoryRoot, '../.github');

async function availableSurface() {
  try {
    await access(candidateSurfaceRoot);
    const manifest = parseRepositoryYaml(await readFile(path.join(repositoryRoot, 'migration/special-surfaces.yml'), 'utf8'), 'special surfaces');
    const publicSurface = manifest.surfaces.find((surface) => surface.id === 'public-organization-governance');
    return { root: candidateSurfaceRoot, expectedCommit: publicSurface?.localEvidence?.commit };
  } catch {
    return { root: defaultSurfaceRoot, expectedCommit: undefined };
  }
}

test('public organization governance is a separate, pinned special surface', async (t) => {
  const surface = await availableSurface();
  try {
    await access(surface.root);
  } catch {
    t.skip('public .github checkout is not available in this workspace');
    return;
  }
  const result = await validatePublicGovernance({
    surfaceRoot: surface.root,
    controlPlaneRoot: repositoryRoot,
    expectedCommit: surface.expectedCommit,
  });
  assert.equal(result.status, 'passed');
  assert.match(result.surfaceCommit, /^[0-9a-f]{40}$/);
  assert.match(result.controller.commit, /^[0-9a-f]{40}$/);
});
