import assert from 'node:assert/strict';
import { access } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';

import { validatePublicGovernance } from '../../scripts/validate-public-governance.mjs';

const repositoryRoot = path.resolve(import.meta.dirname, '../..');
const candidateSurfaceRoot = path.resolve(repositoryRoot, '../.github-public-candidate');
const defaultSurfaceRoot = path.resolve(repositoryRoot, '../.github');

async function availableSurfaceRoot() {
  try {
    await access(candidateSurfaceRoot);
    return candidateSurfaceRoot;
  } catch {
    return defaultSurfaceRoot;
  }
}

test('public organization governance is a separate, pinned special surface', async (t) => {
  const surfaceRoot = await availableSurfaceRoot();
  try {
    await access(surfaceRoot);
  } catch {
    t.skip('public .github checkout is not available in this workspace');
    return;
  }
  const result = await validatePublicGovernance({ surfaceRoot, controlPlaneRoot: repositoryRoot });
  assert.equal(result.status, 'passed');
  assert.match(result.surfaceCommit, /^[0-9a-f]{40}$/);
  assert.match(result.controller.commit, /^[0-9a-f]{40}$/);
});
