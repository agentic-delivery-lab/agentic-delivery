import assert from 'node:assert/strict';
import { test } from 'node:test';

import { validateRepositoryBoundaries } from '../../scripts/validate-repository-boundaries.mjs';

test('repository-boundary manifest assigns current migration source without duplicate ownership', async () => {
  const result = await validateRepositoryBoundaries();
  assert.equal(result.targets, 5);
  assert.ok(result.mappedFiles > 30);
});
