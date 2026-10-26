import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';
import { promisify } from 'node:util';

import { validateNativeProducerSources, validateReleaseChain } from '../../scripts/validate-release-chain.mjs';
import { parseRepositoryYaml } from '../../scripts/lib/yaml.mjs';

const exec = promisify(execFile);
const root = path.resolve(import.meta.dirname, '../..');
const architectureRoot = process.env.RELEASE_GRAPH_ARCHITECTURE_ROOT ?? process.env.ARCHITECTURE_PIN_TEST_ROOT
  ?? path.resolve(root, '../agentic-delivery-architecture');
const primitivesRoot = process.env.RELEASE_GRAPH_PRIMITIVES_ROOT ?? path.resolve(root, '../agentic-delivery-primitives');
const architectureCommit = '59df514a3a6dc8a75b79b3fc75fe61aae4e6fdf3';
const primitiveCommit = '69beab027d8b28fc082fa6054f4def5ba0146e3c';
const cpRepository = 'agentic-delivery-lab/agentic-delivery';
const primitiveRepository = 'agentic-delivery-lab/agentic-delivery-agent-customizations';
const hash = value => createHash('sha256').update(value).digest('hex');
async function git(directory, ...args) {
  return (await exec('git', ['-C', directory, ...args], { maxBuffer: 32 * 1024 * 1024 })).stdout;
}
async function json(directory, file, value) {
  await mkdir(path.dirname(path.join(directory, file)), { recursive: true });
  await writeFile(path.join(directory, file), `${JSON.stringify(value, null, 2)}\n`);
}

// Planned source compatibility only: real immutable producers and a synthetic
// controller/projection combination. This is not adoption or hosting proof.
async function fixture(t) {
  const container = `${root}.worktrees`;
  await mkdir(container, { recursive: true });
  const scratch = await mkdtemp(path.join(container, 'release-graph-v3-'));
  t.after(() => rm(scratch, { recursive: true, force: true }));
  const controlPlaneRoot = path.join(scratch, 'controller');
  const distributionRoot = path.join(scratch, 'distribution');
  const privateRoot = path.join(scratch, 'synthetic-publication');
  await exec('git', ['clone', '--quiet', '--shared', root, controlPlaneRoot]);
  const base = (await git(controlPlaneRoot, 'rev-parse', 'HEAD')).trim();
  const checkedOutRelease = JSON.parse(await readFile(path.join(controlPlaneRoot, 'config/controller-release.json'), 'utf8'));
  const release = JSON.parse(await git(controlPlaneRoot, 'show', '52d1dea2f6259d365723f90ce01d771da802edc9:config/controller-release.json'));
  const architecture = JSON.parse(await git(architectureRoot, 'show', `${architectureCommit}:architecture/generated/architecture-release.json`));
  const primitive = JSON.parse(await git(primitivesRoot, 'show', `${primitiveCommit}:manifests/primitive-release.json`));
  const selectionPath = 'config/primitive-selection.yml';
  const selection = parseRepositoryYaml(await readFile(path.join(controlPlaneRoot, selectionPath), 'utf8'), selectionPath);
  Object.assign(selection.source, {
    repository: primitiveRepository, repositoryId: '1380894656', releaseId: primitive.releaseId,
    version: primitive.version, commit: primitiveCommit, contentSha256: primitive.contentSha256,
    capabilityPolicyVersion: primitive.capabilityPolicyVersion,
  });
  await json(controlPlaneRoot, selectionPath, selection);
  for (const file of ['.github/workflows/issue-intake.yml', '.github/workflows/codex-delivery.yml']) {
    const source = await readFile(path.join(controlPlaneRoot, file), 'utf8');
    await writeFile(path.join(controlPlaneRoot, file), source.replaceAll(checkedOutRelease.bootstrapCommit, base));
  }
  await git(controlPlaneRoot, 'add', '.');
  await git(controlPlaneRoot, '-c', 'user.name=Synthetic graph fixture', '-c', 'user.email=fixture@example.invalid',
    'commit', '--allow-empty', '-qm', 'Synthetic current-source selection');
  const codeCommit = (await git(controlPlaneRoot, 'rev-parse', 'HEAD')).trim();
  Object.assign(release, { schemaVersion: 3, $schema: '../schemas/controller-release.v3.schema.json',
    version: '0.2.0-draft.67', commit: codeCommit, bootstrapCommit: base });
  release.dependencies = {
    architecture: { repository: 'agentic-delivery-lab/agentic-delivery-architecture', repositoryId: 1380894616,
      version: architecture.version, commit: architectureCommit, contentSha256: architecture.contentSha256 },
    primitives: { repository: primitiveRepository, repositoryId: 1380894656,
      version: primitive.version, commit: primitiveCommit, contentSha256: primitive.contentSha256 },
  };
  release.compatibility.controllers.unshift({ version: release.version, commit: codeCommit,
    contracts: structuredClone(release.contracts), dependencies: structuredClone(release.dependencies) });
  await json(controlPlaneRoot, 'config/controller-release.json', release);
  const generatedFrom = { primitiveRelease: primitive.releaseId, primitiveSourceCommit: primitiveCommit,
    primitiveContentSha256: primitive.contentSha256, architectureCommit,
    architectureContentSha256: architecture.contentSha256, controlPlaneCommit: codeCommit, automationSourceCommit: codeCommit };
  await json(distributionRoot, 'manifests/workflow-bundle.json', { schemaVersion: 1, status: 'draft', bundleVersion: '0.1.0-synthetic',
    controlPlane: { repository: cpRepository, commit: codeCommit },
    architecture: { repository: release.dependencies.architecture.repository, commit: architectureCommit, contentSha256: architecture.contentSha256 },
    workflowSource: { repository: cpRepository, commit: codeCommit }, files: [] });
  await json(distributionRoot, 'manifests/sources.lock.json', { schemaVersion: 1, status: 'draft', sources: [
    { id: 'control-plane', repository: cpRepository, repositoryId: 1358455028, commit: codeCommit },
    { id: 'architecture', repository: release.dependencies.architecture.repository, repositoryId: 1380894616, commit: architectureCommit },
    { id: 'primitives', repository: primitiveRepository, repositoryId: 1380894656, commit: primitiveCommit },
    { id: 'distribution-workflow', repository: cpRepository, repositoryId: 1358455028, commit: codeCommit },
  ] });
  await json(distributionRoot, 'manifests/capabilities.lock.json', { schemaVersion: 2,
    primitiveRepository, primitiveRepositoryId: 1380894656, primitiveRelease: primitive.releaseId,
    sourceCommit: primitiveCommit, contentSha256: primitive.contentSha256 });
  await json(distributionRoot, 'packages/agent-plugin/plugin.json', { generatedFrom });
  const sourcePath = 'automations/templates/prepare-validation-evidence.automation.md';
  const targetPath = 'packages/agent-plugin/automations/prepare-validation-evidence.automation.md';
  const automation = await git(controlPlaneRoot, 'show', `${codeCommit}:${sourcePath}`);
  await mkdir(path.dirname(path.join(distributionRoot, targetPath)), { recursive: true });
  await writeFile(path.join(distributionRoot, targetPath), automation);
  await json(distributionRoot, 'manifests/automation-projections.lock.json', {
    canonicalRepository: cpRepository, sourceCommit: codeCommit, projectionRepository: 'agentic-delivery-lab/agentic-delivery-distribution',
    templates: [{ id: 'prepare-validation-evidence', sourceRef: codeCommit, sourcePath, targetPath, contentSha256: hash(automation) }],
  });
  await json(privateRoot, 'provenance/agents.lock.json', { schemaVersion: 2,
    canonicalRepository: primitiveRepository, canonicalRepositoryId: 1380894656, agents: [] });
  await json(privateRoot, 'provenance/surface.yml', { repositoryName: '.github-private', requiredVisibility: 'private',
    consumedPaths: ['profile/README.md', 'agents/*.agent.md'], governancePaths: ['.github/rulesets/require-publication-review.json'] });
  await json(privateRoot, '.github/rulesets/require-publication-review.json', {
    name: 'Require private publication review', target: 'branch', enforcement: 'active', bypass_actors: [],
    conditions: { ref_name: { include: ['~DEFAULT_BRANCH'] } }, rules: [
      { type: 'required_status_checks', parameters: { required_status_checks: [{ context: 'validate-published-agents / validate' }] } },
      { type: 'pull_request', parameters: { require_code_owner_review: true, required_approving_review_count: 1 } },
      { type: 'non_fast_forward' },
    ],
  });
  await mkdir(path.join(privateRoot, '.github/workflows'), { recursive: true });
  await writeFile(path.join(privateRoot, '.github/workflows/validate-published-agents.yml'), `jobs:
  validate:
    steps:
      - uses: actions/checkout@fbc6f3992d24b796d5a048ff273f7fcc4a7b6c09
        with:
          repository: ${cpRepository}
          ref: ${codeCommit}
          path: control-plane
          persist-credentials: false
      - uses: actions/checkout@fbc6f3992d24b796d5a048ff273f7fcc4a7b6c09
        with:
          repository: ${primitiveRepository}
          ref: \${{ steps.provenance.outputs.source_commit }}
          path: primitives
          persist-credentials: false
      - run: node control-plane/scripts/validate-published-agents.mjs publication --primitive-root primitives
`);
  return { controlPlaneRoot, distributionRoot, privateRoot, architectureRoot, primitivesRoot, release };
}

test('planned v3 graph reproduces real current producers and canonical automation bytes', async (t) => {
  const inputs = await fixture(t);
  const result = await validateReleaseChain(inputs);
  assert.equal(result.status, 'passed');
  assert.equal(result.architecture.commit, architectureCommit);
  assert.equal(result.primitives.commit, primitiveCommit);
  assert.equal(result.privatePublicationAgents, 0);
});

test('v3 graph rejects a wrong native dependency ID and a wrong inventory ID', async (t) => {
  const inputs = await fixture(t);
  const file = 'config/controller-release.json';
  const original = structuredClone(inputs.release);
  inputs.release.dependencies.primitives.repositoryId = 999999;
  inputs.release.compatibility.controllers[0].dependencies.primitives.repositoryId = 999999;
  await json(inputs.controlPlaneRoot, file, inputs.release);
  await assert.rejects(validateReleaseChain(inputs), /repositoryId/);
  await json(inputs.controlPlaneRoot, file, original);
  const lockFile = path.join(inputs.distributionRoot, 'manifests/sources.lock.json');
  const lock = JSON.parse(await readFile(lockFile, 'utf8'));
  lock.sources.find(source => source.id === 'control-plane').repositoryId = 1380894616;
  await json(inputs.distributionRoot, 'manifests/sources.lock.json', lock);
  await assert.rejects(validateReleaseChain(inputs), /Source lock Control Plane repository ID/);
});

test('v3 graph rejects a digest mismatch with otherwise matching identity and catalog', async (t) => {
  const inputs = await fixture(t);
  inputs.release.dependencies.primitives.contentSha256 = 'f'.repeat(64);
  inputs.release.compatibility.controllers[0].dependencies.primitives.contentSha256 = 'f'.repeat(64);
  await json(inputs.controlPlaneRoot, 'config/controller-release.json', inputs.release);
  await assert.rejects(validateReleaseChain(inputs), /Primitive release digest|Primitive dependency digest/);
});

test('v3 graph rejects unsupported producer contracts from immutable fixture commits', async (t) => {
  const inputs = await fixture(t);
  const clone = path.resolve(inputs.controlPlaneRoot, '../unsupported-primitive');
  await exec('git', ['clone', '--quiet', '--shared', inputs.primitivesRoot, clone]);
  await git(clone, 'checkout', '--quiet', '--detach', primitiveCommit);
  const file = 'manifests/primitive-release.json';
  const manifest = JSON.parse(await readFile(path.join(clone, file), 'utf8'));
  manifest.schemaVersion = 99;
  await json(clone, file, manifest);
  await git(clone, 'add', file);
  await git(clone, '-c', 'user.name=Synthetic graph fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-qm', 'Synthetic unsupported producer contract');
  const commit = (await git(clone, 'rev-parse', 'HEAD')).trim();
  inputs.primitivesRoot = clone;
  inputs.release.dependencies.primitives.commit = commit;
  inputs.release.compatibility.controllers[0].dependencies.primitives.commit = commit;
  await json(inputs.controlPlaneRoot, 'config/controller-release.json', inputs.release);
  await assert.rejects(validateReleaseChain(inputs), /Primitive release contract is unsupported/);
});

test('native producer provenance rejects a wrong impact inventory hash', async (t) => {
  const inputs = await fixture(t);
  const clone = path.resolve(inputs.controlPlaneRoot, '../uncovered-primitive');
  await exec('git', ['clone', '--quiet', '--shared', inputs.primitivesRoot, clone]);
  await git(clone, 'checkout', '--quiet', '--detach', primitiveCommit);
  const file = 'manifests/primitive-release.json';
  const manifest = JSON.parse(await readFile(path.join(clone, file), 'utf8'));
  manifest.architecture.decisionInventorySha256 = 'f'.repeat(64);
  await json(clone, file, manifest);
  await git(clone, 'add', file);
  await git(clone, '-c', 'user.name=Synthetic graph fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-qm', 'Synthetic uncovered inventory');
  const commit = (await git(clone, 'rev-parse', 'HEAD')).trim();
  inputs.primitivesRoot = clone;
  inputs.release.dependencies.primitives.commit = commit;
  inputs.release.compatibility.controllers[0].dependencies.primitives.commit = commit;
  await json(inputs.controlPlaneRoot, 'config/controller-release.json', inputs.release);
  const architectureRelease = JSON.parse(await git(inputs.architectureRoot, 'show',
    `${architectureCommit}:architecture/generated/architecture-release.json`));
  const errors = [];
  // Exercise the producer proof directly: a mismatched full graph now rejects
  // at the earlier metadata barrier, before this proof is allowed to run.
  await validateNativeProducerSources({ architectureRoot: inputs.architectureRoot, primitivesRoot: clone,
    architectureDependency: inputs.release.dependencies.architecture, primitiveDependency: inputs.release.dependencies.primitives,
    architectureRelease, primitiveRelease: manifest }, errors);
  assert.ok(errors.some(error => error.includes('impact Architecture inventory')), errors.join('\n'));
});

test('v3 graph rejects an unsupported Architecture contract combination', async (t) => {
  const inputs = await fixture(t);
  const clone = path.resolve(inputs.controlPlaneRoot, '../unsupported-architecture');
  await exec('git', ['clone', '--quiet', '--shared', inputs.architectureRoot, clone]);
  await git(clone, 'checkout', '--quiet', '--detach', architectureCommit);
  const file = 'architecture/generated/architecture-release.json';
  const manifest = JSON.parse(await readFile(path.join(clone, file), 'utf8'));
  manifest.contractVersions.adrPrimitiveIndex = '99.0.0';
  await json(clone, file, manifest);
  await git(clone, 'add', file);
  await git(clone, '-c', 'user.name=Synthetic graph fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-qm', 'Synthetic unsupported Architecture contract');
  const commit = (await git(clone, 'rev-parse', 'HEAD')).trim();
  inputs.architectureRoot = clone;
  inputs.release.dependencies.architecture.commit = commit;
  inputs.release.compatibility.controllers[0].dependencies.architecture.commit = commit;
  await json(inputs.controlPlaneRoot, 'config/controller-release.json', inputs.release);
  await assert.rejects(validateReleaseChain(inputs), /contract versions are unsupported/);
});

// A marker proves rejection precedes executable producer tooling. The script
// exists only in this owned negative fixture and is never a published tool.
async function markerProducer(inputs, role) {
  const architecture = role === 'architecture';
  const source = architecture ? inputs.architectureRoot : inputs.primitivesRoot;
  const clone = path.resolve(inputs.controlPlaneRoot, `../marker-${role}`);
  const marker = path.resolve(inputs.controlPlaneRoot, `../${role}-tool-ran`);
  await exec('git', ['clone', '--quiet', '--shared', source, clone]);
  await git(clone, 'checkout', '--quiet', '--detach', architecture ? architectureCommit : primitiveCommit);
  const tool = architecture ? 'tools/architecture-content-digest.mjs' : 'tools/primitive-content-digest.mjs';
  const digest = inputs.release.dependencies[architecture ? 'architecture' : 'primitives'].contentSha256;
  await writeFile(path.join(clone, tool), `import { writeFileSync } from 'node:fs';\nwriteFileSync(${JSON.stringify(marker)}, 'executed');\nprocess.stdout.write(${JSON.stringify(digest)});\n`);
  return { clone, marker };
}
async function commitMarker(clone) {
  await git(clone, 'add', '.');
  await git(clone, '-c', 'user.name=Synthetic graph fixture', '-c', 'user.email=fixture@example.invalid',
    'commit', '-qm', 'Synthetic producer execution marker');
  return (await git(clone, 'rev-parse', 'HEAD')).trim();
}

test('wrong Primitive manifest digest rejects before executing its digest tool', async t => {
  const inputs = await fixture(t);
  const { clone, marker } = await markerProducer(inputs, 'primitives');
  const file = 'manifests/primitive-release.json';
  const manifest = JSON.parse(await readFile(path.join(clone, file), 'utf8'));
  manifest.contentSha256 = 'f'.repeat(64);
  await json(clone, file, manifest);
  const commit = await commitMarker(clone);
  inputs.primitivesRoot = clone;
  inputs.release.dependencies.primitives.commit = commit;
  inputs.release.compatibility.controllers[0].dependencies.primitives.commit = commit;
  await json(inputs.controlPlaneRoot, 'config/controller-release.json', inputs.release);
  await assert.rejects(validateReleaseChain(inputs), /Primitive release digest/);
  await assert.rejects(access(marker), { code: 'ENOENT' });
});

test('impact manifest hash rejects before executing that Architecture digest tool', async t => {
  const inputs = await fixture(t);
  const { clone, marker } = await markerProducer(inputs, 'architecture');
  const commit = await commitMarker(clone);
  const architectureRelease = JSON.parse(await git(inputs.architectureRoot, 'show', `${architectureCommit}:architecture/generated/architecture-release.json`));
  const primitiveRelease = JSON.parse(await git(inputs.primitivesRoot, 'show', `${primitiveCommit}:manifests/primitive-release.json`));
  Object.assign(primitiveRelease.architecture, { releaseManifestCommit: commit, releaseManifestSha256: 'f'.repeat(64),
    version: architectureRelease.version, sourceCommit: architectureRelease.sourceCommit });
  const errors = [];
  await validateNativeProducerSources({ architectureRoot: clone, primitivesRoot: inputs.primitivesRoot,
    architectureDependency: inputs.release.dependencies.architecture, primitiveDependency: inputs.release.dependencies.primitives,
    architectureRelease, primitiveRelease }, errors);
  assert.ok(errors.some(error => error.includes('impact Architecture manifest hash')), errors.join('\n'));
  await assert.rejects(access(marker), { code: 'ENOENT' });
});
