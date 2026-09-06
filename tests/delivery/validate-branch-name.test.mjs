import assert from 'node:assert/strict';
import path from 'node:path';
import { test } from 'node:test';

import { validateBranchName } from '../../scripts/validate-branch-name.mjs';
import { runNodeScript } from '../helpers/process.mjs';

const repositoryRoot = path.resolve(import.meta.dirname, '../..');
const validator = path.join(repositoryRoot, 'scripts/validate-branch-name.mjs');

test('accepts issue-linked Conventional branch names', () => {
  for (const branchName of [
    'feat/issue-11-branch-naming',
    'ci/issue-12-pnpm-portable-tooling',
    'test/issue-1234-add-fixture',
  ]) {
    assert.equal(validateBranchName(branchName), true);
  }
});

test('rejects malformed branch names with exit code 1', () => {
  for (const branchName of [
    'main',
    'feature/issue-11-branch-naming',
    'feat/issue-0-zero',
    'feat/issue-11-Uppercase',
    'feat/issue-11-trailing-',
    'feat/issue-11-two--words',
  ]) {
    assert.throws(() => validateBranchName(branchName), (error) => error.exitCode === 1);
  }
});

test('returns exit code 2 for invalid usage', async () => {
  const result = await runNodeScript(validator, [], { cwd: repositoryRoot });
  assert.equal(result.status, 2);
  assert.match(result.stderr, /Usage:/);
});
