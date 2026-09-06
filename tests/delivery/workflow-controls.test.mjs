import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import { validateConfigFiles } from '../../scripts/validate-config-files.mjs';
import { validateMainHistory } from '../../scripts/validate-main-history.mjs';
import { validatePullRequestTitle } from '../../scripts/validate-pull-request-title.mjs';
import { runNodeScript } from '../helpers/process.mjs';

const repositoryRoot = path.resolve(import.meta.dirname, '../..');
const execFileAsync = promisify(execFile);

async function git(root, args) {
  return execFileAsync('git', ['-C', root, ...args], { encoding: 'utf8', windowsHide: true });
}

async function historyFixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'agentic-delivery-history-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await git(root, ['init', '--quiet', '-b', 'main']);
  await git(root, ['config', 'user.name', 'Delivery test']);
  await git(root, ['config', 'user.email', 'delivery-test@example.invalid']);
  await writeFile(path.join(root, 'README.md'), 'initial\n');
  await git(root, ['add', 'README.md']);
  await git(root, ['-c', 'commit.gpgsign=false', 'commit', '--quiet', '-m', 'chore: 🔧 initialize history fixture']);
  return root;
}

test('validates pull-request titles through commitlint and Gitmoji', async () => {
  const runCommitlint = async () => ({ status: 0, stdout: '', stderr: '' });
  await validatePullRequestTitle({
    title: 'feat(delivery): ✨ add portable checks',
    repositoryRoot,
    runInputImpl: runCommitlint,
  });

  await assert.rejects(
    validatePullRequestTitle({
      title: 'feat(delivery): add checks',
      repositoryRoot,
      runInputImpl: runCommitlint,
    }),
    (error) => error.exitCode === 1 && /Gitmoji validation failed/.test(error.message),
  );
  await assert.rejects(
    validatePullRequestTitle({
      title: 'feat(delivery): ✨ add checks',
      repositoryRoot,
      runInputImpl: async () => ({ status: 1, stdout: '', stderr: '' }),
    }),
    (error) => error.exitCode === 1 && /Conventional Commit validation failed/.test(error.message),
  );
});

test('rejects missing pull-request title usage', async () => {
  const result = await runNodeScript(path.join(repositoryRoot, 'scripts/validate-pull-request-title.mjs'), [], {
    cwd: repositoryRoot,
    env: { ...process.env, PR_TITLE: '' },
  });
  assert.equal(result.status, 2);
  assert.match(result.stderr, /PR_TITLE is required/);
});

test('rejects direct commits on main and accepts an empty merge-only range', async (t) => {
  const root = await historyFixture(t);
  const base = (await git(root, ['rev-parse', 'HEAD'])).stdout.trim();
  await writeFile(path.join(root, 'direct.txt'), 'direct\n');
  await git(root, ['add', 'direct.txt']);
  await git(root, ['-c', 'commit.gpgsign=false', 'commit', '--quiet', '-m', 'docs: 📝 direct change']);
  const directHead = (await git(root, ['rev-parse', 'HEAD'])).stdout.trim();
  await assert.rejects(
    validateMainHistory({ base, head: directHead, repositoryRoot: root }),
    (error) => error.exitCode === 1 && /non-merge first-parent commits/.test(error.message),
  );

  await git(root, ['switch', '--quiet', '-c', 'side-branch']);
  await writeFile(path.join(root, 'side.txt'), 'side\n');
  await git(root, ['add', 'side.txt']);
  await git(root, ['-c', 'commit.gpgsign=false', 'commit', '--quiet', '-m', 'docs: 📝 side change']);
  await git(root, ['switch', '--quiet', 'main']);
  await git(root, ['merge', '--quiet', '--no-ff', 'side-branch', '-m', "Merge branch 'side-branch' into main"]);
  const mergeHead = (await git(root, ['rev-parse', 'HEAD'])).stdout.trim();
  await validateMainHistory({ base: directHead, head: mergeHead, repositoryRoot: root });
});

test('parses current configuration and rejects malformed JSON/YAML', async (t) => {
  const count = await validateConfigFiles({ repositoryRoot });
  assert.ok(count > 0);

  const root = await mkdtemp(path.join(os.tmpdir(), 'agentic-delivery-config-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, 'config'), { recursive: true });
  await writeFile(path.join(root, 'config/bad.json'), '{"broken":');
  await assert.rejects(
    validateConfigFiles({ repositoryRoot: root, files: ['config/bad.json'] }),
    (error) => error.exitCode === 1 && /bad\.json/.test(error.message),
  );

  await writeFile(path.join(root, 'config/bad.yaml'), 'value: [1\n');
  await assert.rejects(
    validateConfigFiles({ repositoryRoot: root, files: ['config/bad.yaml'] }),
    (error) => error.exitCode === 1 && /bad\.yaml/.test(error.message),
  );
});

test('returns usage errors for workflow control scripts', async () => {
  const mainHistory = await runNodeScript(path.join(repositoryRoot, 'scripts/validate-main-history.mjs'), [], { cwd: repositoryRoot });
  assert.equal(mainHistory.status, 2);
  const config = await runNodeScript(path.join(repositoryRoot, 'scripts/validate-config-files.mjs'), [repositoryRoot, 'extra'], { cwd: repositoryRoot });
  assert.equal(config.status, 2);
});
