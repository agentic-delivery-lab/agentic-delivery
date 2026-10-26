import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';
import Ajv2020 from 'ajv/dist/2020.js';

import { parseRepositoryYaml } from '../../scripts/lib/yaml.mjs';
import { validatePrimitiveSelection, primitiveSelectionMatchesDependency } from '../../scripts/lib/primitive-selection.mjs';

test('selection 1.1 compares typed IDs only at an explicit v3 dependency boundary', () => {
  const selection = { schemaVersion: 1, contractVersion: '1.1.0', source: {
    repository: 'agentic-delivery-lab/agentic-delivery-agent-customizations', repositoryId: '1380894656',
    version: '0.1.0-draft.15', commit: 'a'.repeat(40), contentSha256: 'b'.repeat(64),
  } };
  const dependency = { ...selection.source, repositoryId: 1380894656 };
  assert.equal(primitiveSelectionMatchesDependency(selection, dependency, { dependencySchemaVersion: 3 }), true);
  assert.equal(primitiveSelectionMatchesDependency(selection, dependency), false);
  for (const id of ['1380894656', 999999, undefined]) {
    assert.equal(primitiveSelectionMatchesDependency(selection, { ...dependency, repositoryId: id }, { dependencySchemaVersion: 3 }), false);
  }
  assert.equal(primitiveSelectionMatchesDependency(selection, dependency, { dependencySchemaVersion: 4 }), false);
});

const repositoryRoot = path.resolve(import.meta.dirname, '../..');
const selection = parseRepositoryYaml(
  await readFile(path.join(repositoryRoot, 'config/primitive-selection.yml'), 'utf8'),
  'primitive selection',
);
const policy = parseRepositoryYaml(
  await readFile(path.join(repositoryRoot, 'config/orchestration-policy.yml'), 'utf8'),
  'orchestration policy',
);
const selectionSchema = JSON.parse(await readFile(path.join(repositoryRoot, 'schemas/primitive-selection.v1.schema.json'), 'utf8'));
const schemaValidates = new Ajv2020({ strict: false }).compile(selectionSchema);
const primitiveCatalog = {
  primitives: [
    'codex-delivery',
    'architecture-decision',
    'delivery-workflow',
    'plain-language-communication',
    'ubiquitous-language',
  ].map((id) => ({ id })),
};

test('primitive selection is a complete, policy-aligned release contract', () => {
  assert.deepEqual(validatePrimitiveSelection(selection, { policy, primitiveCatalog }), { valid: true, errors: [] });
  assert.deepEqual(Object.keys(selection.profiles).sort(), Object.keys(policy.profiles).sort());
  assert.equal(selection.source.commit.length, 40);
  assert.equal(selection.source.contentSha256.length, 64);
});

test('primitive selection rejects unknown primitives and profile drift', () => {
  const invalid = structuredClone(selection);
  invalid.profiles.router.primitiveIds = ['invented-primitive'];
  invalid.profiles.router.capabilities = ['repository-write'];
  invalid.profiles.router.model = 'unapproved-model';
  const result = validatePrimitiveSelection(invalid, { policy, primitiveCatalog });
  assert.equal(result.valid, false);
  assert.match(result.errors.join('\n'), /unknown Primitive|capabilities do not match|model does not match/);
});

test('primitive selection fails closed for mutable or incomplete source pins', () => {
  const invalid = structuredClone(selection);
  invalid.source.commit = 'main';
  invalid.source.contentSha256 = null;
  invalid.profiles.validator.fallback = 'continue-anyway';
  const result = validatePrimitiveSelection(invalid, { policy, primitiveCatalog });
  assert.equal(result.valid, false);
  assert.match(result.errors.join('\n'), /source\.commit|source\.contentSha256|fallback/);
});

test('selection 1.1 binds the renamed source to its unchanged repository ID', () => {
  const renamed = structuredClone(selection);
  renamed.contractVersion = '1.1.0';
  renamed.source.repository = 'agentic-delivery-lab/agentic-delivery-agent-customizations';
  renamed.source.repositoryId = '1380894656';
  assert.deepEqual(validatePrimitiveSelection(renamed, { policy, primitiveCatalog }), { valid: true, errors: [] });
  assert.equal(schemaValidates(renamed), true, JSON.stringify(schemaValidates.errors));
  for (const id of [undefined, '999999', 1380894656]) {
    renamed.source.repositoryId = id;
    assert.equal(validatePrimitiveSelection(renamed, { policy, primitiveCatalog }).valid, false);
    assert.equal(schemaValidates(renamed), false);
  }
});

test('historical selection cannot change location without the new identity contract', () => {
  const historical = structuredClone(selection);
  historical.contractVersion = '1.0.0';
  historical.source.repository = 'agentic-delivery-lab/agentic-delivery-agent-customizations';
  historical.source.repositoryId = '1380894656';
  assert.equal(validatePrimitiveSelection(historical, { policy, primitiveCatalog }).valid, false);
  assert.equal(schemaValidates(historical), false);
  historical.source.repository = 'agentic-delivery-lab/agentic-delivery-primitives';
  delete historical.source.repositoryId;
  assert.equal(validatePrimitiveSelection(historical, { policy, primitiveCatalog }).valid, true);
  assert.equal(schemaValidates(historical), true, JSON.stringify(schemaValidates.errors));
  historical.contractVersion = '1.1.0';
  assert.equal(validatePrimitiveSelection(historical, { policy, primitiveCatalog }).valid, false);
  assert.equal(schemaValidates(historical), false);
});

test('current locator preserves an exact historical release pin without accepting another identity or tree', () => {
  const current = structuredClone(selection);
  current.contractVersion = '1.1.0';
  current.source.repository = 'agentic-delivery-lab/agentic-delivery-agent-customizations';
  current.source.repositoryId = '1380894656';
  const dependency = { ...current.source, repository: 'agentic-delivery-lab/agentic-delivery-primitives' };
  delete dependency.repositoryId;
  assert.equal(primitiveSelectionMatchesDependency(current, dependency), true);
  for (const key of ['version', 'commit', 'contentSha256', 'repository']) {
    assert.equal(primitiveSelectionMatchesDependency(current, { ...dependency, [key]: 'unapproved' }), false);
  }
  assert.equal(primitiveSelectionMatchesDependency(current, { ...dependency, repositoryId: '999999' }), false);
  current.source.repositoryId = '999999';
  assert.equal(primitiveSelectionMatchesDependency(current, dependency), false);
});
