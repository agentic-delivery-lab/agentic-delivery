import { access, readFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SHA = /^[0-9a-f]{40}$/;
const DEFAULT_SURFACE_ROOT = path.resolve(repositoryRoot, '../.github');

export class PublicGovernanceValidationError extends Error {
  constructor(message, exitCode = 1) {
    super(message);
    this.name = 'PublicGovernanceValidationError';
    this.exitCode = exitCode;
  }
}

async function exists(file) {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
}

async function read(file) {
  try {
    return await readFile(file, 'utf8');
  } catch (error) {
    throw new PublicGovernanceValidationError(`cannot read ${file}: ${error.message}`);
  }
}

async function git(root, args) {
  try {
    return (await execFileAsync('git', ['-C', root, ...args], { encoding: 'utf8', windowsHide: true })).stdout.trim();
  } catch (error) {
    throw new PublicGovernanceValidationError(`git ${args.join(' ')} failed in ${root}: ${error.message}`, 2);
  }
}

async function runSurfaceValidator(surfaceRoot) {
  const validator = path.join(surfaceRoot, 'scripts/validate-governance.mjs');
  if (!(await exists(validator))) throw new PublicGovernanceValidationError('public surface validator is missing');
  try {
    await execFileAsync(process.execPath, [validator], { cwd: surfaceRoot, encoding: 'utf8', windowsHide: true });
  } catch (error) {
    const output = `${error.stdout ?? ''}${error.stderr ?? ''}`.trim();
    throw new PublicGovernanceValidationError(`public surface validator failed${output ? `: ${output}` : ''}`);
  }
}

export async function validatePublicGovernance({
  surfaceRoot = DEFAULT_SURFACE_ROOT,
  controlPlaneRoot = repositoryRoot,
  expectedCommit,
} = {}) {
  const root = path.resolve(surfaceRoot);
  const controller = JSON.parse(await read(path.join(controlPlaneRoot, 'config/controller-release.json')));
  if (!SHA.test(controller.commit ?? '')) throw new PublicGovernanceValidationError('current Control Plane release must pin an immutable commit');
  await runSurfaceValidator(root);

  const actualCommit = await git(root, ['rev-parse', 'HEAD']);
  if (!SHA.test(actualCommit)) throw new PublicGovernanceValidationError('public surface HEAD is not an immutable commit');
  if (expectedCommit !== undefined && expectedCommit !== actualCommit) {
    throw new PublicGovernanceValidationError(`public surface commit mismatch: expected ${expectedCommit}, got ${actualCommit}`);
  }

  const workflow = await read(path.join(root, 'workflow-templates/agentic-delivery-quality.yml'));
  const pin = controller.commit;
  if (!workflow.includes(`.github/workflows/agentic-delivery-quality.yml@${pin}`)) {
    throw new PublicGovernanceValidationError('public workflow template must pin the current Control Plane workflow source');
  }
  if (!workflow.includes(`controller_commit: ${pin}`)) {
    throw new PublicGovernanceValidationError('public workflow template must pass the current Control Plane release pin');
  }
  if (workflow.includes('secrets: inherit')) throw new PublicGovernanceValidationError('public workflow template must not inherit secrets');
  return { status: 'passed', surfaceCommit: actualCommit, controller: { version: controller.version, commit: pin } };
}

function parseArguments(argv) {
  const values = {};
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--') continue;
    if (!argument.startsWith('--') || !argv[index + 1] || argv[index + 1].startsWith('--')) {
      throw new PublicGovernanceValidationError(`invalid argument: ${argument}`, 2);
    }
    values[argument.slice(2).replaceAll('-', '')] = argv[++index];
  }
  return values;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = parseArguments(process.argv.slice(2));
    const result = await validatePublicGovernance({
      surfaceRoot: args.surfaceroot,
      controlPlaneRoot: args.controlplaneroot,
      expectedCommit: args.expectedcommit,
    });
    process.stdout.write(`Public governance check passed: ${result.surfaceCommit} with Control Plane ${result.controller.version}.\n`);
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = error.exitCode ?? 1;
  }
}
