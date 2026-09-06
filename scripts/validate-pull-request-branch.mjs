import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { validateBranchName } from './validate-branch-name.mjs';
import { validateSourceIssue } from './validate-source-issue.mjs';

export async function validatePullRequestBranch({
  branchName = process.env.BRANCH_NAME,
  env = process.env,
  sourceIssueValidator = validateSourceIssue,
} = {}) {
  if (!branchName) {
    const error = new Error('Pull-request branch check: BRANCH_NAME is required.');
    error.exitCode = 2;
    throw error;
  }
  validateBranchName(branchName);
  const issueNumber = branchName.match(/\/issue-([1-9][0-9]*)-/)[1];
  await sourceIssueValidator(issueNumber, { env });
  return issueNumber;
}

const isMainModule = process.argv[1]
  && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMainModule) {
  try {
    const issueNumber = await validatePullRequestBranch();
    process.stdout.write(`Pull-request branch check passed for issue #${issueNumber}.\n`);
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = error.exitCode ?? 1;
  }
}
