import assert from 'node:assert/strict';
import path from 'node:path';
import { test } from 'node:test';

import { validatePullRequestBranch } from '../../scripts/validate-pull-request-branch.mjs';
import { runNodeScript } from '../helpers/process.mjs';

const repositoryRoot = path.resolve(import.meta.dirname, '../..');

test('maps a validated pull-request branch to its source issue', async () => {
  let checkedIssue;
  const issueValidator = async (issueNumber) => { checkedIssue = issueNumber; };
  assert.equal(
    await validatePullRequestBranch({
      branchName: 'feat/issue-12-pnpm-portable-tooling',
      sourceIssueValidator: issueValidator,
    }),
    '12',
  );
  assert.equal(checkedIssue, '12');
});

test('rejects missing branch input and invalid branch syntax', async () => {
  await assert.rejects(validatePullRequestBranch({ branchName: undefined }), (error) => error.exitCode === 2);
  await assert.rejects(validatePullRequestBranch({ branchName: 'main' }), (error) => error.exitCode === 1);
});

test('reports usage failure when BRANCH_NAME is absent', async () => {
  const result = await runNodeScript(
    path.join(repositoryRoot, 'scripts/validate-pull-request-branch.mjs'),
    [],
    { cwd: repositoryRoot, env: { ...process.env, BRANCH_NAME: '' } },
  );
  assert.equal(result.status, 2);
  assert.match(result.stderr, /BRANCH_NAME is required/);
});
