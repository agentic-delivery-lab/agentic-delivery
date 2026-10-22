import assert from 'node:assert/strict';
import { test } from 'node:test';
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { currentOperationPolicyReference, INITIAL_OPERATION_LIMITS, matchesCurrentOperationPolicy } from '../../scripts/lib/operation-budget-policy.mjs';

test('the proposal reference survives serialization without becoming approval', () => {
  const reference = currentOperationPolicyReference();
  assert.equal(reference.version, '1.0.0-proposed.3');
  assert.equal(Object.hasOwn(INITIAL_OPERATION_LIMITS, 'toolInvocations'), false);
  assert.equal(Object.hasOwn(INITIAL_OPERATION_LIMITS, 'transportAttempts'), false);
  assert.equal(INITIAL_OPERATION_LIMITS.controllerAttempts, 8);
  assert.match(reference.sha256, /^[a-f0-9]{64}$/);
  assert.ok(matchesCurrentOperationPolicy(JSON.parse(JSON.stringify(reference))));
  assert.equal(Object.isFrozen(INITIAL_OPERATION_LIMITS), true);
});

test('changed, missing and augmented references cannot match the admitted operation snapshot', () => {
  const reference = currentOperationPolicyReference();
  for (const candidate of [null, {}, { ...reference, sha256: '0'.repeat(64) }, { ...reference, version: '1.0.0' }, { ...reference, approved: true }]) {
    assert.equal(matchesCurrentOperationPolicy(candidate), false);
  }
  reference.sha256 = '0'.repeat(64);
  assert.ok(matchesCurrentOperationPolicy(currentOperationPolicyReference()));
});

for (const [name, changedFile, before, after] of [
  ['store', 'scripts/lib/operation-budget-store.mjs', 'limit:8', 'limit:7'],
  ['migration', 'api/github/migrations/0009-operation-resource-budgets.sql', 'model_turns BETWEEN 0 AND 8', 'model_turns BETWEEN 0 AND 7'],
]) {
  test(`a changed ${name} reservation limit invalidates the operation policy identity`, async (t) => {
    const root = await mkdtemp(path.join(tmpdir(), 'operation-policy-binding-test-'));
    t.after(() => rm(root, { recursive: true, force: true }));
    const source = path.resolve(import.meta.dirname, '../..');
    for (const file of [
      'scripts/codex-delivery.mjs', 'scripts/lib/codex-client.mjs', 'scripts/lib/codex-loop.mjs',
      'scripts/lib/operation-active-time.mjs', 'scripts/lib/operation-budget-policy.mjs',
      'scripts/lib/operation-budget-store.mjs', 'api/github/migrations/0009-operation-resource-budgets.sql',
    ]) {
      const destination = path.join(root, file);
      await mkdir(path.dirname(destination), { recursive: true });
      await copyFile(path.join(source, file), destination);
    }
    const policyUrl = pathToFileURL(path.join(root, 'scripts/lib/operation-budget-policy.mjs')).href;
    const baseline = (await import(`${policyUrl}?baseline`)).currentOperationPolicyReference();
    const target = path.join(root, changedFile);
    const original = await readFile(target, 'utf8');
    assert.ok(original.includes(before));
    await writeFile(target, original.replace(before, after));
    const changed = (await import(`${policyUrl}?changed`)).currentOperationPolicyReference();
    assert.equal(changed.version, baseline.version);
    assert.notEqual(changed.sha256, baseline.sha256);
  });
}
