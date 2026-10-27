import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, symlink } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { promisify } from 'node:util';

import { parseRepositoryYaml } from '../../scripts/lib/yaml.mjs';

const repositoryRoot = path.resolve(import.meta.dirname, '../..');
const execFileAsync = promisify(execFile);

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
