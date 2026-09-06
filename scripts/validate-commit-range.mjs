import { execFile, spawn } from 'node:child_process';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { PNPM_COMMAND } from './lib/toolchain.mjs';

const execFileAsync = promisify(execFile);

export class CommitRangeValidationError extends Error {
  constructor(message, exitCode = 1) {
    super(message);
    this.name = 'CommitRangeValidationError';
    this.exitCode = exitCode;
  }
}

async function isFile(filePath) {
  try {
    return (await stat(filePath)).isFile();
  } catch {
    return false;
  }
}

async function runInput(command, args, input, options = {}) {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      ...options,
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
      process.stdout.write(chunk);
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
      process.stderr.write(chunk);
    });
    child.on('error', (error) => resolve({ status: null, stdout, stderr, error }));
    child.on('close', (status) => resolve({ status, stdout, stderr }));
    child.stdin.end(input);
  });
}

async function git(repositoryRoot, args, options = {}) {
  return execFileAsync('git', ['-C', repositoryRoot, ...args], {
    encoding: 'utf8',
    windowsHide: true,
    ...options,
  });
}

export async function validateCommitRange({
  base,
  head,
  repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'),
  toolingRoot = repositoryRoot,
  pnpmCommand = PNPM_COMMAND,
  runInputImpl = runInput,
} = {}) {
  const configPath = path.join(toolingRoot, 'commitlint.config.mjs');
  const gitmojiValidator = path.join(toolingRoot, 'scripts', 'validate-gitmoji.mjs');
  if (!(await isFile(configPath)) || !(await isFile(gitmojiValidator))) {
    throw new CommitRangeValidationError('Commit range check: required tooling is not installed or configured', 2);
  }

  try {
    await git(repositoryRoot, ['rev-parse', '--git-dir']);
  } catch {
    throw new CommitRangeValidationError('Commit range check: repository root is not a Git repository', 2);
  }

  const resolveCommit = async (revision) => {
    try {
      await git(repositoryRoot, ['rev-parse', '--verify', `${revision}^{commit}`]);
      return true;
    } catch {
      return false;
    }
  };

  let commitList;
  if (/^0{40}$/.test(base)) {
    if (!(await resolveCommit(head))) {
      throw new CommitRangeValidationError(`Commit range check: invalid head commit: ${head}`, 2);
    }
    ({ stdout: commitList } = await git(repositoryRoot, ['rev-list', '--reverse', '--no-merges', head]));
  } else {
    if (!(await resolveCommit(base)) || !(await resolveCommit(head))) {
      throw new CommitRangeValidationError('Commit range check: base and head must name existing commits', 2);
    }
    try {
      await git(repositoryRoot, ['merge-base', '--is-ancestor', base, head]);
    } catch {
      throw new CommitRangeValidationError('Commit range check: base must be an ancestor of head', 2);
    }
    ({ stdout: commitList } = await git(repositoryRoot, ['rev-list', '--reverse', '--no-merges', `${base}..${head}`]));
  }

  for (const commit of commitList.trim().split(/\r?\n/).filter(Boolean)) {
    const { stdout: message } = await git(repositoryRoot, ['show', '--quiet', '--format=%B', commit]);
    const commitlint = await runInputImpl(
      pnpmCommand,
      ['exec', 'commitlint', '--config', configPath],
      message,
      { cwd: toolingRoot, env: process.env },
    );
    if (commitlint.error?.code === 'ENOENT') {
      throw new CommitRangeValidationError('Commit range check: required tooling is not installed or configured', 2);
    }
    if (commitlint.status !== 0) {
      throw new CommitRangeValidationError(`Commit range check: Conventional Commit validation failed for ${commit}`, 1);
    }

    const gitmoji = await runInputImpl(
      process.execPath,
      [gitmojiValidator],
      message,
      { cwd: toolingRoot, env: process.env },
    );
    if (gitmoji.error) {
      throw new CommitRangeValidationError('Commit range check: required tooling is not installed or configured', 2);
    }
    if (gitmoji.status !== 0) {
      throw new CommitRangeValidationError(`Commit range check: Gitmoji validation failed for ${commit}`, 1);
    }
  }

  return true;
}

const isMainModule = process.argv[1]
  && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMainModule) {
  const args = process.argv.slice(2);
  if (args[0] === '--') args.shift();
  if (args.length !== 2) {
    process.stderr.write(`Usage: ${path.basename(process.argv[1])} <base commit> <head commit>\n`);
    process.exitCode = 2;
  } else {
    try {
      await validateCommitRange({ base: args[0], head: args[1] });
      process.stdout.write('Commit range check passed.\n');
    } catch (error) {
      process.stderr.write(`${error.message}\n`);
      process.exitCode = error.exitCode ?? 1;
    }
  }
}
