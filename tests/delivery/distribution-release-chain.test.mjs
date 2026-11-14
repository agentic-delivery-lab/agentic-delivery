import assert from 'node:assert/strict';
import { access, cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { validateDistributionReleaseChain, validateReleaseChain } from '../../scripts/validate-release-chain.mjs';

const controlPlaneRoot = path.resolve(import.meta.dirname, '../..');
const inputs = {
  controlPlaneRoot,
  architectureRoot: path.resolve(controlPlaneRoot, '../agentic-delivery-architecture'),
  primitivesRoot: path.resolve(controlPlaneRoot, '../agentic-delivery-primitives'),
  distributionRoot: path.resolve(controlPlaneRoot, '../agentic-delivery-distribution'),
};

async function publicSourcesAvailable(t) {
  try { await Promise.all(Object.values(inputs).map((root) => access(root))); return true; }
  catch { t.skip('public split repositories are not checked out'); return false; }
}

test('public validation requires its explicit source roots', async () => {
  await assert.rejects(validateDistributionReleaseChain(), /architectureRoot/);
  for (const key of Object.keys(inputs)) {
    await assert.rejects(validateDistributionReleaseChain({ ...inputs, [key]: undefined }),
      (error) => error.exitCode === 2 && error.message.includes(key));
  }
});

test('full validation still requires private publication inputs', async () => {
  await assert.rejects(validateReleaseChain(inputs), /requires: privateRoot/);
  await assert.rejects(validateReleaseChain({ ...inputs, includePrivatePublication: false }), /requires: privateRoot/);
});

test('public Distribution graph validates without reading private publication', async (t) => {
  if (!await publicSourcesAvailable(t)) return;
  const result = await validateDistributionReleaseChain({ ...inputs,
    privateRoot: path.join(controlPlaneRoot, 'absent-private-publication-fixture') });
  assert.equal(result.status, 'passed');
  assert.equal(result.validationScope, 'public-distribution');
  assert.equal(Object.hasOwn(result, 'privatePublicationAgents'), false);
  assert.equal(result.controller.commit, 'f3b3bf1ab60f62ebafa44c38c7ce56e908900227');
  assert.equal(result.architecture.contentSha256, 'afac7167f6f9d9a9d21d6a9083dbc22b7c86e7979a02546731ef7de2572dcb18');
});

for (const [label, mutate, expected] of [
  ['wrong native ID', (m) => { m.sources.find((source) => source.id === 'architecture').repositoryId = 1; }, /Architecture repository ID/],
  ['wrong producer digest', (m) => { m.contentSha256 = '0'.repeat(64); }, /Capabilities Primitive digest/],
]) {
  test(`public validation rejects ${label} without private access`, async (t) => {
    if (!await publicSourcesAvailable(t)) return;
    const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), 'agentic-public-graph-'));
    t.after(() => rm(temporaryRoot, { recursive: true, force: true }));
    // Projection data only: never copy a Git checkout or dependencies into /tmp.
    for (const relative of ['manifests', 'packages/agent-plugin']) {
      const destination = path.join(temporaryRoot, relative);
      await mkdir(path.dirname(destination), { recursive: true });
      await cp(path.join(inputs.distributionRoot, relative), destination, { recursive: true });
    }
    const relative = label === 'wrong native ID' ? 'manifests/sources.lock.json' : 'manifests/capabilities.lock.json';
    const filename = path.join(temporaryRoot, relative);
    const document = JSON.parse(await readFile(filename, 'utf8')); mutate(document);
    await writeFile(filename, `${JSON.stringify(document, null, 2)}\n`);
    await assert.rejects(validateDistributionReleaseChain({ ...inputs, distributionRoot: temporaryRoot }), expected);
  });
}
