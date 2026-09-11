// agentic-primitive: {"id":"main-history-validator","kind":"validator","enforcement":"deterministic","adrs":["ADR-0004"],"domains":["agentic-delivery-governance"]}
import { execFile } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export class MainHistoryValidationError extends Error {
  constructor(message, exitCode = 1) {
    super(message);
    this.name = 'MainHistoryValidationError';
    this.exitCode = exitCode;
  }
}

async function git(repositoryRoot, args) {
  return execFileAsync('git', ['-C', repositoryRoot, ...args], {
    encoding: 'utf8',
    windowsHide: true,
  });
}

export async function validateMainHistory({
  base,
  head,
  repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'),
} = {}) {
  if (!base || !head) {
    throw new MainHistoryValidationError('Main history check: base and head commits are required.', 2);
  }
  const revisionRange = /^0{40}$/.test(base) ? head : `${base}..${head}`;
  let nonMergeCommits;
  try {
    ({ stdout: nonMergeCommits } = await git(repositoryRoot, ['rev-list', '--first-parent', '--no-merges', revisionRange]));
  } catch {
    throw new MainHistoryValidationError('Main history check: base and head must name existing commits.', 2);
  }
  if (nonMergeCommits.trim()) {
    let log = nonMergeCommits.trim();
    try {
      ({ stdout: log } = await git(repositoryRoot, ['log', '--first-parent', '--no-merges', '--format=%h %s', revisionRange]));
    } catch {
      // Keep the commit IDs as a useful fallback when the diagnostic log cannot be read.
    }
    throw new MainHistoryValidationError(
      `main received non-merge first-parent commits:\n${log.trim()}`,
      1,
    );
  }
  return true;
}

const isMainModule = process.argv[1]
  && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMainModule) {
  if (process.argv.length !== 4) {
    process.stderr.write(`Usage: ${path.basename(process.argv[1])} <base commit> <head commit>\n`);
    process.exitCode = 2;
  } else {
    try {
      await validateMainHistory({
        base: process.argv[2],
        head: process.argv[3],
      });
      process.stdout.write('Main history check passed.\n');
    } catch (error) {
      process.stderr.write(`${error.message}\n`);
      process.exitCode = error.exitCode ?? 1;
    }
  }
}
