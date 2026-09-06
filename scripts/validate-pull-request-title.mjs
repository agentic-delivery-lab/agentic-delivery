import { spawn } from 'node:child_process';
import { access, stat } from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { validateGitmojiMessage } from './validate-gitmoji.mjs';

function runInput(command, args, input, options) {
  return new Promise((resolve) => {
    const child = spawn(command, args, { ...options, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; process.stdout.write(chunk); });
    child.stderr.on('data', (chunk) => { stderr += chunk; process.stderr.write(chunk); });
    child.on('error', (error) => resolve({ status: null, stdout, stderr, error }));
    child.on('close', (status) => resolve({ status, stdout, stderr }));
    child.stdin.end(input);
  });
}

async function isFile(filePath) {
  try {
    return (await stat(filePath)).isFile();
  } catch {
    return false;
  }
}

export class PullRequestTitleValidationError extends Error {
  constructor(message, exitCode = 1) {
    super(message);
    this.name = 'PullRequestTitleValidationError';
    this.exitCode = exitCode;
  }
}

export async function validatePullRequestTitle({
  title,
  repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'),
  pnpmCommand = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm',
  runInputImpl = runInput,
} = {}) {
  if (typeof title !== 'string' || title.length === 0) {
    throw new PullRequestTitleValidationError('Pull-request title check: PR_TITLE is required.', 2);
  }
  const configPath = path.join(repositoryRoot, 'commitlint.config.mjs');
  const gitmojiPath = path.join(repositoryRoot, 'scripts', 'validate-gitmoji.mjs');
  if (!(await isFile(configPath)) || !(await isFile(gitmojiPath))) {
    throw new PullRequestTitleValidationError('Pull-request title check: required tooling is not installed or configured.', 2);
  }

  const commitlint = await runInputImpl(
    pnpmCommand,
    ['exec', 'commitlint', '--config', configPath],
    `${title}\n`,
    { cwd: repositoryRoot, env: process.env },
  );
  if (commitlint.error?.code === 'ENOENT') {
    throw new PullRequestTitleValidationError('Pull-request title check: required tooling is not installed or configured.', 2);
  }
  if (commitlint.status !== 0) {
    throw new PullRequestTitleValidationError('Pull-request title check: Conventional Commit validation failed.', 1);
  }

  try {
    validateGitmojiMessage(`${title}\n`);
  } catch {
    throw new PullRequestTitleValidationError('Pull-request title check: Gitmoji validation failed.', 1);
  }
  return true;
}

const isMainModule = process.argv[1]
  && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMainModule) {
  try {
    await validatePullRequestTitle({ title: process.env.PR_TITLE });
    process.stdout.write('Pull-request title check passed.\n');
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = error.exitCode ?? 1;
  }
}
