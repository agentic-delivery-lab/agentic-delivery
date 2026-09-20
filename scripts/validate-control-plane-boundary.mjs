import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const ORIGIN_REPOSITORY = ['agentic-delivery-lab', 'agentic-delivery'].join('/');
const RUNTIME_ROOTS = ['api/github', 'scripts'];

export class ControlPlaneBoundaryError extends Error {
  constructor(message, exitCode = 1) {
    super(message);
    this.name = 'ControlPlaneBoundaryError';
    this.exitCode = exitCode;
  }
}

async function trackedRuntimeFiles(repositoryRoot) {
  try {
    const { stdout } = await execFileAsync('git', ['-C', repositoryRoot, 'ls-files', '--', ...RUNTIME_ROOTS], { encoding: 'utf8', windowsHide: true });
    return stdout.split(/\r?\n/).filter((file) => file.endsWith('.mjs'));
  } catch (error) {
    throw new ControlPlaneBoundaryError(`Control-plane boundary check: git inventory failed: ${error.message}`, 2);
  }
}

export async function validateControlPlaneBoundary({ repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'), files } = {}) {
  const relativeFiles = files ?? await trackedRuntimeFiles(repositoryRoot);
  const findings = [];
  for (const relativeFile of relativeFiles) {
    const source = await readFile(path.join(repositoryRoot, relativeFile), 'utf8');
    if (source.includes(ORIGIN_REPOSITORY)) findings.push(`${relativeFile} contains the fixed origin repository ${ORIGIN_REPOSITORY}`);
  }
  if (findings.length > 0) {
    throw new ControlPlaneBoundaryError(`${findings.map((finding) => `Control-plane boundary check: ${finding}`).join('\n')}\nControl-plane boundary check failed with ${findings.length} finding(s).`);
  }
  return relativeFiles;
}

const isMainModule = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMainModule) {
  try {
    const files = await validateControlPlaneBoundary({ repositoryRoot: process.argv[2] ?? undefined });
    process.stdout.write(`Control-plane boundary check passed: ${files.length} runtime file(s).\n`);
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = error.exitCode ?? 1;
  }
}
