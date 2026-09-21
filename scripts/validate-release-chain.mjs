import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { parseRepositoryYaml } from './lib/yaml.mjs';

const execFileAsync = promisify(execFile);
const SHA1 = /^[0-9a-f]{40}$/;
const SHA256 = /^[0-9a-f]{64}$/;
const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export class ReleaseChainValidationError extends Error {
  constructor(message, exitCode = 1) {
    super(message);
    this.name = 'ReleaseChainValidationError';
    this.exitCode = exitCode;
  }
}

async function readJson(file) {
  try {
    return JSON.parse(await readFile(file, 'utf8'));
  } catch (error) {
    throw new ReleaseChainValidationError(`cannot read JSON ${file}: ${error.message}`);
  }
}

async function readText(file) {
  try {
    return await readFile(file, 'utf8');
  } catch (error) {
    throw new ReleaseChainValidationError(`cannot read ${file}: ${error.message}`);
  }
}

async function readJsonAtCommit(repository, commit, relativePath) {
  try {
    return JSON.parse(await git(repository, ['show', `${commit}:${relativePath}`]));
  } catch (error) {
    throw new ReleaseChainValidationError(`cannot read ${relativePath} at ${commit} in ${repository}: ${error.message}`);
  }
}

async function readTextAtCommit(repository, commit, relativePath) {
  try {
    return await git(repository, ['show', `${commit}:${relativePath}`]);
  } catch (error) {
    throw new ReleaseChainValidationError(`cannot read ${relativePath} at ${commit} in ${repository}: ${error.message}`);
  }
}

async function git(repository, args) {
  try {
    return (await execFileAsync('git', ['-C', repository, ...args], {
      encoding: 'utf8',
      windowsHide: true,
      maxBuffer: 32 * 1024 * 1024,
    })).stdout.trim();
  } catch (error) {
    throw new ReleaseChainValidationError(`git ${args.join(' ')} failed in ${repository}: ${error.message}`, 2);
  }
}

async function assertCommit(repository, commit, label, errors) {
  if (!SHA1.test(commit ?? '')) {
    errors.push(`${label} must be a 40-character commit SHA`);
    return;
  }
  try {
    if ((await git(repository, ['cat-file', '-t', commit])) !== 'commit') errors.push(`${label} is not a commit in ${repository}`);
  } catch (error) {
    errors.push(error.message);
  }
}

async function assertPathAtCommit(repository, commit, relativePath, label, errors) {
  if (!SHA1.test(commit ?? '') || typeof relativePath !== 'string' || relativePath.length === 0) return;
  try {
    await git(repository, ['cat-file', '-e', `${commit}:${relativePath}`]);
  } catch (error) {
    errors.push(`${label} is missing at ${commit}: ${relativePath}`);
  }
}

async function digestWith(repository, script, pinnedCommit, label, errors) {
  let temporaryRoot;
  try {
    // Execute the digest implementation from the exact dependency commit. A
    // current worktree copy is not sufficient evidence: it could have
    // changed after the release was pinned and would then validate the wrong
    // hashing rules. These digest tools are dependency-free ESM modules, so a
    // temporary checkout of the pinned source is enough and leaves no
    // generated repository state behind.
    const pinnedSource = await git(repository, ['show', `${pinnedCommit}:${script}`]);
    temporaryRoot = await mkdtemp(path.join(os.tmpdir(), 'agentic-release-chain-'));
    const temporaryScript = path.join(temporaryRoot, path.basename(script));
    await writeFile(temporaryScript, pinnedSource, 'utf8');
    const output = (await execFileAsync(process.execPath, [temporaryScript, repository, pinnedCommit], {
      encoding: 'utf8',
      windowsHide: true,
      maxBuffer: 32 * 1024 * 1024,
    })).stdout.trim();
    if (!SHA256.test(output)) errors.push(`${label} digest tool returned an invalid SHA-256 digest`);
    return output;
  } catch (error) {
    errors.push(`${label} digest could not be reproduced: ${error.message}`);
    return null;
  } finally {
    if (temporaryRoot) await rm(temporaryRoot, { recursive: true, force: true });
  }
}

function equal(errors, label, actual, expected) {
  if (actual !== expected) errors.push(`${label}: expected ${expected}, got ${actual ?? '<missing>'}`);
}

function sourceById(sources, id) {
  return (sources ?? []).find((source) => source.id === id);
}

/**
 * Validate the immutable release graph across the explicitly supplied
 * repositories. The paths are inputs to a release-coordination check; no
 * runtime code imports a sibling repository or relies on a relative path.
 */
export async function validateReleaseChain({
  controlPlaneRoot = repositoryRoot,
  architectureRoot,
  primitivesRoot,
  distributionRoot,
  privateRoot,
} = {}) {
  const required = { architectureRoot, primitivesRoot, distributionRoot, privateRoot };
  const missing = Object.entries(required).filter(([, value]) => !value).map(([name]) => name);
  if (missing.length > 0) throw new ReleaseChainValidationError(`release-chain check requires: ${missing.join(', ')}`, 2);

  const errors = [];
  const controller = await readJson(path.join(controlPlaneRoot, 'config/controller-release.json'));
  const architectureDependency = controller.dependencies?.architecture;
  const primitiveDependency = controller.dependencies?.primitives;
  if (!architectureDependency || !primitiveDependency) errors.push('controller release must declare Architecture and Primitive dependencies');

  const architectureRelease = architectureDependency?.commit && SHA1.test(architectureDependency.commit)
    ? await readJsonAtCommit(architectureRoot, architectureDependency.commit, 'architecture/generated/architecture-release.json')
    : await readJson(path.join(architectureRoot, 'architecture/generated/architecture-release.json'));
  const primitiveRelease = primitiveDependency?.commit && SHA1.test(primitiveDependency.commit)
    ? await readJsonAtCommit(primitivesRoot, primitiveDependency.commit, 'manifests/primitive-release.json')
    : await readJson(path.join(primitivesRoot, 'manifests/primitive-release.json'));
  const primitiveLock = parseRepositoryYaml(
    architectureDependency?.commit && SHA1.test(architectureDependency.commit)
      ? await readTextAtCommit(architectureRoot, architectureDependency.commit, 'architecture/references/primitive-catalog.lock.yml')
      : await readText(path.join(architectureRoot, 'architecture/references/primitive-catalog.lock.yml')),
    path.join(architectureRoot, 'architecture/references/primitive-catalog.lock.yml'),
  );
  const bundle = await readJson(path.join(distributionRoot, 'manifests/workflow-bundle.json'));
  const sourceLock = await readJson(path.join(distributionRoot, 'manifests/sources.lock.json'));
  const capabilities = await readJson(path.join(distributionRoot, 'manifests/capabilities.lock.json'));
  const plugin = await readJson(path.join(distributionRoot, 'packages/agent-plugin/plugin.json'));
  const privateLock = await readJson(path.join(privateRoot, 'provenance/agents.lock.json'));
  const privateSurface = parseRepositoryYaml(await readText(path.join(privateRoot, 'provenance/surface.yml')), path.join(privateRoot, 'provenance/surface.yml'));
  const privateWorkflow = await readText(path.join(privateRoot, '.github/workflows/validate-published-agents.yml'));
  const issueIntakeWorkflow = await readText(path.join(controlPlaneRoot, '.github/workflows/issue-intake.yml'));
  const codexDeliveryWorkflow = await readText(path.join(controlPlaneRoot, '.github/workflows/codex-delivery.yml'));

  if (!architectureDependency || !primitiveDependency) {
    throw new ReleaseChainValidationError(`release-chain check failed:\n${errors.join('\n')}`);
  }

  equal(errors, 'Architecture dependency repository', architectureDependency.repository, 'agentic-delivery-lab/agentic-delivery-architecture');
  equal(errors, 'Primitive dependency repository', primitiveDependency.repository, 'agentic-delivery-lab/agentic-delivery-primitives');
  equal(errors, 'Architecture release version', architectureRelease.version, architectureDependency.version);
  equal(errors, 'Architecture release source repository', architectureRelease.sourceRepository, architectureDependency.repository);
  equal(errors, 'Architecture release digest', architectureRelease.contentSha256, architectureDependency.contentSha256);
  equal(errors, 'Primitive release version', primitiveRelease.version, primitiveDependency.version);
  equal(errors, 'Primitive release id', primitiveRelease.releaseId, `urn:agentic-delivery:primitive-release:${primitiveDependency.version}`);
  equal(errors, 'Primitive release digest', primitiveRelease.contentSha256, primitiveDependency.contentSha256);
  equal(errors, 'Architecture lock repository', primitiveLock.source?.repository, primitiveDependency.repository);
  equal(errors, 'Architecture lock release version', primitiveLock.source?.releaseVersion, primitiveDependency.version);
  equal(errors, 'Architecture lock source commit', primitiveLock.source?.sourceCommit, primitiveDependency.commit);
  equal(errors, 'Architecture lock digest', primitiveLock.source?.contentSha256, primitiveDependency.contentSha256);

  await assertCommit(architectureRoot, architectureDependency.commit, 'Architecture dependency commit', errors);
  await assertCommit(primitivesRoot, primitiveDependency.commit, 'Primitive dependency commit', errors);
  await assertCommit(controlPlaneRoot, controller.commit, 'Control Plane release commit', errors);
  await assertCommit(controlPlaneRoot, controller.bootstrapCommit, 'Control Plane bootstrap commit', errors);
  await assertCommit(controlPlaneRoot, bundle.workflowSource?.commit, 'Distribution workflow source commit', errors);
  for (const relativePath of [
    'scripts/authorize-issue-event.mjs',
    'scripts/prepare-agent-invocation.mjs',
    'scripts/lib/participant-registry.mjs',
    'config/participants.yml',
    'package.json',
    'pnpm-lock.yaml',
  ]) {
    await assertPathAtCommit(
      controlPlaneRoot,
      controller.bootstrapCommit,
      relativePath,
      'Control Plane bootstrap content',
      errors,
    );
  }
  for (const relativePath of [
    'scripts/validate-published-agents.mjs',
    'package.json',
    'pnpm-lock.yaml',
    '.github/workflows/agentic-delivery-quality.yml',
    '.github/workflows/agentic-delivery-architecture-review.yml',
  ]) {
    await assertPathAtCommit(
      controlPlaneRoot,
      bundle.workflowSource?.commit,
      relativePath,
      'Distribution workflow source content',
      errors,
    );
  }
  const architectureDigest = await digestWith(architectureRoot, 'tools/architecture-content-digest.mjs', architectureDependency.commit, 'Architecture', errors);
  const primitiveDigest = await digestWith(primitivesRoot, 'tools/primitive-content-digest.mjs', primitiveDependency.commit, 'Primitive', errors);
  equal(errors, 'Architecture dependency digest', architectureDigest, architectureDependency.contentSha256);
  equal(errors, 'Primitive dependency digest', primitiveDigest, primitiveDependency.contentSha256);

  equal(errors, 'Distribution Control Plane commit', bundle.controlPlane?.commit, controller.commit);
  equal(errors, 'Distribution Architecture commit', bundle.architecture?.commit, architectureDependency.commit);
  equal(errors, 'Distribution Architecture digest', bundle.architecture?.contentSha256, architectureDependency.contentSha256);
  equal(errors, 'Distribution workflow repository', bundle.workflowSource?.repository, bundle.controlPlane?.repository);
  const lockedControlPlane = sourceById(sourceLock.sources, 'control-plane');
  const lockedArchitecture = sourceById(sourceLock.sources, 'architecture');
  const lockedPrimitives = sourceById(sourceLock.sources, 'primitives');
  const lockedWorkflow = sourceById(sourceLock.sources, 'distribution-workflow');
  equal(errors, 'Source lock Control Plane commit', lockedControlPlane?.commit, bundle.controlPlane?.commit);
  equal(errors, 'Source lock Architecture commit', lockedArchitecture?.commit, bundle.architecture?.commit);
  equal(errors, 'Source lock Primitive commit', lockedPrimitives?.commit, primitiveDependency.commit);
  equal(errors, 'Source lock workflow commit', lockedWorkflow?.commit, bundle.workflowSource?.commit);
  equal(errors, 'Capabilities Primitive repository', capabilities.primitiveRepository, primitiveDependency.repository);
  equal(errors, 'Capabilities Primitive release', capabilities.primitiveRelease, primitiveRelease.releaseId);
  equal(errors, 'Capabilities Primitive commit', capabilities.sourceCommit, primitiveDependency.commit);
  equal(errors, 'Capabilities Primitive digest', capabilities.contentSha256, primitiveDependency.contentSha256);
  equal(errors, 'Agent Plugin Primitive release', plugin.generatedFrom?.primitiveRelease, primitiveRelease.releaseId);
  equal(errors, 'Agent Plugin Primitive commit', plugin.generatedFrom?.primitiveSourceCommit, primitiveDependency.commit);
  equal(errors, 'Agent Plugin Primitive digest', plugin.generatedFrom?.primitiveContentSha256, primitiveDependency.contentSha256);
  equal(errors, 'Agent Plugin Architecture commit', plugin.generatedFrom?.architectureCommit, architectureDependency.commit);
  equal(errors, 'Agent Plugin Architecture digest', plugin.generatedFrom?.architectureContentSha256, architectureDependency.contentSha256);
  equal(errors, 'Agent Plugin Control Plane commit', plugin.generatedFrom?.controlPlaneCommit, controller.commit);

  if (!issueIntakeWorkflow.includes(`ref: ${controller.bootstrapCommit}`)) errors.push('issue-intake bootstrap must pin the release bootstrap commit');
  if (/^\s*ref:\s*main\s*$/m.test(issueIntakeWorkflow)) errors.push('issue-intake must not check out a moving main ref');
  if (codexDeliveryWorkflow.includes("|| 'main'")) errors.push('codex delivery must not fall back to a moving main ref');

  equal(errors, 'Private surface repository name', privateSurface.repositoryName, '.github-private');
  equal(errors, 'Private surface visibility', privateSurface.requiredVisibility, 'private');
  equal(errors, 'Private publication canonical repository', privateLock.canonicalRepository, primitiveDependency.repository);
  if (!Array.isArray(privateLock.agents)) errors.push('private publication lock agents must be an array');
  if (!privateWorkflow.includes(`repository: ${bundle.workflowSource?.repository}`)) errors.push('private validator must check out the declared workflow source repository');
  if (!privateWorkflow.includes(`ref: ${bundle.workflowSource?.commit}`)) errors.push('private validator must pin the declared workflow source commit');
  if (!/^\s*persist-credentials:\s*false\s*$/m.test(privateWorkflow)) errors.push('private validator checkouts must disable persisted credentials');
  if (/^\s*secrets\s*:/m.test(privateWorkflow)) errors.push('private publication workflow must not receive central secrets');
  for (const [index, agent] of (Array.isArray(privateLock.agents) ? privateLock.agents : []).entries()) {
    const prefix = `private publication agent ${index}`;
    equal(errors, `${prefix} source repository`, agent.sourceRepository, primitiveDependency.repository);
    equal(errors, `${prefix} source commit`, agent.sourceCommit, primitiveDependency.commit);
    equal(errors, `${prefix} source ref`, agent.sourceRef, primitiveDependency.commit);
    equal(errors, `${prefix} promotion release`, agent.promotionRelease, primitiveRelease.releaseId);
    if (!SHA256.test(agent.contentSha256 ?? '')) errors.push(`${prefix} contentSha256 must be a SHA-256 digest`);
  }

  if (errors.length > 0) throw new ReleaseChainValidationError(`release-chain check failed:\n${errors.join('\n')}`);
  return {
    status: 'passed',
    controller: { version: controller.version, commit: controller.commit, bootstrapCommit: controller.bootstrapCommit },
    architecture: { version: architectureDependency.version, commit: architectureDependency.commit, contentSha256: architectureDependency.contentSha256 },
    primitives: { version: primitiveDependency.version, commit: primitiveDependency.commit, contentSha256: primitiveDependency.contentSha256 },
    distribution: { bundleVersion: bundle.bundleVersion, workflowCommit: bundle.workflowSource.commit },
    privatePublicationAgents: Array.isArray(privateLock.agents) ? privateLock.agents.length : 0,
  };
}

function parseArguments(argv) {
  const values = {};
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--') continue;
    if (argument === '--json') {
      values.json = true;
      continue;
    }
    if (!argument.startsWith('--') || !argv[index + 1] || argv[index + 1].startsWith('--')) throw new ReleaseChainValidationError(`invalid argument: ${argument}`, 2);
    values[argument.slice(2).replaceAll('-', '')] = argv[++index];
  }
  return values;
}

const isMainModule = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMainModule) {
  try {
    const args = parseArguments(process.argv.slice(2));
    const result = await validateReleaseChain({
      controlPlaneRoot: args.controlplaneroot ?? repositoryRoot,
      architectureRoot: args.architectureroot,
      primitivesRoot: args.primitivesroot,
      distributionRoot: args.distributionroot,
      privateRoot: args.privateroot,
    });
    process.stdout.write(args.json ? `${JSON.stringify(result, null, 2)}\n` : `Release chain ${result.status}: Control Plane ${result.controller.version}@${result.controller.commit}; Architecture ${result.architecture.version}; Primitives ${result.primitives.version}; ${result.privatePublicationAgents} private publication agent(s).\n`);
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = error.exitCode ?? 1;
  }
}
