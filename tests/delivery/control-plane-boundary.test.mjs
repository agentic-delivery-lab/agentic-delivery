import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import { validateControlPlaneBoundary } from '../../scripts/validate-control-plane-boundary.mjs';

test('runtime control-plane code contains no fixed origin repository', async () => {
  const files = await validateControlPlaneBoundary({ repositoryRoot: path.resolve(import.meta.dirname, '../..') });
  assert.ok(files.length > 0);
});

test('the boundary validator reports a hard-coded origin in runtime code', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'agentic-delivery-boundary-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const file = path.join(root, 'runtime.mjs');
  await writeFile(file, "export const repository = 'agentic-delivery-lab/agentic-delivery';\n");
  await assert.rejects(
    validateControlPlaneBoundary({ repositoryRoot: root, files: ['runtime.mjs'] }),
    (error) => error.exitCode === 1 && /fixed origin repository/.test(error.message),
  );
});
