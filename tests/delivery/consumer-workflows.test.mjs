import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { promisify } from 'node:util';

import { parseRepositoryYaml } from '../../scripts/lib/yaml.mjs';

const repositoryRoot = path.resolve(import.meta.dirname, '../..');
const execFileAsync = promisify(execFile);

async function architectureInputFixture() {
  const workflow = parseRepositoryYaml(await readFile(path.join(repositoryRoot,
    '.github/workflows/agentic-delivery-architecture-review.yml'), 'utf8'));
  const step = workflow.jobs['architecture-contract'].steps.find((entry) => (
    entry.name === 'Read the pinned validation sources'
  ));
  assert.ok(step, 'Architecture validation must supply its declared source dependencies.');
  const inline = step.run.match(/node --input-type=module <<'JS'[^\n]*\n([\s\S]+)\nJS\s*$/);
  assert.ok(inline);
  const candidates = [path.join(repositoryRoot, 'node_modules/architecture-pin-contract'),
    path.resolve(repositoryRoot, '../agentic-delivery-architecture')];
  let root;
  for (const candidate of candidates) {
    try {
      const release = JSON.parse(await readFile(path.join(candidate,
        'architecture/generated/architecture-release.json'), 'utf8'));
      if (release.version === '0.1.0-draft.78') {
        const head = await execFileAsync('git', ['-C', candidate, 'rev-parse', 'HEAD'], { timeout: 10_000 });
        assert.equal(head.stdout.trim(), '59df514a3a6dc8a75b79b3fc75fe61aae4e6fdf3');
        root = candidate; break;
      }
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  assert.ok(root, 'The required immutable Architecture draft78 fixture must be available.');
  return { root, program: inline[1] };
}

test('the reusable Architecture workflow derives its pinned validation source inputs', async () => {
  const { root, program } = await architectureInputFixture();
  const { stdout } = await execFileAsync(process.execPath, ['--input-type=module', '-e', program], {
    cwd: root, env: { ...process.env, ARCHITECTURE_COMMIT: '59df514a3a6dc8a75b79b3fc75fe61aae4e6fdf3' },
    timeout: 10_000,
  });
  const outputs = Object.fromEntries(stdout.trim().split('\n').map((line) => {
    const index = line.indexOf('=');
    return [line.slice(0, index), line.slice(index + 1)];
  }));
  assert.equal(outputs.requirements_commit, '9ce017453a23240042f72214b09e3c6c5059854d');
  assert.equal(outputs.primitives_commit, '69beab027d8b28fc082fa6054f4def5ba0146e3c');
  assert.equal(outputs.control_plane_commit, 'c6c891fa937b7db06e3925c3e83ea83656b3d617');
  assert.equal(outputs.distribution_commit, 'b69c5710928b47efc4d3ab12ec4d5b596c80720c');
  assert.ok(JSON.parse(outputs.source_commits).primitives.includes('e4933566fbf5b0f593830f8933f18fbd21024fa7'));
});

test('Architecture source input failures expose no checkout outputs', async (t) => {
  const { root, program } = await architectureInputFixture();
  const files = { release: 'architecture/generated/architecture-release.json',
    requirements: 'architecture/references/requirements.lock.json',
    primitives: 'architecture/references/primitive-catalog.lock.yml',
    inventory: 'architecture/references/decision-inventory.yml' };
  const mutations = [
    (data) => { data.requirements.repositoryId = '1416207421'; },
    (data) => { data.primitives.source.repository = 'agentic-delivery-lab/agentic-delivery-primitives'; },
    (data) => { data.requirements.commit = 'main'; },
    (data) => { data.inventory.historicalVariants[0].repositoryId = 0; },
    (data) => { data.release.contractVersions.adrPrimitiveIndex = '99.0.0'; },
    (data) => { data.release.contractVersions.futureContract = '99.0.0'; },
    (data) => { data.release.contractVersions = []; },
    (data) => {
      const origin = data.inventory.records.find((record) => record.origin.type === 'imported-text').origin;
      origin.repository = '__proto__'; delete origin.repositoryId;
    },
  ];
  for (const mutate of mutations) {
    // Only source metadata is copied. The parser remains in its exact fixture
    // checkout; no source clone or checkout is created in the temporary tree.
    const directory = await mkdtemp(path.join(os.tmpdir(), 'consumer-source-metadata-'));
    t.after(() => rm(directory, { recursive: true, force: true }));
    const data = {};
    for (const [key, file] of Object.entries(files)) {
      data[key] = parseRepositoryYaml(await readFile(path.join(root, file), 'utf8'));
    }
    mutate(data);
    for (const [key, file] of Object.entries(files)) {
      const target = path.join(directory, file);
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, JSON.stringify(data[key]));
    }
    await symlink(path.join(root, 'tools'), path.join(directory, 'tools'),
      process.platform === 'win32' ? 'junction' : 'dir');
    await assert.rejects(execFileAsync(process.execPath, ['--input-type=module', '-e', program], {
      cwd: directory, timeout: 10_000,
    }), (error) => error.code === 1 && error.stdout === ''
      && /Unsupported or mismatched|Unknown native decision-source identity|commit must be immutable/.test(error.stderr));
  }
});

test('Architecture validation rejects a tag object before producer validation', async (t) => {
  const workflow = parseRepositoryYaml(await readFile(path.join(repositoryRoot,
    '.github/workflows/agentic-delivery-architecture-review.yml'), 'utf8'));
  const step = workflow.jobs['architecture-contract'].steps.find((entry) => (
    entry.name === 'Verify the declared source commit objects'
  ));
  const inline = step.run.match(/node --input-type=module <<'JS'\n([\s\S]+)\nJS\s*$/);
  assert.ok(inline);
  const parent = path.join(`${repositoryRoot}.worktrees`, 'owned-clones');
  await mkdir(parent, { recursive: true });
  const directory = await mkdtemp(path.join(parent, 'consumer-source-objects-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const paths = { architecture: '.', requirements: 'sources/requirements',
    primitives: 'sources/primitives', control_plane: 'sources/control-plane', distribution: 'sources/distribution' };
  const env = { ...process.env, GIT_AUTHOR_NAME: 'Consumer workflow fixture',
    GIT_AUTHOR_EMAIL: 'fixture@example.invalid', GIT_COMMITTER_NAME: 'Consumer workflow fixture',
    GIT_COMMITTER_EMAIL: 'fixture@example.invalid', GIT_AUTHOR_DATE: '2000-01-01T00:00:00+00:00',
    GIT_COMMITTER_DATE: '2000-01-01T00:00:00+00:00', GIT_NO_REPLACE_OBJECTS: '1', GIT_NO_LAZY_FETCH: '1' };
  const sources = {};
  for (const [key, relative] of Object.entries(paths)) {
    const root = path.join(directory, relative);
    await execFileAsync('git', ['init', '--initial-branch=main', root], { env, timeout: 10_000 });
    await execFileAsync('git', ['-C', root, '-c', 'commit.gpgsign=false', 'commit', '--allow-empty', '-m', 'fixture'],
      { env, timeout: 10_000 });
    const head = await execFileAsync('git', ['-C', root, 'rev-parse', 'HEAD'], { env, timeout: 10_000 });
    sources[key] = [head.stdout.trim()];
  }
  const run = () => execFileAsync(process.execPath, ['--input-type=module', '-e', inline[1]], {
    cwd: directory, env: { ...env, VALIDATION_SOURCES: JSON.stringify(sources) }, timeout: 10_000,
  });
  await run();
  const primitiveRoot = path.join(directory, paths.primitives);
  await execFileAsync('git', ['-C', primitiveRoot, '-c', 'tag.gpgsign=false', 'tag', '--annotate', 'fixture-tag', '-m', 'fixture'],
    { env, timeout: 10_000 });
  const tag = await execFileAsync('git', ['-C', primitiveRoot, 'rev-parse', 'fixture-tag'], { env, timeout: 10_000 });
  sources.primitives = [tag.stdout.trim()];
  await assert.rejects(run(), (error) => error.code === 1 && error.stdout === ''
    && /Validation requires an exact commit object: primitives/.test(error.stderr));
});

test('the reusable quality workflow validates its pin from a fresh checkout', async (t) => {
  const workflow = parseRepositoryYaml(await readFile(path.join(repositoryRoot,
    '.github/workflows/agentic-delivery-quality.yml'), 'utf8'));
  const steps = workflow.jobs['control-plane-contract'].steps;
  const checkout = steps.find((entry) => entry.name === 'Check out the pinned Control Plane');
  const validate = steps.find((entry) => entry.name === 'Validate the pinned Control Plane contract');
  const release = JSON.parse(await readFile(path.join(repositoryRoot, 'config/controller-release.json'), 'utf8'));
  const depth = Number(checkout.with['fetch-depth'] ?? 1);
  assert.ok(Number.isSafeInteger(depth) && depth >= 0);
  const parent = path.join(`${repositoryRoot}.worktrees`, 'owned-clones');
  await mkdir(parent, { recursive: true });
  const directory = await mkdtemp(path.join(parent, 'consumer-control-plane-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const target = path.join(directory, 'control-plane');
  const env = { ...process.env, GIT_NO_REPLACE_OBJECTS: '1', GIT_NO_LAZY_FETCH: '1' };
  await execFileAsync('git', ['init', '--initial-branch=main', target], { env, timeout: 30_000 });
  // checkout@v5 depth zero obtains the remote default history and tags,
  // including historical release pins outside the selected runtime ancestry.
  // Do not accidentally obtain unpublished local backup branches instead.
  const references = [release.commit];
  if (depth === 0) {
    const main = await execFileAsync('git', ['-C', repositoryRoot, 'rev-parse', 'refs/remotes/origin/main'],
      { env, timeout: 10_000 });
    references.push(main.stdout.trim(), 'refs/tags/*:refs/tags/*');
  }
  await execFileAsync('git', ['-C', target, 'fetch', '--no-tags',
    ...(depth === 0 ? [] : [`--depth=${depth}`]), repositoryRoot, ...references], {
    env, timeout: 60_000, maxBuffer: 8 * 1024 * 1024,
  });
  await execFileAsync('git', ['-C', target, 'checkout', '--detach', release.commit], { env, timeout: 30_000 });
  // Supply the already installed, locked dependencies; Git objects must come
  // exclusively from the fresh checkout selected by the reusable workflow.
  await symlink(path.join(repositoryRoot, 'node_modules'), path.join(target, 'node_modules'),
    process.platform === 'win32' ? 'junction' : 'dir');
  for (const command of validate.run.trim().split(/\r?\n/).filter((line) => line.trim())) {
    const [program, ...args] = command.trim().split(/\s+/);
    assert.equal(program, 'node', 'Contract validation runs the declared Node entry points.');
    await execFileAsync(process.execPath, args, { cwd: directory, env, timeout: 60_000,
      maxBuffer: 8 * 1024 * 1024 });
  }
});

test('the reusable Architecture workflow writes a readable conformance request', async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'consumer-conformance-request-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const workflow = parseRepositoryYaml(await readFile(path.join(repositoryRoot,
    '.github/workflows/agentic-delivery-architecture-review.yml'), 'utf8'));
  const step = workflow.jobs['architecture-contract'].steps.find((entry) => (
    entry.name === 'Create the immutable conformance request'
  ));
  const inline = step.run.match(/node --input-type=module -e '([\s\S]+)'\s*$/);
  assert.ok(inline, 'The producer must expose its complete inline Node program.');
  const requestPath = path.join(directory, 'request.json');
  const identifiers = ['urn:agentic-delivery:architecture:authority'];
  await execFileAsync(process.execPath, ['--input-type=module', '-e', inline[1]], {
    cwd: directory,
    env: { ...process.env, REQUEST_PATH: requestPath, ARCHITECTURE_COMMIT: 'a'.repeat(40),
      ARCHITECTURE_DIGEST: 'b'.repeat(64), IMPLEMENTATION_COMMIT: 'c'.repeat(40),
      AFFECTED_IDENTIFIERS: JSON.stringify(identifiers) },
    timeout: 10_000,
  });
  assert.deepEqual(JSON.parse(await readFile(requestPath, 'utf8')), {
    schemaVersion: 1, architectureCommit: 'a'.repeat(40), architectureDigest: 'b'.repeat(64),
    implementationCommit: 'c'.repeat(40), affectedIdentifiers: identifiers,
  });
});
