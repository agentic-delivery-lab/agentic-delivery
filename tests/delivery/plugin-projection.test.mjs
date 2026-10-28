import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as releaseChain from '../../scripts/validate-release-chain.mjs';

const legacy = {
  schemaVersion: 1,
  id: 'agentic-delivery',
  version: '0.1.0-draft.7',
  status: 'draft',
  generatedFrom: {
    primitiveRepository: 'agentic-delivery-lab/agentic-delivery-agent-customizations',
    primitiveSourceCommit: '69beab027d8b28fc082fa6054f4def5ba0146e3c',
    controlPlaneCommit: '98495275481aff381180771da6eba9da95bc7816',
  },
  projections: { automations: 'automations/' },
};

function standardManifest() {
  const { version, ...projection } = structuredClone(legacy);
  return {
    $schema: 'https://agent-plugins.org/schemas/1.0.0/plugin.schema.json',
    name: 'agentic-delivery',
    version,
    extensions: { 'io.github.agentic-delivery-lab': projection },
  };
}

test('historical flat projection metadata remains readable without changing its pins', () => {
  const input = structuredClone(legacy);
  assert.deepEqual(releaseChain.distributionPluginProjection(input), legacy);
  assert.deepEqual(input, legacy);
});

test('standard plugin metadata preserves the same factory pins and release version', () => {
  const manifest = standardManifest();
  const before = structuredClone(manifest);
  assert.deepEqual(releaseChain.distributionPluginProjection(manifest), legacy);
  assert.deepEqual(manifest, before);
});

for (const [label, change] of [
  ['unknown standard schema', (m) => { m.$schema = 'https://agent-plugins.org/schemas/2.0.0/plugin.schema.json'; }],
  ['missing standard name', (m) => { delete m.name; }],
  ['missing package version', (m) => { delete m.version; }],
  ['mismatched package identity', (m) => { m.name = 'another-package'; }],
  ['missing factory extension', (m) => { m.extensions = {}; }],
  ['unknown factory metadata version', (m) => { m.extensions['io.github.agentic-delivery-lab'].schemaVersion = 2; }],
  ['ambiguous nested version', (m) => { m.extensions['io.github.agentic-delivery-lab'].version = '0.1.0-draft.99'; }],
  ['ambiguous top-level source pins', (m) => { m.generatedFrom = legacy.generatedFrom; }],
]) {
  test(`plugin projection refuses ${label}`, () => {
    const manifest = standardManifest();
    change(manifest);
    assert.throws(() => releaseChain.distributionPluginProjection(manifest), /Agent Plugin.*(format|metadata)/i);
  });
}

test('an unsupported standard manifest cannot fall back to flat legacy fields', () => {
  assert.throws(() => releaseChain.distributionPluginProjection({ ...legacy, $schema: 'untrusted' }), /Agent Plugin.*(format|metadata)/i);
});

test('unknown legacy metadata versions and mixed containers are rejected', () => {
  for (const manifest of [{ ...legacy, schemaVersion: 2 }, { ...legacy, extensions: {} }, null, []]) {
    assert.throws(() => releaseChain.distributionPluginProjection(manifest), /Agent Plugin.*(format|metadata)/i);
  }
});
