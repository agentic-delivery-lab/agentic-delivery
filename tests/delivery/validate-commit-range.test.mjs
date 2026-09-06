import assert from 'node:assert/strict';
import { cp, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import { validateCommitRange } from '../../scripts/validate-commit-range.mjs';
import { runNodeScript } from '../helpers/process.mjs';

const repositoryRoot = path.resolve(import.meta.dirname, '../..');
const validator = path.join(repositoryRoot, 'scripts/validate-commit-range.mjs');
const execFileAsync = promisify(execFile);

async function git(root, args) {
  return execFileAsync('git', ['-C', root, ...args], { encoding: 'utf8', windowsHide: true });
}

async function fixtureRepository(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'agentic-delivery-range-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, 'scripts'), { recursive: true });
  await cp(path.join(repositoryRoot, 'scripts/validate-gitmoji.mjs'), path.join(root, 'scripts/validate-gitmoji.mjs'), { recursive: true });
  await cp(path.join(repositoryRoot, 'commitlint.config.mjs'), path.join(root, 'commitlint.config.mjs'));
  await cp(path.join(repositoryRoot, 'package.json'), path.join(root, 'package.json'));
  await cp(path.join(repositoryRoot, 'pnpm-lock.yaml'), path.join(root, 'pnpm-lock.yaml'));
  await cp(path.join(repositoryRoot, 'pnpm-workspace.yaml'), path.join(root, 'pnpm-workspace.yaml'));
  await execFileAsync('ln', ['-s', path.join(repositoryRoot, 'node_modules'), path.join(root, 'node_modules')]);
  await git(root, ['init', '--quiet', '-b', 'main']);
  await git(root, ['config', 'user.name', 'Delivery test']);
  await git(root, ['config', 'user.email', 'delivery-test@example.invalid']);
  return root;
}

async function commitFile(root, file, message) {
  await writeFile(path.join(root, file), `${message}\n`);
  await writeFile(path.join(root, '.commit-message'), `${message}\n`);
  await git(root, ['add', file]);
  await git(root, ['-c', 'commit.gpgsign=false', 'commit', '--quiet', '-F', '.commit-message']);
  await rm(path.join(root, '.commit-message'), { force: true });
}

test('validates Conventional Commit and Gitmoji rules across a commit range', async (t) => {
  const root = await fixtureRepository(t);
  await commitFile(root, 'initial.txt', 'chore: 🔧 initialize delivery fixture');
  const base = (await git(root, ['rev-parse', 'HEAD'])).stdout.trim();
  await commitFile(root, 'valid.txt', 'feat(core): ✨ add a valid change');
  const validHead = (await git(root, ['rev-parse', 'HEAD'])).stdout.trim();
  await validateCommitRange({ base, head: validHead, repositoryRoot: root, toolingRoot: repositoryRoot });

  await commitFile(root, 'invalid.txt', 'fix: repair a change without a gitmoji');
  const invalidHead = (await git(root, ['rev-parse', 'HEAD'])).stdout.trim();
  await assert.rejects(
    validateCommitRange({ base, head: invalidHead, repositoryRoot: root, toolingRoot: repositoryRoot }),
    (error) => error.exitCode === 1 && /Gitmoji validation failed/.test(error.message),
  );
});

test('ignores merge commits and supports the all-zero base', async (t) => {
  const root = await fixtureRepository(t);
  await commitFile(root, 'initial.txt', 'chore: 🔧 initialize delivery fixture');
  const base = (await git(root, ['rev-parse', 'HEAD'])).stdout.trim();
  await git(root, ['switch', '--quiet', '-c', 'side-branch']);
  await commitFile(root, 'side.txt', 'docs: 📝 document the side branch');
  await git(root, ['switch', '--quiet', 'main']);
  await git(root, ['merge', '--quiet', '--no-ff', 'side-branch', '-m', "Merge branch 'side-branch' into main"]);
  const mergeHead = (await git(root, ['rev-parse', 'HEAD'])).stdout.trim();
  await validateCommitRange({ base, head: mergeHead, repositoryRoot: root, toolingRoot: repositoryRoot });
  await validateCommitRange({ base: '0'.repeat(40), head: mergeHead, repositoryRoot: root, toolingRoot: repositoryRoot });
});

test('preserves invalid range and usage exit code 2', async (t) => {
  const root = await fixtureRepository(t);
  await commitFile(root, 'initial.txt', 'chore: 🔧 initialize delivery fixture');
  const head = (await git(root, ['rev-parse', 'HEAD'])).stdout.trim();
  for (const options of [
    { base: head, head: 'not-a-commit' },
    { base: 'not-a-commit', head },
    { base: head, head: 'HEAD^' },
  ]) {
    await assert.rejects(validateCommitRange({ ...options, repositoryRoot: root, toolingRoot: repositoryRoot }), (error) => error.exitCode === 2);
  }
  const usage = await runNodeScript(validator, [head], { cwd: repositoryRoot });
  assert.equal(usage.status, 2);
  assert.match(usage.stderr, /Usage:/);
});
