import assert from 'node:assert/strict';
import { access, cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import path from 'node:path';
import { test } from 'node:test';
import { promisify } from 'node:util';

import { parseRepositoryYaml } from '../../scripts/lib/yaml.mjs';

import { ReleaseChainValidationError, validateBootstrapWorkflowPins, validateReleaseChain, primitiveLocatorForVersion } from '../../scripts/validate-release-chain.mjs';

test('release-name migration admits only the declared versioned locator and unchanged native ID', () => {
  assert.equal(primitiveLocatorForVersion(1, 'agentic-delivery-lab/agentic-delivery-primitives'), true);
  assert.equal(primitiveLocatorForVersion(2, 'agentic-delivery-lab/agentic-delivery-agent-customizations', 1380894656), true);
  assert.equal(primitiveLocatorForVersion(2, 'agentic-delivery-lab/agentic-delivery-agent-customizations', 999999), false);
  assert.equal(primitiveLocatorForVersion(1, 'agentic-delivery-lab/agentic-delivery-agent-customizations', 1380894656), false);
  assert.equal(primitiveLocatorForVersion(2, 'agentic-delivery-lab/agentic-delivery-primitives', 1380894656), false);
  assert.equal(primitiveLocatorForVersion(3, 'agentic-delivery-lab/agentic-delivery-agent-customizations', 1380894656), false);
});

const repositoryRoot = path.resolve(import.meta.dirname, '../..');
const execFileAsync = promisify(execFile);
const siblingRoots = {
  architectureRoot: path.resolve(repositoryRoot, '../agentic-delivery-architecture'),
  primitivesRoot: path.resolve(repositoryRoot, '../agentic-delivery-primitives'),
  distributionRoot: path.resolve(repositoryRoot, '../agentic-delivery-distribution'),
  privateRoot: path.resolve(repositoryRoot, '../.github-private'),
};

async function exists(directory) {
  try {
    await access(directory);
    return true;
  } catch {
    return false;
  }
}

test('release-chain validation requires explicit cross-repository inputs', async () => {
  await assert.rejects(
    validateReleaseChain(),
    (error) => error instanceof ReleaseChainValidationError && error.exitCode === 2 && /architectureRoot/.test(error.message),
  );
});

test('release-chain validation requires intake and delivery to use the manifest bootstrap pin', () => {
  const bootstrapCommit = 'a'.repeat(40);
  assert.deepEqual(validateBootstrapWorkflowPins({
    bootstrapCommit,
    issueIntakeWorkflow: `jobs:\n  authorize:\n    steps:\n      - name: Check out trusted authorization\n        uses: actions/checkout@v5\n        with:\n          ref: ${bootstrapCommit}\n          path: trusted-intake\n  classify:\n    steps:\n      - name: Check out trusted intake\n        uses: actions/checkout@v5\n        with:\n          ref: ${bootstrapCommit}\n          path: trusted-intake\n`,
    codexDeliveryWorkflow: `jobs:\n  resolve:\n    steps:\n      - name: Check out trusted participant registry bootstrap\n        uses: actions/checkout@v5\n        with:\n          ref: ${bootstrapCommit}\n          path: trusted-bootstrap\n`,
  }), []);

  assert.deepEqual(validateBootstrapWorkflowPins({
    bootstrapCommit,
    issueIntakeWorkflow: `jobs:\n  authorize:\n    steps:\n      - name: Check out trusted authorization\n        uses: actions/checkout@v5\n        with:\n          ref: ${bootstrapCommit}\n          path: trusted-intake\n`,
    codexDeliveryWorkflow: `jobs:\n  resolve:\n    steps:\n      - name: Check out trusted participant registry bootstrap\n        uses: actions/checkout@v5\n        with:\n          ref: ${'b'.repeat(40)}\n          path: trusted-bootstrap\n`,
  }), ['codex-delivery bootstrap must pin the release bootstrap commit']);
});

test('local release graph reproduces all pinned digests and publication refs', async (t) => {
  const available = await Promise.all(Object.values(siblingRoots).map(exists));
  if (!available.every(Boolean)) {
    t.skip('split repositories are not checked out in this workspace');
    return;
  }
  const result = await validateReleaseChain({ controlPlaneRoot: repositoryRoot, ...siblingRoots });
  assert.equal(result.status, 'passed');
  assert.equal(result.controller.version, '0.2.0-draft.67');
  assert.equal(result.controller.commit, '98495275481aff381180771da6eba9da95bc7816');
  assert.match(result.controller.bootstrapCommit, /^[0-9a-f]{40}$/);
  assert.equal(result.controller.githubAppContractVersion, '2.0.0');
  assert.equal(result.architecture.contentSha256, '02f150dfd46b8c304f61196ff65d7f8a05adc0cc151402573b10803491ac4550');
  assert.equal(result.primitives.contentSha256, '4b6c07deb6f7be8f495244e3c50a528054528db1fdec5a5a14ea4cfdda5bb34e');
  assert.equal(result.distribution.automationProjectionRelease, 'urn:agentic-delivery:distribution:0.1.0-draft.26');
});

test('the pinned workflow source contains the validator and reusable workflow entry points', async (t) => {
  const available = await Promise.all(Object.values(siblingRoots).map(exists));
  if (!available.every(Boolean)) {
    t.skip('split repositories are not checked out in this workspace');
    return;
  }
  await assert.doesNotReject(() => validateReleaseChain({ controlPlaneRoot: repositoryRoot, ...siblingRoots }));
  const workflow = await readFile(path.join(siblingRoots.privateRoot, '.github/workflows/validate-published-agents.yml'), 'utf8');
  const publication = JSON.parse(await readFile(path.join(siblingRoots.privateRoot, 'provenance/agents.lock.json'), 'utf8'));
  const parsed = parseRepositoryYaml(workflow, 'private publication workflow');
  const canonicalCheckouts = Object.values(parsed.jobs ?? {}).flatMap(job => job.steps ?? [])
    .filter(step => step.uses?.startsWith('actions/checkout@') && step.with?.path === 'primitives');
  assert.equal(canonicalCheckouts.length, 1);
  assert.equal(canonicalCheckouts[0].with.repository, publication.canonicalRepository);
  assert.match(workflow, /steps\.provenance\.outputs\.source_commit/);
  assert.match(workflow, /--primitive-root primitives/);
});

test('release-chain validation requires canonical Primitive reproduction in the private workflow', async (t) => {
  const available = await Promise.all(Object.values(siblingRoots).map(exists));
  if (!available.every(Boolean)) {
    t.skip('split repositories are not checked out in this workspace');
    return;
  }

  const temporaryRoot = await mkdtemp(path.join('/tmp', 'agentic-release-private-test-'));
  const temporaryPrivateRoot = path.join(temporaryRoot, 'private');
  try {
    await cp(siblingRoots.privateRoot, temporaryPrivateRoot, { recursive: true });
    const workflowPath = path.join(temporaryPrivateRoot, '.github/workflows/validate-published-agents.yml');
    const workflow = await readFile(workflowPath, 'utf8');
    await writeFile(workflowPath, workflow.replace('--primitive-root primitives', '--primitive-root untrusted'), 'utf8');
    await assert.rejects(
      validateReleaseChain({ controlPlaneRoot: repositoryRoot, ...siblingRoots, privateRoot: temporaryPrivateRoot }),
      (error) => error instanceof ReleaseChainValidationError && /reproduce projections from the checked-out Primitive source/.test(error.message),
    );
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});

test('release-chain validation requires protected private publication desired state', async (t) => {
  const available = await Promise.all(Object.values(siblingRoots).map(exists));
  if (!available.every(Boolean)) {
    t.skip('split repositories are not checked out in this workspace');
    return;
  }

  const temporaryRoot = await mkdtemp(path.join('/tmp', 'agentic-release-private-ruleset-test-'));
  const temporaryPrivateRoot = path.join(temporaryRoot, 'private');
  try {
    await cp(siblingRoots.privateRoot, temporaryPrivateRoot, { recursive: true });
    const rulesetPath = path.join(temporaryPrivateRoot, '.github/rulesets/require-publication-review.json');
    const ruleset = JSON.parse(await readFile(rulesetPath, 'utf8'));
    ruleset.bypass_actors = [{ actor_id: 1, actor_type: 'User', bypass_mode: 'always' }];
    await writeFile(rulesetPath, `${JSON.stringify(ruleset, null, 2)}\n`, 'utf8');
    await assert.rejects(
      validateReleaseChain({ controlPlaneRoot: repositoryRoot, ...siblingRoots, privateRoot: temporaryPrivateRoot }),
      (error) => error instanceof ReleaseChainValidationError && /must not declare bypass actors/.test(error.message),
    );
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});

test('release-chain validation reads Architecture and Primitive manifests from their pinned commits', async (t) => {
  const available = await Promise.all(Object.values(siblingRoots).map(exists));
  if (!available.every(Boolean)) {
    t.skip('split repositories are not checked out in this workspace');
    return;
  }
  const result = await validateReleaseChain({ controlPlaneRoot: repositoryRoot, ...siblingRoots });
  const controller = JSON.parse(await readFile(path.join(repositoryRoot, 'config/controller-release.json'), 'utf8'));
  assert.equal(result.architecture.commit, controller.dependencies.architecture.commit);
  assert.equal(result.primitives.commit, controller.dependencies.primitives.commit);
});

test('release-chain validation executes digest tools from the pinned dependency commits', async (t) => {
  const available = await Promise.all(Object.values(siblingRoots).map(exists));
  if (!available.every(Boolean)) {
    t.skip('split repositories are not checked out in this workspace');
    return;
  }

  const temporaryRoot = await mkdtemp(path.join('/tmp', 'agentic-release-chain-test-'));
  const temporaryArchitectureRoot = path.join(temporaryRoot, 'architecture');
  try {
    await execFileAsync('git', ['clone', '--local', '--no-hardlinks', siblingRoots.architectureRoot, temporaryArchitectureRoot], {
      encoding: 'utf8',
      maxBuffer: 4 * 1024 * 1024,
    });
    // If the validator used the mutable worktree tool, this deliberately
    // invalid implementation would make the release digest fail. A passing
    // result proves that the tool itself is read from the pinned commit.
    await writeFile(
      path.join(temporaryArchitectureRoot, 'tools/architecture-content-digest.mjs'),
      "process.stdout.write(`${'0'.repeat(64)}\\n`);\n",
      'utf8',
    );
    const result = await validateReleaseChain({
      controlPlaneRoot: repositoryRoot,
      ...siblingRoots,
      architectureRoot: temporaryArchitectureRoot,
    });
    assert.equal(result.status, 'passed');
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});
