import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import { startIssueBranch } from '../../scripts/start-issue-branch.mjs';
import { runNodeScript } from '../helpers/process.mjs';

const repositoryRoot = path.resolve(import.meta.dirname, '../..');
const starter = path.join(repositoryRoot, 'scripts/start-issue-branch.mjs');
const execFileAsync = promisify(execFile);

async function git(root, args) {
  return execFileAsync('git', ['-C', root, ...args], { encoding: 'utf8', windowsHide: true });
}

async function newFixture(t, { withRemote = true } = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'agentic-delivery-branch-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await git(root, ['init', '--quiet', '-b', 'main']);
  await git(root, ['config', 'user.name', 'Delivery test']);
  await git(root, ['config', 'user.email', 'delivery-test@example.invalid']);
  await writeFile(path.join(root, 'README.md'), 'fixture\n');
  await git(root, ['add', 'README.md']);
  await git(root, ['-c', 'commit.gpgsign=false', 'commit', '--quiet', '-m', 'chore: 🧰 initialize branch fixture']);
  if (withRemote) await git(root, ['update-ref', 'refs/remotes/origin/main', 'HEAD']);
  return root;
}

function sourceIssueValidator(issueNumber) {
  if (issueNumber === '13') {
    const error = new Error('Source issue check failed: issue #13 is not open.');
    error.exitCode = 1;
    throw error;
  }
  return Promise.resolve();
}

test('creates and switches to a valid issue branch', async (t) => {
  const root = await newFixture(t);
  const branchName = await startIssueBranch({
    branchType: 'feat',
    issueNumber: '11',
    summary: 'branch-naming',
    repositoryRoot: root,
    sourceIssueValidator,
  });
  assert.equal(branchName, 'feat/issue-11-branch-naming');
  assert.equal((await git(root, ['branch', '--show-current'])).stdout.trim(), branchName);
});

test('keeps main when the issue, name or working tree is invalid', async (t) => {
  for (const scenario of [
    { issueNumber: '13', summary: 'closed-work', message: /issue #13 is not open/ },
    { branchType: 'feature', issueNumber: '11', summary: 'invalid-prefix', message: /Invalid branch name/ },
  ]) {
    const root = await newFixture(t);
    await assert.rejects(
      startIssueBranch({
        branchType: scenario.branchType ?? 'feat',
        issueNumber: scenario.issueNumber,
        summary: scenario.summary,
        repositoryRoot: root,
        sourceIssueValidator,
      }),
      scenario.message,
    );
    assert.equal((await git(root, ['branch', '--show-current'])).stdout.trim(), 'main');
  }

  const dirtyRoot = await newFixture(t);
  await writeFile(path.join(dirtyRoot, 'dirty.txt'), 'uncommitted\n');
  await assert.rejects(
    startIssueBranch({
      branchType: 'feat', issueNumber: '11', summary: 'dirty-work',
      repositoryRoot: dirtyRoot, sourceIssueValidator,
    }),
    /main has uncommitted changes/,
  );
  assert.equal((await git(dirtyRoot, ['branch', '--show-current'])).stdout.trim(), 'main');
});

test('preserves stale, detached and missing-origin guardrails', async (t) => {
  const staleRoot = await newFixture(t);
  await writeFile(path.join(staleRoot, 'new.txt'), 'new\n');
  await git(staleRoot, ['add', 'new.txt']);
  await git(staleRoot, ['-c', 'commit.gpgsign=false', 'commit', '--quiet', '-m', 'chore: 🧰 advance local main']);
  await assert.rejects(
    startIssueBranch({
      branchType: 'feat', issueNumber: '11', summary: 'stale-main',
      repositoryRoot: staleRoot, sourceIssueValidator,
    }),
    /not synchronized with origin\/main/,
  );

  const detachedRoot = await newFixture(t);
  const head = (await git(detachedRoot, ['rev-parse', 'HEAD'])).stdout.trim();
  await git(detachedRoot, ['switch', '--detach', head]);
  await assert.rejects(
    startIssueBranch({
      branchType: 'feat', issueNumber: '11', summary: 'detached',
      repositoryRoot: detachedRoot, sourceIssueValidator,
    }),
    /detached HEAD/,
  );

  const noRemoteRoot = await newFixture(t, { withRemote: false });
  assert.equal(
    await startIssueBranch({
      branchType: 'feat', issueNumber: '11', summary: 'without-origin',
      repositoryRoot: noRemoteRoot, sourceIssueValidator,
    }),
    'feat/issue-11-without-origin',
  );
});

test('returns exit code 2 for usage and non-Git roots', async (t) => {
  const usage = await runNodeScript(starter, [], { cwd: repositoryRoot });
  assert.equal(usage.status, 2);
  assert.match(usage.stderr, /Usage:/);

  const nonGit = await mkdtemp(path.join(os.tmpdir(), 'agentic-delivery-not-git-'));
  t.after(() => rm(nonGit, { recursive: true, force: true }));
  await assert.rejects(
    startIssueBranch({
      branchType: 'feat', issueNumber: '11', summary: 'not-git',
      repositoryRoot: nonGit, sourceIssueValidator,
    }),
    (error) => error.exitCode === 2 && /not a Git repository/.test(error.message),
  );
});
