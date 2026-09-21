import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { parseRepositoryYaml } from './lib/yaml.mjs';
import { validatePrimitiveSelection } from './lib/primitive-selection.mjs';
import { validateEventCatalog } from './lib/event-catalog.mjs';

const execFileAsync = promisify(execFile);
const SHA1 = /^[0-9a-f]{40}$/;
const SHA256 = /^[0-9a-f]{64}$/;
const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

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

async function readTextAtCommitRaw(repository, commit, relativePath) {
  try {
    return await gitRaw(repository, ['show', `${commit}:${relativePath}`]);
  } catch (error) {
    throw new ReleaseChainValidationError(`cannot read ${relativePath} at ${commit} in ${repository}: ${error.message}`);
  }
}

async function git(repository, args) {
  return (await gitRaw(repository, args)).trim();
}

async function gitRaw(repository, args) {
  try {
    return (await execFileAsync('git', ['-C', repository, ...args], {
      encoding: 'utf8',
      windowsHide: true,
      maxBuffer: 32 * 1024 * 1024,
    })).stdout;
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
  const appContract = await readJson(path.join(controlPlaneRoot, 'config/github-app-contract.json'));
  const controllerRepository = appContract.controller?.repository;
  const organization = appContract.organization?.login;
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
  const primitiveCatalog = parseRepositoryYaml(
    primitiveDependency?.commit && SHA1.test(primitiveDependency.commit)
      ? await readTextAtCommit(primitivesRoot, primitiveDependency.commit, 'manifests/primitive-catalog.yml')
      : await readText(path.join(primitivesRoot, 'manifests/primitive-catalog.yml')),
    path.join(primitivesRoot, 'manifests/primitive-catalog.yml'),
  );
  const primitiveSelection = parseRepositoryYaml(
    controller.commit && SHA1.test(controller.commit)
      ? await readTextAtCommit(controlPlaneRoot, controller.commit, 'config/primitive-selection.yml')
      : await readText(path.join(controlPlaneRoot, 'config/primitive-selection.yml')),
    path.join(controlPlaneRoot, 'config/primitive-selection.yml'),
  );
  const orchestrationPolicy = parseRepositoryYaml(
    controller.commit && SHA1.test(controller.commit)
      ? await readTextAtCommit(controlPlaneRoot, controller.commit, 'config/orchestration-policy.yml')
      : await readText(path.join(controlPlaneRoot, 'config/orchestration-policy.yml')),
    path.join(controlPlaneRoot, 'config/orchestration-policy.yml'),
  );
  const eventCatalog = parseRepositoryYaml(
    controller.commit && SHA1.test(controller.commit)
      ? await readTextAtCommit(controlPlaneRoot, controller.commit, 'config/event-catalog.yml')
      : await readText(path.join(controlPlaneRoot, 'config/event-catalog.yml')),
    path.join(controlPlaneRoot, 'config/event-catalog.yml'),
  );
  const bundle = await readJson(path.join(distributionRoot, 'manifests/workflow-bundle.json'));
  const sourceLock = await readJson(path.join(distributionRoot, 'manifests/sources.lock.json'));
  const automationLock = await readJson(path.join(distributionRoot, 'manifests/automation-projections.lock.json'));
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

  if (typeof controllerRepository !== 'string' || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(controllerRepository)) {
    errors.push('Control Plane repository identity must be an owner/repository name');
  }
  if (typeof organization !== 'string' || !/^[A-Za-z0-9_.-]+$/.test(organization)) {
    errors.push('Control Plane organization identity must be a valid owner name');
  }
  equal(errors, 'Architecture dependency repository', architectureDependency.repository, `${organization}/agentic-delivery-architecture`);
  equal(errors, 'Primitive dependency repository', primitiveDependency.repository, `${organization}/agentic-delivery-primitives`);
  equal(errors, 'Architecture release version', architectureRelease.version, architectureDependency.version);
  equal(errors, 'Architecture release source repository', architectureRelease.sourceRepository, architectureDependency.repository);
  equal(errors, 'Architecture release digest', architectureRelease.contentSha256, architectureDependency.contentSha256);
  equal(errors, 'Primitive release version', primitiveRelease.version, primitiveDependency.version);
  equal(errors, 'Primitive release id', primitiveRelease.releaseId, `urn:agentic-delivery:primitive-release:${primitiveDependency.version}`);
  equal(errors, 'Primitive release digest', primitiveRelease.contentSha256, primitiveDependency.contentSha256);
  const primitiveSelectionResult = validatePrimitiveSelection(primitiveSelection, {
    policy: orchestrationPolicy,
    primitiveCatalog,
  });
  if (!primitiveSelectionResult.valid) errors.push(...primitiveSelectionResult.errors.map((error) => `Primitive selection: ${error}`));
  equal(errors, 'Primitive selection repository', primitiveSelection.source?.repository, primitiveDependency.repository);
  equal(errors, 'Primitive selection release id', primitiveSelection.source?.releaseId, primitiveRelease.releaseId);
  equal(errors, 'Primitive selection version', primitiveSelection.source?.version, primitiveDependency.version);
  equal(errors, 'Primitive selection commit', primitiveSelection.source?.commit, primitiveDependency.commit);
  equal(errors, 'Primitive selection digest', primitiveSelection.source?.contentSha256, primitiveDependency.contentSha256);
  equal(errors, 'Primitive selection capability policy', primitiveSelection.source?.capabilityPolicyVersion, primitiveRelease.capabilityPolicyVersion);
  const eventCatalogResult = validateEventCatalog(eventCatalog);
  if (!eventCatalogResult.valid) errors.push(...eventCatalogResult.errors.map((error) => `Event catalog: ${error}`));
  equal(errors, 'Event catalog organization', eventCatalog.organization, organization);
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
    'config/event-catalog.yml',
    'config/github-app-contract.json',
    'scripts/lib/event-catalog.mjs',
  ]) {
    await assertPathAtCommit(
      controlPlaneRoot,
      controller.commit,
      relativePath,
      'Control Plane release content',
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
  equal(errors, 'Automation projection canonical repository', automationLock.canonicalRepository, controllerRepository);
  equal(errors, 'Automation projection source commit', automationLock.sourceCommit, controller.commit);
  equal(errors, 'Automation projection repository', automationLock.projectionRepository, 'agentic-delivery-lab/agentic-delivery-distribution');
  equal(errors, 'Agent Plugin automation source commit', plugin.generatedFrom?.automationSourceCommit, automationLock.sourceCommit);
  const automationIds = new Set();
  for (const [index, template] of (automationLock.templates ?? []).entries()) {
    const prefix = `Automation projection ${index}`;
    if (!template || typeof template !== 'object' || Array.isArray(template)) {
      errors.push(`${prefix} must be an object`);
      continue;
    }
    if (automationIds.has(template.id)) errors.push(`${prefix} duplicates id ${template.id}`);
    automationIds.add(template.id);
    if (!SHA1.test(template.sourceRef ?? '') || template.sourceRef !== automationLock.sourceCommit) errors.push(`${prefix} sourceRef must equal the immutable source commit`);
    if (!SHA256.test(template.contentSha256 ?? '')) errors.push(`${prefix} contentSha256 must be a SHA-256 digest`);
    if (typeof template.sourcePath !== 'string' || template.sourcePath.includes('..')) errors.push(`${prefix} sourcePath is unsafe`);
    if (typeof template.targetPath !== 'string' || template.targetPath.includes('..') || !template.targetPath.startsWith('packages/agent-plugin/automations/')) errors.push(`${prefix} targetPath is unsafe`);
    if (!SHA1.test(automationLock.sourceCommit ?? '')) continue;
    try {
      const source = await readTextAtCommitRaw(controlPlaneRoot, automationLock.sourceCommit, template.sourcePath);
      const projection = await readText(path.join(distributionRoot, template.targetPath));
      equal(errors, `${prefix} projection content`, projection, source);
      equal(errors, `${prefix} source digest`, sha256(source), template.contentSha256);
    } catch (error) {
      errors.push(`${prefix} source/projection could not be reproduced: ${error.message}`);
    }
  }

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
    primitiveSelection: { version: primitiveSelection.source.version, commit: primitiveSelection.source.commit, contentSha256: primitiveSelection.source.contentSha256 },
    eventCatalog: { version: eventCatalog.version },
    distribution: { bundleVersion: bundle.bundleVersion, workflowCommit: bundle.workflowSource.commit, automationProjectionRelease: automationLock.projectionRelease },
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
