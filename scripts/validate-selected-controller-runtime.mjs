import { execFile } from 'node:child_process';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export class SelectedControllerRuntimeValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'SelectedControllerRuntimeValidationError';
  }
}

async function git(repositoryRoot, args) {
  try {
    return (await execFileAsync('git', ['-C', repositoryRoot, ...args], { encoding: 'utf8', windowsHide: true })).stdout.trim();
  } catch (error) {
    throw new SelectedControllerRuntimeValidationError(`Selected controller check: git ${args.join(' ')} failed: ${error.message}`);
  }
}

export async function validateSelectedControllerRuntime({
  repositoryRoot = process.env.GITHUB_WORKSPACE ?? process.cwd(),
  selectedControllerCommit = process.env.CONTROLLER_COMMIT,
} = {}) {
  if (typeof selectedControllerCommit !== 'string' || !/^[0-9a-f]{40}$/.test(selectedControllerCommit)) {
    throw new SelectedControllerRuntimeValidationError('Selected controller check: controller pin must be a 40-character lowercase hexadecimal SHA.');
  }

  const checkedOutCommit = await git(repositoryRoot, ['rev-parse', 'HEAD']);
  if (checkedOutCommit !== selectedControllerCommit) {
    throw new SelectedControllerRuntimeValidationError(`Selected controller check: checked-out commit ${checkedOutCommit} does not match controller pin ${selectedControllerCommit}.`);
  }

  for (const runtimeFile of ['scripts/mask-issue-field-bindings.mjs']) {
    try {
      if (!(await stat(path.join(repositoryRoot, runtimeFile))).isFile()) {
        throw new Error('not a file');
      }
    } catch {
      throw new SelectedControllerRuntimeValidationError(`Selected controller pin ${selectedControllerCommit} is missing required runtime file ${runtimeFile}.`);
    }
  }

  return { commit: checkedOutCommit };
}

const isMainModule = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMainModule) {
  try {
    const result = await validateSelectedControllerRuntime();
    process.stdout.write(`Selected controller pin ${result.commit} contains required runtime assets.\n`);
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}
