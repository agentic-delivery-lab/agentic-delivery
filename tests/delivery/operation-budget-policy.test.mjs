import assert from 'node:assert/strict';
import { test } from 'node:test';
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
