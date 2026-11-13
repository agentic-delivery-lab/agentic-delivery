import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmod, link, mkdir, mkdtemp, readFile, rm, rmdir, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { promisify } from 'node:util';
import * as graph from '../../scripts/validate-release-chain.mjs';

const exec = promisify(execFile);
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const repository = 'agentic-delivery-lab/agentic-delivery-agent-customizations';
const skillNames = ['architecture-decision', 'delivery-workflow', 'plain-language-communication', 'ubiquitous-language'];
const paths = [...skillNames.flatMap(name => [`skills/${name}/SKILL.md`, `skills/${name}/agents/openai.yaml`]),
  'references/architecture-authority.md', 'references/consumer-tools.md',
  'validators/workspace-lifecycle/README.md', 'validators/workspace-lifecycle/workspace_guard.py',
  'scripts/start-issue-branch.mjs', 'validators/repository-delivery/validate-branch-name.mjs',
  'validators/repository-delivery/validate-source-issue.mjs', 'schemas/primitive-release.schema.json',
  'manifests/primitive-release.json'].sort();

async function put(root, file, value) {
  await mkdir(path.dirname(path.join(root, file)), { recursive: true });
  await writeFile(path.join(root, file), value);
}
async function json(root, file, value) { await put(root, file, `${JSON.stringify(value, null, 2)}\n`); }
async function fixture(t, sourceMode) {
  // Synthetic Git objects and projection data only; no source checkout or clone.
  const temporary = await mkdtemp(path.join(os.tmpdir(), 'skill-resource-fixture-'));
  t.after(() => rm(temporary, { recursive: true, force: true }));
  const primitivesRoot = path.join(temporary, 'primitives');
  const distributionRoot = path.join(temporary, 'distribution');
  await mkdir(primitivesRoot);
  const git = async (...args) => (await exec('git', ['-C', primitivesRoot,
    '-c', 'user.name=Synthetic resource fixture', '-c', 'user.email=fixture@example.invalid',
    '-c', 'commit.gpgsign=false', '-c', 'core.autocrlf=false',
    '-c', `core.hooksPath=${path.join(temporary, 'no-hooks')}`, ...args], { encoding: 'buffer' })).stdout;
  await git('init', '-q', '--initial-branch=main');
  for (const file of paths.filter(file => file !== 'manifests/primitive-release.json')) {
    await put(primitivesRoot, file, `Synthetic immutable resource: ${file}\n`);
  }
  await git('add', '.');
  if (sourceMode) {
    const blob = (await git('rev-parse', ':references/consumer-tools.md')).toString().trim();
    await git('update-index', '--cacheinfo', `${sourceMode},${blob},references/consumer-tools.md`);
  }
  await git('commit', '-qm', 'Synthetic implementation');
  const implementationCommit = (await git('rev-parse', 'HEAD')).toString().trim();
  const primitiveRelease = { $schema: '../schemas/primitive-release.schema.json', schemaVersion: 1,
    version: '0.2.0', releaseId: 'urn:agentic-delivery:primitive-release:0.2.0', status: 'released',
    sourceCommit: implementationCommit, contentSha256: 'c'.repeat(64), capabilityPolicyVersion: '0.1.0' };
  await json(primitivesRoot, 'manifests/primitive-release.json', primitiveRelease);
  await git('add', '.'); await git('commit', '-qm', 'Synthetic release manifest');
  const primitiveReleaseCommit = (await git('rev-parse', 'HEAD')).toString().trim();
  const plugin = { schemaVersion: 2, id: 'agentic-delivery', version: '0.1.0-synthetic', status: 'draft',
    resourceInventory: 'resources.lock.json', projections: { automations: 'automations/', skills: 'skills/' },
    generatedFrom: { primitiveRepository: repository, primitiveRelease: primitiveRelease.releaseId,
      primitiveSourceCommit: primitiveReleaseCommit, primitiveImplementationCommit: implementationCommit,
      primitiveContentSha256: primitiveRelease.contentSha256, architectureCommit: 'd'.repeat(40),
      architectureContentSha256: 'e'.repeat(64), controlPlaneCommit: 'f'.repeat(40), automationSourceCommit: 'f'.repeat(40) } };
  const lock = { schemaVersion: 1, primitiveRepository: repository, primitiveRepositoryId: 1380894656,
    primitiveRelease: primitiveRelease.releaseId, releaseManifestCommit: primitiveReleaseCommit,
    implementationCommit, contentSha256: primitiveRelease.contentSha256, files: [] };
  for (const sourcePath of paths) {
    const sourceCommit = sourcePath === 'manifests/primitive-release.json' ? primitiveReleaseCommit : implementationCommit;
    const bytes = await git('show', `${sourceCommit}:${sourcePath}`);
    const targetPath = `packages/agent-plugin/${sourcePath}`;
    lock.files.push({ sourcePath, targetPath, sourceCommit, contentSha256: hash(bytes), mode: '100644' });
    await put(distributionRoot, targetPath, bytes);
  }
  const automation = 'packages/agent-plugin/automations/review.automation.md';
  await put(distributionRoot, automation, 'Synthetic existing automation\n');
  const automationLock = { templates: [{ targetPath: automation }] };
  await json(distributionRoot, 'manifests/automation-projections.lock.json', automationLock);
  const { version, ...factory } = plugin;
  await json(distributionRoot, 'packages/agent-plugin/plugin.json', { $schema: 'https://agent-plugins.org/schemas/1.0.0/plugin.schema.json',
    name: 'agentic-delivery', version, description: 'Synthetic skills and review templates.', extensions: { 'io.github.agentic-delivery-lab': factory } });
  const save = () => json(distributionRoot, 'packages/agent-plugin/resources.lock.json', lock);
  await save();
  return { primitivesRoot, distributionRoot, primitiveReleaseCommit, primitiveRelease, plugin, automationLock, lock, save, git };
}

const validate = input => graph.validateDistributionSkillResources(input);

test('skill resources reproduce distinct immutable roles despite changed source workfiles', async (t) => {
  const input = await fixture(t);
  await put(input.primitivesRoot, 'skills/delivery-workflow/SKILL.md', 'Untrusted later workfile\n');
  const result = await validate(input);
  assert.equal(result.resources, 17);
  assert.equal(result.releaseManifestCommit, input.primitiveReleaseCommit);
  assert.equal(result.implementationCommit, input.primitiveRelease.sourceCommit);
  assert.notEqual(result.releaseManifestCommit, result.implementationCommit);
});

test('inventory headers cannot select another source identity, release or role', async (t) => {
  const input = await fixture(t);
  for (const [field, value] of [['primitiveRepositoryId', 1], ['primitiveRepository', 'example/foreign'],
    ['primitiveRelease', 'urn:agentic-delivery:primitive-release:9.0.0'],
    ['releaseManifestCommit', input.primitiveRelease.sourceCommit], ['implementationCommit', input.primitiveReleaseCommit],
    ['contentSha256', '0'.repeat(64)], ['schemaVersion', 2]]) {
    const before = input.lock[field]; input.lock[field] = value; await input.save();
    await assert.rejects(validate(input), /resource|inventory/i, field);
    input.lock[field] = before;
  }
});

test('unrecognized fields, missing files and duplicate inventory paths hold', async (t) => {
  const input = await fixture(t); const original = structuredClone(input.lock);
  for (const mutate of [lock => { lock.approved = true; }, lock => lock.files.pop(),
    lock => lock.files.push({ ...lock.files[0] }), lock => { lock.files[0].unknown = true; }]) {
    Object.assign(input.lock, structuredClone(original)); mutate(input.lock); await input.save();
    await assert.rejects(validate(input), /resource|inventory/i);
    for (const key of Object.keys(input.lock)) delete input.lock[key];
  }
});

test('equal bytes from the wrong immutable role do not authorize a projection', async (t) => {
  const input = await fixture(t);
  input.lock.files.find(row => row.sourcePath.endsWith('/SKILL.md')).sourceCommit = input.primitiveReleaseCommit;
  await input.save(); await assert.rejects(validate(input), /resource|inventory/i);
});

test('a self-consistent forged hash and target cannot replace the canonical blob', async (t) => {
  const input = await fixture(t); const row = input.lock.files.find(row => row.sourcePath.endsWith('/SKILL.md'));
  const forged = Buffer.from('forged canonical claim\n'); row.contentSha256 = hash(forged);
  await put(input.distributionRoot, row.targetPath, forged); await input.save();
  await assert.rejects(validate(input), /resource|inventory/i);
});

test('changed or missing projected bytes hold without repairing them', async (t) => {
  const input = await fixture(t); const row = input.lock.files[0];
  await put(input.distributionRoot, row.targetPath, 'preserve changed consumer data\n');
  await assert.rejects(validate(input), /resource|inventory/i);
  assert.equal(await readFile(path.join(input.distributionRoot, row.targetPath), 'utf8'), 'preserve changed consumer data\n');
  await rm(path.join(input.distributionRoot, row.targetPath));
  await assert.rejects(validate(input), /resource|inventory/i);
});

test('path aliases, escapes and executable-mode claims hold', async (t) => {
  const input = await fixture(t); const original = structuredClone(input.lock.files[0]);
  for (const changes of [{ targetPath: '../outside' }, { targetPath: '/outside' },
    { targetPath: original.targetPath.replace('packages/', 'packages/./') },
    { sourcePath: '../outside' }, { mode: '100755' }]) {
    input.lock.files[0] = { ...original, ...changes }; await input.save();
    await assert.rejects(validate(input), /resource|inventory/i);
  }
});

test('the package inventory rejects unlisted resources and components', async (t) => {
  const input = await fixture(t);
  for (const file of ['skills/unlisted.md', 'hooks/unapproved.json', '.hidden-unlisted']) {
    await put(input.distributionRoot, `packages/agent-plugin/${file}`, 'unlisted\n');
    await assert.rejects(validate(input), /resource|inventory/i);
    await rm(path.join(input.distributionRoot, `packages/agent-plugin/${file}`));
    if (file.startsWith('hooks/')) await rmdir(path.join(input.distributionRoot, 'packages/agent-plugin/hooks'));
  }
});

test('symlinked resources and parent directories are rejected', async (t) => {
  const input = await fixture(t); const relative = 'packages/agent-plugin/references/consumer-tools.md';
  const file = path.join(input.distributionRoot, relative); const bytes = await readFile(file);
  const outside = path.join(input.distributionRoot, 'outside'); await writeFile(outside, bytes);
  await rm(file);
  try { await symlink(outside, file, 'file'); }
  catch (error) { if (process.platform === 'win32' && error.code === 'EPERM') { t.skip('Windows fixture requires symlink privilege'); return; } throw error; }
  await assert.rejects(validate(input), /resource|inventory/i);
  await rm(file); await writeFile(file, bytes);
  const parent = path.join(input.distributionRoot, 'packages/agent-plugin/references');
  const held = path.join(input.distributionRoot, 'held-references');
  await mkdir(held); for (const name of ['consumer-tools.md', 'architecture-authority.md']) {
    await writeFile(path.join(held, name), await readFile(path.join(parent, name)));
  }
  await rm(parent, { recursive: true }); await symlink(held, parent, process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(validate(input), /resource|inventory/i);
});

test('actual executable projection modes hold where the filesystem represents them', { skip: process.platform === 'win32' }, async (t) => {
  const input = await fixture(t); const file = path.join(input.distributionRoot, input.lock.files[0].targetPath);
  await chmod(file, 0o700); await assert.rejects(validate(input), /resource|inventory/i);
});


for (const mode of ['100755', '120000']) {
  test(`immutable source Git mode ${mode} cannot masquerade as a regular resource`, async (t) => {
    const input = await fixture(t, mode);
    await assert.rejects(validate(input), /regular immutable blob/);
  });
}

test('a package metadata change after selection holds before content verification', async (t) => {
  const input = await fixture(t);
  const file = 'packages/agent-plugin/plugin.json';
  const document = JSON.parse(await readFile(path.join(input.distributionRoot, file), 'utf8'));
  document.extensions['io.github.agentic-delivery-lab'].status = 'released';
  await json(input.distributionRoot, file, document);
  await assert.rejects(validate(input), /metadata changed or differs/);
});


test('the complete selected release metadata must match its immutable manifest', async (t) => {
  const input = await fixture(t);
  input.primitiveRelease.capabilityPolicyVersion = 'unexpected';
  await assert.rejects(validate(input), /selected release manifest differs/);
});


test('oversized and multiply linked resource files hold without repair', async (t) => {
  const input = await fixture(t); const file = path.join(input.distributionRoot, input.lock.files[0].targetPath);
  const original = await readFile(file);
  await writeFile(file, Buffer.alloc(2 * 1024 * 1024 + 1));
  await assert.rejects(validate(input), /file mode or size/);
  await writeFile(file, original);
  await link(file, path.join(input.distributionRoot, 'retained-hardlink'));
  await assert.rejects(validate(input), /file mode or size/);
  assert.deepEqual(await readFile(file), original);
});

test('ambient Git selectors cannot redirect immutable resource reads', async (t) => {
  const input = await fixture(t); const prior = process.env.GIT_DIR;
  process.env.GIT_DIR = path.join(input.distributionRoot, 'unrelated-git');
  try { assert.equal((await validate(input)).resources, 17); }
  finally { if (prior === undefined) delete process.env.GIT_DIR; else process.env.GIT_DIR = prior; }
});


test('automation resources obey the same file bound and link policy', async (t) => {
  const input = await fixture(t); const file = path.join(input.distributionRoot, 'packages/agent-plugin/automations/review.automation.md');
  const original = await readFile(file);
  await writeFile(file, Buffer.alloc(2 * 1024 * 1024 + 1));
  await assert.rejects(validate(input), /file mode or size/);
  await writeFile(file, original); await link(file, path.join(input.distributionRoot, 'retained-automation-link'));
  await assert.rejects(validate(input), /file mode or size/);
});


test('automation snapshots retain exactly the bytes that passed package validation', async (t) => {
  const input = await fixture(t); const relative = 'packages/agent-plugin/automations/review.automation.md';
  const bytes = await readFile(path.join(input.distributionRoot, relative));
  const result = await validate(input);
  await put(input.distributionRoot, relative, 'later unvalidated edit\n');
  assert.deepEqual(result.automationSnapshots.get(relative), bytes);
});

test('automation metadata must still match the graph-selected inventory', async (t) => {
  const input = await fixture(t);
  input.automationLock.sourceCommit = 'f'.repeat(40);
  await assert.rejects(validate(input), /automation resource metadata differs/);
});
