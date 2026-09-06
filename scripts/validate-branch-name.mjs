import path from 'node:path';
import { fileURLToPath } from 'node:url';

const branchPattern = /^(build|chore|ci|docs|feat|fix|perf|refactor|revert|style|test)\/issue-[1-9][0-9]*-[a-z0-9]+(?:-[a-z0-9]+)*$/;

export class BranchNameValidationError extends Error {
  constructor(message, exitCode = 1) {
    super(message);
    this.name = 'BranchNameValidationError';
    this.exitCode = exitCode;
  }
}

export function validateBranchName(branchName) {
  if (typeof branchName !== 'string' || !branchPattern.test(branchName)) {
    throw new BranchNameValidationError(
      `Invalid branch name: ${branchName ?? ''}\nExpected <type>/issue-<number>-<lowercase-kebab-case-summary>.`,
    );
  }
  return true;
}

const isMainModule = process.argv[1]
  && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMainModule) {
  if (process.argv.length !== 3) {
    process.stderr.write(`Usage: ${path.basename(process.argv[1])} <branch-name>\n`);
    process.exitCode = 2;
  } else {
    try {
      validateBranchName(process.argv[2]);
    } catch (error) {
      process.stderr.write(`${error.message}\n`);
      process.exitCode = error.exitCode ?? 1;
    }
  }
}
