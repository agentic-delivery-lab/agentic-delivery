import { execFile } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { validateBranchName } from './validate-branch-name.mjs';
import { validateSourceIssue } from './validate-source-issue.mjs';

const execFileAsync = promisify(execFile);

export class BranchStartError extends Error {
  constructor(message, exitCode = 1) {
    super(message);
    this.name = 'BranchStartError';
    this.exitCode = exitCode;
  }
}

async function runGit(repositoryRoot, args, execFileImpl) {
  return execFileImpl('git', ['-C', repositoryRoot, ...args], {
    encoding: 'utf8',
    windowsHide: true,
  });
}

export async function startIssueBranch({
  branchType,
  issueNumber,
  summary,
  repositoryRoot,
  env = process.env,
  execFileImpl = execFileAsync,
  sourceIssueValidator = validateSourceIssue,
} = {}) {
  const root = path.resolve(repositoryRoot);
  const branchName = `${branchType}/issue-${issueNumber}-${summary}`;

  try {
    await runGit(root, ['rev-parse', '--git-dir'], execFileImpl);
  } catch {
    throw new BranchStartError('Branch start failed: repository root is not a Git repository.', 2);
  }

  let currentBranch;
  try {
    ({ stdout: currentBranch } = await runGit(root, ['branch', '--show-current'], execFileImpl));
  } catch {
    throw new BranchStartError('Branch start failed: unable to inspect the current branch.');
  }
  currentBranch = currentBranch.trim();
  if (currentBranch !== 'main') {
    throw new BranchStartError(
      `Branch start failed: start from the main branch, currently on ${currentBranch || 'detached HEAD'}.`,
    );
  }

  let status;
  try {
    ({ stdout: status } = await runGit(root, ['status', '--porcelain'], execFileImpl));
  } catch {
    throw new BranchStartError('Branch start failed: unable to inspect the working tree.');
  }
  if (status.trim()) throw new BranchStartError('Branch start failed: main has uncommitted changes.');

  try {
    await runGit(root, ['show-ref', '--verify', '--quiet', 'refs/remotes/origin/main'], execFileImpl);
    const [{ stdout: localHead }, { stdout: remoteHead }] = await Promise.all([
      runGit(root, ['rev-parse', 'HEAD'], execFileImpl),
      runGit(root, ['rev-parse', 'refs/remotes/origin/main'], execFileImpl),
    ]);
    if (localHead.trim() !== remoteHead.trim()) {
      throw new BranchStartError('Branch start failed: local main is not synchronized with origin/main.');
    }
  } catch (error) {
    if (error instanceof BranchStartError) throw error;
    // An absent origin/main is an existing supported boundary: local work may continue.
  }

  try {
    validateBranchName(branchName);
  } catch (error) {
    throw new BranchStartError(error.message, error.exitCode ?? 1);
  }

  try {
    await sourceIssueValidator(issueNumber, { env, execFileImpl });
  } catch (error) {
    throw new BranchStartError(error.message, error.exitCode ?? 1);
  }

  try {
    await runGit(root, ['switch', '-c', branchName], execFileImpl);
  } catch {
    throw new BranchStartError(`Branch start failed: could not create ${branchName}.`);
  }
  return branchName;
}

const isMainModule = process.argv[1]
  && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMainModule) {
  if (process.argv.length !== 5) {
    process.stderr.write(`Usage: ${path.basename(process.argv[1])} <type> <issue-number> <summary>\n`);
    process.exitCode = 2;
  } else {
    try {
      const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
      const branchName = await startIssueBranch({
        branchType: process.argv[2],
        issueNumber: process.argv[3],
        summary: process.argv[4],
        repositoryRoot: path.resolve(scriptDirectory, '..'),
      });
      process.stdout.write(`Created and switched to ${branchName}.\n`);
    } catch (error) {
      process.stderr.write(`${error.message}\n`);
      process.exitCode = error.exitCode ?? 1;
    }
  }
}
