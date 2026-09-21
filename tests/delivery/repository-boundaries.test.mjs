import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';

import { validateRepositoryBoundaries } from '../../scripts/validate-repository-boundaries.mjs';
import { parseRepositoryYaml } from '../../scripts/lib/yaml.mjs';

test('repository-boundary manifest assigns current migration source without duplicate ownership', async () => {
  const result = await validateRepositoryBoundaries();
  assert.equal(result.targets, 5);
  assert.ok(result.mappedFiles > 30);
});

test('the organization-wide control-plane ADR has one future owner', async () => {
  const repositoryRoot = path.resolve(import.meta.dirname, '../..');
  const manifest = parseRepositoryYaml(
    await readFile(path.join(repositoryRoot, 'migration/repository-boundaries.yml'), 'utf8'),
    'repository boundaries',
  );
  const architecture = manifest.targets.find((target) => target.id === 'architecture-authority');
  const controlPlane = manifest.targets.find((target) => target.id === 'delivery-control-plane');
  const primitives = manifest.targets.find((target) => target.id === 'agentic-primitives');
  const distribution = manifest.targets.find((target) => target.id === 'developer-distribution');
  assert.equal(architecture.status, 'local-prepared');
  assert.equal(primitives.status, 'local-prepared');
  assert.equal(distribution.status, 'local-prepared');
  assert.equal(controlPlane.status, 'transitional');
  assert.ok(architecture.sourcePaths.includes('docs/decisions/0018-*.md'));
  assert.ok(!controlPlane.sourcePaths.includes('docs/decisions/0018-*.md'));
});
