import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import { validateChangelog } from '../../scripts/validate-changelog.mjs';
import { runNodeScript } from '../helpers/process.mjs';

const repositoryRoot = path.resolve(import.meta.dirname, '../..');
const fixturesDirectory = path.join(import.meta.dirname, 'fixtures/changelogs');
const validator = path.join(repositoryRoot, 'scripts/validate-changelog.mjs');

async function changelogRoot(t, fixtureName) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'agentic-delivery-changelog-'));
  await writeFile(path.join(root, 'CHANGELOG.md'), await readFile(path.join(fixturesDirectory, fixtureName)));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

test('accepts valid changelog fixtures and the repository changelog', async (t) => {
  await validateChangelog(repositoryRoot);
  for (const fixtureName of ['valid.md', 'unreleased-only.md']) {
    await validateChangelog(await changelogRoot(t, fixtureName));
  }
});

test('rejects invalid changelog fixtures with exit code 1', async (t) => {
  const invalidFixtures = [
    'missing-unreleased.md',
    'duplicate-unreleased.md',
    'duplicate-release.md',
    'invalid-category.md',
    'invalid-semver.md',
    'invalid-date.md',
    'invalid-order.md',
    'invalid-date-order.md',
    'category-before-release.md',
  ];
  for (const fixtureName of invalidFixtures) {
    const root = await changelogRoot(t, fixtureName);
    await assert.rejects(validateChangelog(root), (error) => {
      assert.equal(error.exitCode, 1, fixtureName);
      return true;
    });
  }
});

test('returns exit code 2 for a missing changelog and invalid usage', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'agentic-delivery-changelog-missing-'));
  try {
    const missing = await runNodeScript(validator, [root], { cwd: repositoryRoot });
    assert.equal(missing.status, 2);
    assert.match(missing.stderr, /missing CHANGELOG\.md/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }

  const usage = await runNodeScript(validator, [repositoryRoot, 'unexpected'], { cwd: repositoryRoot });
  assert.equal(usage.status, 2);
  assert.match(usage.stderr, /Usage:/);
});
