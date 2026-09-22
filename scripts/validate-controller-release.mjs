import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { parseRepositoryYaml } from './lib/yaml.mjs';
import { controllerPinMatchesRelease, validateControllerRelease as validateControllerReleaseDocument } from './lib/control-plane-contracts.mjs';
import { parseParticipantRegistry } from './lib/participant-registry.mjs';

const execFileAsync = promisify(execFile);

export class ControllerReleaseValidationError extends Error {
  constructor(message, exitCode = 1) {
    super(message);
    this.name = 'ControllerReleaseValidationError';
    this.exitCode = exitCode;
  }
}

async function git(repositoryRoot, args) {
  try {
    return (await execFileAsync('git', ['-C', repositoryRoot, ...args], { encoding: 'utf8', windowsHide: true })).stdout.trim();
  } catch (error) {
    throw new ControllerReleaseValidationError(`Controller release check: git ${args.join(' ')} failed: ${error.message}`, 2);
  }
}

export async function validateControllerRelease({ repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..') } = {}) {
  const releasePath = path.join(repositoryRoot, 'config', 'controller-release.json');
  const registryPath = path.join(repositoryRoot, 'config', 'participants.yml');
  let release;
  let registry;
  try {
    release = JSON.parse(await readFile(releasePath, 'utf8'));
    registry = parseParticipantRegistry(parseRepositoryYaml(await readFile(registryPath, 'utf8'), registryPath));
  } catch (error) {
    throw new ControllerReleaseValidationError(`Controller release check: cannot read release inputs: ${error.message}`);
  }
  const errors = [];
  const releaseResult = validateControllerReleaseDocument(release);
  if (!releaseResult.valid) errors.push(...releaseResult.errors.map((error) => `release: ${error}`));
  if (!registry.valid) errors.push(...registry.errors.map((error) => `registry: ${error}`));
  if (releaseResult.valid && registry.valid) {
    for (const participant of registry.participants.values()) {
      if (!controllerPinMatchesRelease(release, participant)) errors.push(`registry.${participant.repositoryId} references a controller pin not supported by release ${release.version}`);
    }
    const pins = [release, ...(release.compatibility?.controllers ?? [])];
    for (const pin of pins) {
      const commit = await git(repositoryRoot, ['cat-file', '-t', pin.commit]);
      if (commit !== 'commit') errors.push(`controller pin ${pin.version}@${pin.commit} is not a commit in this repository`);
    }
    const bootstrapCommit = await git(repositoryRoot, ['cat-file', '-t', release.bootstrapCommit]);
    if (bootstrapCommit !== 'commit') errors.push(`bootstrap pin ${release.bootstrapCommit} is not a commit in this repository`);
  }
  if (errors.length > 0) throw new ControllerReleaseValidationError(`${errors.map((error) => `Controller release check: ${error}`).join('\n')}\nController release check failed with ${errors.length} error(s).`);
  return release;
}

const isMainModule = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMainModule) {
  try {
    const release = await validateControllerRelease({ repositoryRoot: process.argv[2] ?? undefined });
    process.stdout.write(`Controller release ${release.version} is valid at ${release.commit}.\n`);
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = error.exitCode ?? 1;
  }
}
