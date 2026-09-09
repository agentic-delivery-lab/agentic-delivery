import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import { validateDomainLanguage } from '../../scripts/validate-domain-language.mjs';
import { runNodeScript } from '../helpers/process.mjs';

const repositoryRoot = path.resolve(import.meta.dirname, '../..');
const fixturesDirectory = path.join(import.meta.dirname, 'fixtures');
const validator = path.join(repositoryRoot, 'scripts', 'validate-domain-language.mjs');

async function fixtureRoot(t, fixtureName) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'agentic-delivery-domain-'));
  await mkdir(path.join(root, 'docs/domain'), { recursive: true });
  await writeFile(
    path.join(root, 'docs/domain/ubiquitous-language.yml'),
    await readFile(path.join(fixturesDirectory, fixtureName)),
  );
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

test('accepts the repository domain register and valid fixture', async (t) => {
  const result = await validateDomainLanguage(repositoryRoot);
  assert.deepEqual(result, { contexts: 1, terms: 33 });
  const root = await fixtureRoot(t, 'valid.yml');
  assert.deepEqual(await validateDomainLanguage(root), { contexts: 1, terms: 2 });
});

test('rejects every invalid domain fixture with exit code 1', async (t) => {
  const entries = (await import('node:fs/promises')).readdir(fixturesDirectory);
  for (const fixtureName of (await entries).filter((name) => name !== 'valid.yml')) {
    const root = await fixtureRoot(t, fixtureName);
    await assert.rejects(validateDomainLanguage(root), (error) => {
      assert.equal(error.exitCode, 1, fixtureName);
      return true;
    });
  }
});

test('returns exit code 2 for missing roots and invalid usage', async () => {
  const missing = await runNodeScript(validator, ['/tmp/agentic-delivery-no-such-root'], { cwd: repositoryRoot });
  assert.equal(missing.status, 2);
  assert.match(missing.stderr, /repository root does not exist/);

  const usage = await runNodeScript(validator, [repositoryRoot, 'unexpected'], { cwd: repositoryRoot });
  assert.equal(usage.status, 2);
  assert.match(usage.stderr, /Usage:/);
});

test('rejects duplicate YAML keys and aliases instead of resolving them', async (t) => {
  const duplicateRoot = await fixtureRoot(t, 'valid.yml');
  const duplicatePath = path.join(duplicateRoot, 'docs/domain/ubiquitous-language.yml');
  const duplicate = await readFile(duplicatePath, 'utf8');
  await writeFile(duplicatePath, `${duplicate}\nversion: 2\n`);
  await assert.rejects(validateDomainLanguage(duplicateRoot), (error) => {
    assert.equal(error.exitCode, 1);
    return true;
  });

  const aliasRoot = await fixtureRoot(t, 'valid.yml');
  const aliasPath = path.join(aliasRoot, 'docs/domain/ubiquitous-language.yml');
  await writeFile(aliasPath, 'version: &version 1\ndomain: *version\n');
  await assert.rejects(validateDomainLanguage(aliasRoot), (error) => {
    assert.equal(error.exitCode, 1);
    return true;
  });
});
