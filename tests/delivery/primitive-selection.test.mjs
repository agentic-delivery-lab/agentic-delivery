import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';

import { parseRepositoryYaml } from '../../scripts/lib/yaml.mjs';
import { validatePrimitiveSelection } from '../../scripts/lib/primitive-selection.mjs';

const repositoryRoot = path.resolve(import.meta.dirname, '../..');
const selection = parseRepositoryYaml(
  await readFile(path.join(repositoryRoot, 'config/primitive-selection.yml'), 'utf8'),
  'primitive selection',
);
const policy = parseRepositoryYaml(
  await readFile(path.join(repositoryRoot, 'config/orchestration-policy.yml'), 'utf8'),
  'orchestration policy',
);
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
