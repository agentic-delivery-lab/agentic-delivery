import assert from 'node:assert/strict';
import path from 'node:path';
import { test } from 'node:test';

import { collectAdrs, collectPrimitives, normalizeRepositoryPath, validateTraceability } from '../../scripts/lib/adr-traceability.mjs';

const repositoryRoot = path.resolve(import.meta.dirname, '../..');

test('repository traceability paths use Git-style separators on every platform', () => {
  assert.equal(normalizeRepositoryPath('scripts\\lib\\adr-traceability.mjs'), 'scripts/lib/adr-traceability.mjs');
});

test('generated traceability covers every active ADR and required enforcement', async () => {
  const { adrs, errors: adrErrors } = await collectAdrs(repositoryRoot);
  const { primitives, errors: primitiveErrors } = await collectPrimitives(repositoryRoot);
  assert.deepEqual(adrErrors, []);
  assert.deepEqual(primitiveErrors, []);
  const result = validateTraceability({
    index: (await import('../../docs/architecture/adr-primitive-index.json', { with: { type: 'json' } })).default,
    adrs,
    primitives,
    domainIds: ['agentic-delivery-governance'],
  });
  assert.equal(result.valid, true, result.errors.join('\n'));
});
