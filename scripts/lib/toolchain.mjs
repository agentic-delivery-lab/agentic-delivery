import { execFile } from 'node:child_process';
// agentic-primitive: {"id":"toolchain-policy-validator","kind":"validator","enforcement":"deterministic","adrs":["ADR-0008"],"domains":["agentic-delivery-governance"]}
import { access, readFile, stat } from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export const PNPM_COMMAND = 'pnpm';

export const REQUIRED_POLICY = Object.freeze({
  minimumReleaseAge: 2880,
  minimumReleaseAgeStrict: true,
  minimumReleaseAgeIgnoreMissingTime: false,
});

export class ToolchainError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ToolchainError';
  }
}

function toolchainError(message) {
  return new ToolchainError(message);
}

async function isFile(filePath) {
  try {
    await access(filePath, constants.F_OK);
    return (await stat(filePath)).isFile();
  } catch {
    return false;
  }
}

function parseExactPnpmVersion(packageManager) {
  if (typeof packageManager !== 'string') {
    throw toolchainError('package.json must declare an exact pnpm packageManager pin');
  }

  const match = packageManager.match(/^pnpm@(\d+\.\d+\.\d+)$/);
  if (!match) {
    throw toolchainError(`packageManager must be an exact pnpm version, found ${packageManager}`);
  }
  return match[1];
}

export function parseReleaseAgePolicy(source) {
  const values = new Map();
  const lines = source.split(/\r?\n/);

  for (const [index, rawLine] of lines.entries()) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;

    const match = line.match(/^([A-Za-z][A-Za-z0-9_-]*):\s*(.*?)\s*$/);
    if (!match || !match[2] || match[2].startsWith('- ')) {
      throw toolchainError(`malformed pnpm release-age policy at line ${index + 1}`);
    }

    const key = match[1];
    const value = match[2].replace(/\s+#.*$/, '').trim();
    if (values.has(key)) {
      throw toolchainError(`duplicate pnpm release-age policy key: ${key}`);
    }
    if (!Object.hasOwn(REQUIRED_POLICY, key)) {
      throw toolchainError(`unsupported pnpm workspace setting in release-age policy: ${key}`);
    }
    values.set(key, value);
  }

  for (const key of Object.keys(REQUIRED_POLICY)) {
    if (!values.has(key)) {
      throw toolchainError(`missing pnpm release-age policy key: ${key}`);
    }
  }

  const minimumReleaseAge = values.get('minimumReleaseAge');
  if (!/^\d+$/.test(minimumReleaseAge)) {
    throw toolchainError('minimumReleaseAge must be a non-negative integer');
  }
  if (Number(minimumReleaseAge) !== REQUIRED_POLICY.minimumReleaseAge) {
    throw toolchainError('minimumReleaseAge must be exactly 2880 minutes');
  }
  if (values.get('minimumReleaseAgeStrict') !== 'true') {
    throw toolchainError('minimumReleaseAgeStrict must be true');
  }
  if (values.get('minimumReleaseAgeIgnoreMissingTime') !== 'false') {
    throw toolchainError('minimumReleaseAgeIgnoreMissingTime must be false');
  }

  return { ...REQUIRED_POLICY };
}

async function readRequiredFile(filePath, description) {
  if (!(await isFile(filePath))) {
    throw toolchainError(`missing ${description}`);
  }
  try {
    return await readFile(filePath, 'utf8');
  } catch (error) {
    throw toolchainError(`cannot read ${description}: ${error.message}`);
  }
}

export async function readToolchainConfiguration(repositoryRoot) {
  const root = path.resolve(repositoryRoot);
  try {
    if (!(await stat(root)).isDirectory()) {
      throw toolchainError(`repository root does not exist: ${root}`);
    }
  } catch (error) {
    if (error instanceof ToolchainError) throw error;
    throw toolchainError(`repository root does not exist: ${root}`);
  }

  const packageJsonSource = await readRequiredFile(path.join(root, 'package.json'), 'package.json');
  let packageJson;
  try {
    packageJson = JSON.parse(packageJsonSource);
  } catch (error) {
    throw toolchainError(`invalid package.json: ${error.message}`);
  }

  const expectedVersion = parseExactPnpmVersion(packageJson.packageManager);
  const workspaceSource = await readRequiredFile(
    path.join(root, 'pnpm-workspace.yaml'),
    'pnpm-workspace.yaml',
  );
  const policy = parseReleaseAgePolicy(workspaceSource);

  await readRequiredFile(path.join(root, 'pnpm-lock.yaml'), 'pnpm-lock.yaml');
  if (await isFile(path.join(root, 'package-lock.json'))) {
    throw toolchainError('competing package-lock.json is not allowed');
  }

  return {
    repositoryRoot: root,
    expectedVersion,
    packageManager: packageJson.packageManager,
    policy,
  };
}

export async function runToolchainPreflight({
  repositoryRoot,
  execFileImpl = execFileAsync,
  pnpmCommand = PNPM_COMMAND,
  env = process.env,
} = {}) {
  const configuration = await readToolchainConfiguration(repositoryRoot ?? process.cwd());
  let stdout;

  try {
    ({ stdout } = await execFileImpl(pnpmCommand, ['--version'], {
      env,
      encoding: 'utf8',
      timeout: 10_000,
      windowsHide: true,
    }));
  } catch (error) {
    if (error?.code === 'ENOENT') {
      throw toolchainError(
        `pnpm executable is not available on PATH; run npx get-pnpm ${configuration.expectedVersion}`,
      );
    }
    throw toolchainError(`pnpm executable failed while reading its version: ${error.message}`);
  }

  const actualVersion = String(stdout).trim();
  if (actualVersion !== configuration.expectedVersion) {
    throw toolchainError(
      `pnpm version mismatch: expected ${configuration.expectedVersion}, found ${actualVersion || '<missing>'}`,
    );
  }

  return {
    ...configuration,
    pnpmVersion: actualVersion,
  };
}
