import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import { validateSpecialSurfaces } from '../../scripts/validate-special-surfaces.mjs';

const repositoryRoot = path.resolve(import.meta.dirname, '../..');

test('special repository surfaces keep GitHub governance and publication boundaries explicit', async () => {
  const result = await validateSpecialSurfaces();
  assert.deepEqual(result, { surfaces: 2, status: 'passed' });
});

test('special surface validation rejects a canonical private runtime surface', async () => {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), 'agentic-special-surfaces-'));
  try {
    await mkdir(path.join(temporaryRoot, 'migration'), { recursive: true });
    const source = await readFile(path.join(repositoryRoot, 'migration/special-surfaces.yml'), 'utf8');
    await writeFile(path.join(temporaryRoot, 'migration/special-surfaces.yml'), source.replace('    canonical: false\n', '    canonical: true\n'), 'utf8');
    await assert.rejects(
      validateSpecialSurfaces({ repositoryRoot: temporaryRoot }),
      /private-member-copilot-publication must be a projection surface/,
    );
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});
