import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { parseRepositoryYaml } from './lib/yaml.mjs';

const execFileAsync = promisify(execFile);
const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SHA1 = /^[0-9a-f]{40}$/;
const SHA256 = /^[0-9a-f]{64}$/;
const DEFAULT_REPOSITORY = 'agentic-delivery-lab/agentic-delivery-architecture';
const REQUIRED_PATHS = [
  'architecture/generated/architecture-release.json',
  'architecture/generated/adr-primitive-index.json',
  'architecture/harness-review.yml',
  'architecture/policies/conformance.yml',
  'architecture/domain/ubiquitous-language.yml',
  'decisions/README.md',
  ...Array.from({ length: 12 }, (_, index) => `architecture/arc42/${String(index + 1).padStart(2, '0')}-`),
];

export class ArchitecturePinValidationError extends Error {
  constructor(message, exitCode = 1) {
    super(message);
    this.name = 'ArchitecturePinValidationError';
    this.exitCode = exitCode;
  }
}

async function git(root, args, encoding = 'utf8') {
  try {
    return (await execFileAsync('git', ['-C', root, ...args], {
      encoding,
      windowsHide: true,
      maxBuffer: 32 * 1024 * 1024,
    })).stdout;
  } catch (error) {
    throw new ArchitecturePinValidationError(`git ${args.join(' ')} failed in ${root}: ${error.message}`, 2);
  }
}

async function atCommit(root, commit, file, encoding = 'utf8') {
  return git(root, ['show', `${commit}:${file}`], encoding);
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

async function digestAtCommit(root, commit) {
  const source = await atCommit(root, commit, 'tools/architecture-content-digest.mjs');
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), 'agentic-architecture-pin-'));
  const temporaryScript = path.join(temporaryRoot, 'architecture-content-digest.mjs');
  try {
    await writeFile(temporaryScript, source, 'utf8');
    return (await execFileAsync(process.execPath, [temporaryScript, root, commit], {
      encoding: 'utf8',
      windowsHide: true,
      maxBuffer: 32 * 1024 * 1024,
    })).stdout.trim();
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
}

function releaseError(errors) {
  return new ArchitecturePinValidationError(`Architecture pin validation failed:\n${errors.join('\n')}`);
}

/**
 * Validate an Architecture Authority checkout against an immutable release
 * pin. The validator reads every authoritative value from the requested Git
 * commit; a mutable worktree or branch name is never used as review context.
 */
export async function validateArchitecturePin({
  architectureRoot,
  architectureCommit,
  architectureDigest,
  architectureVersion,
  expectedRepository = DEFAULT_REPOSITORY,
  requireHead = true,
} = {}) {
  if (!architectureRoot || !architectureCommit) {
    throw new ArchitecturePinValidationError('architectureRoot and architectureCommit are required', 2);
  }
  if (!SHA1.test(String(architectureCommit))) {
    throw new ArchitecturePinValidationError('architectureCommit must be a 40-character immutable SHA', 2);
  }
  if (architectureDigest !== undefined && !SHA256.test(String(architectureDigest))) {
    throw new ArchitecturePinValidationError('architectureDigest must be a 64-character SHA-256 digest', 2);
  }

  const errors = [];
  await git(architectureRoot, ['cat-file', '-e', `${architectureCommit}^{commit}`]);
  const head = (await git(architectureRoot, ['rev-parse', 'HEAD'])).trim();
  if (requireHead && head !== architectureCommit) errors.push(`checked-out Architecture HEAD ${head} does not equal requested commit ${architectureCommit}`);

  let release;
  try {
    release = JSON.parse(await atCommit(architectureRoot, architectureCommit, 'architecture/generated/architecture-release.json'));
  } catch (error) {
    errors.push(`cannot read architecture release manifest: ${error.message}`);
    release = {};
  }

  if (release.schemaVersion !== 1) errors.push('Architecture release schemaVersion must be 1');
  if (release.sourceRepository !== expectedRepository) errors.push(`Architecture release sourceRepository must be ${expectedRepository}`);
  if (!SHA1.test(String(release.sourceCommit ?? ''))) errors.push('Architecture release sourceCommit must be immutable');
  if (!SHA256.test(String(release.contentSha256 ?? ''))) errors.push('Architecture release contentSha256 must be a SHA-256 digest');
  if (architectureVersion !== undefined && release.version !== architectureVersion) errors.push(`Architecture release version must be ${architectureVersion}`);
  if (architectureDigest !== undefined && release.contentSha256 !== architectureDigest) errors.push('Architecture release digest does not match the requested review pin');

  for (const required of REQUIRED_PATHS) {
    if (required.endsWith('-')) {
      const files = (await git(architectureRoot, ['ls-tree', '-r', '--name-only', architectureCommit, '--', 'architecture/arc42']))
        .split(/\r?\n/).filter(Boolean);
      if (!files.some((file) => file.startsWith(required))) errors.push(`Architecture release is missing arc42 section prefix ${required}`);
    } else {
      try {
        await git(architectureRoot, ['cat-file', '-e', `${architectureCommit}:${required}`]);
      } catch {
        errors.push(`Architecture release is missing required path ${required}`);
      }
    }
  }

  if (release.conformancePolicy?.path) {
    try {
      const policySource = await atCommit(architectureRoot, architectureCommit, release.conformancePolicy.path);
      if (sha256(policySource) !== release.conformancePolicy.sha256) errors.push('Architecture conformance policy digest does not match its release manifest');
      const policy = parseRepositoryYaml(policySource, release.conformancePolicy.path);
      if (policy.policy?.architecturePinRequired !== true) errors.push('Architecture conformance policy must require an architecture pin');
      if (policy.policy?.architectureDigestRequired !== true) errors.push('Architecture conformance policy must require an architecture digest');
      if (policy.policy?.deterministicFindingsAreBlocking !== true) errors.push('Architecture conformance policy must make deterministic findings blocking');
      if (policy.policy?.consumerWriteAccess !== false) errors.push('Architecture conformance policy must deny consumer write access');
    } catch (error) {
      errors.push(`Architecture conformance policy could not be validated: ${error.message}`);
    }
  } else errors.push('Architecture release must declare a conformance policy path');

  if (release.toolingLock?.path) {
    try {
      const toolingSource = await atCommit(architectureRoot, architectureCommit, release.toolingLock.path);
      if (sha256(toolingSource) !== release.toolingLock.sha256) errors.push('Architecture tooling lock digest does not match its release manifest');
    } catch (error) {
      errors.push(`Architecture tooling lock could not be validated: ${error.message}`);
    }
  } else errors.push('Architecture release must declare a tooling lock path');

  let reproducedDigest = null;
  try {
    reproducedDigest = await digestAtCommit(architectureRoot, architectureCommit);
    if (!SHA256.test(reproducedDigest)) errors.push('Architecture digest tool returned an invalid SHA-256 digest');
    if (reproducedDigest !== release.contentSha256) errors.push('Architecture content digest does not reproduce the release manifest');
    if (architectureDigest !== undefined && reproducedDigest !== architectureDigest) errors.push('Architecture content digest does not match the requested review pin');
  } catch (error) {
    errors.push(`Architecture content digest could not be reproduced: ${error.message}`);
  }

  if (errors.length > 0) throw releaseError(errors);
  return {
    status: 'passed',
    repository: release.sourceRepository,
    commit: architectureCommit,
    checkedOutHead: head,
    version: release.version,
    contentSha256: release.contentSha256,
    reproducedDigest,
    conformancePolicy: release.conformancePolicy.path,
    toolingLock: release.toolingLock.path,
  };
}

function parseArguments(argv) {
  const values = {};
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    // pnpm forwards the conventional option separator when a caller invokes
    // `pnpm architecture:pin:check -- --architecture-root ...`. Treat it as
    // a transport delimiter, not as a validator argument.
    if (argument === '--') continue;
    if (argument === '--json') {
      values.json = true;
      continue;
    }
    if (!argument.startsWith('--') || !argv[index + 1] || argv[index + 1].startsWith('--')) throw new ArchitecturePinValidationError(`invalid argument: ${argument}`, 2);
    values[argument.slice(2).replaceAll('-', '')] = argv[++index];
  }
  return values;
}

const isMainModule = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMainModule) {
  try {
    const args = parseArguments(process.argv.slice(2));
    const result = await validateArchitecturePin({
      architectureRoot: args.architectureroot,
      architectureCommit: args.architecturecommit,
      architectureDigest: args.architecturedigest,
      architectureVersion: args.architectureversion,
    });
    process.stdout.write(args.json ? `${JSON.stringify(result, null, 2)}\n` : `Architecture pin passed: ${result.version}@${result.commit} (${result.contentSha256}).\n`);
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = error.exitCode ?? 1;
  }
}
