import assert from 'node:assert/strict';
import path from 'node:path';
import { test } from 'node:test';

import { loadLifecycleConfig } from '../../scripts/issue-intake.mjs';
import { validateTransition } from '../../scripts/lib/lifecycle-transitions.mjs';
import { validateRefinementOutcome } from '../../scripts/lib/codex-loop.mjs';

const config = await loadLifecycleConfig(path.resolve(import.meta.dirname, '../..'));

test('transition validator accepts configured refinement and coordination paths', () => {
  assert.equal(validateTransition({ config, from: 'intake', to: 'definition', workType: 'feature' }).allowed, true);
  assert.equal(validateTransition({ config, from: 'acceptance', to: 'done', workType: 'feature', dependencies: [{ state: 'done' }] }).allowed, true);
});

test('transition validator rejects model proposals that bypass state or dependencies', () => {
  const invalid = validateTransition({ config, from: 'definition', to: 'validation', workType: 'feature' });
  assert.equal(invalid.allowed, false);
  assert.match(invalid.reasons.join(' '), /not allowed/);
  const blocked = validateTransition({ config, from: 'acceptance', to: 'execution', workType: 'feature', dependencies: [{ state: 'in-progress' }] });
  assert.equal(blocked.allowed, false);
  assert.match(blocked.reasons.join(' '), /dependencies/);
});

test('refinement validation bounds questions, child work, and dependencies', () => {
  const value = {
    status: 'refined', summary: 'Clear request.', workType: 'feature', refinedGoal: 'Deliver the result.', audience: 'Maintainers',
    questions: [], requirements: [], constraints: [], acceptanceCriteria: ['The result is reviewable.'],
    affectedContexts: ['agentic-delivery-governance'], unresolvedDecisions: [],
    workItems: [{ key: 'research', kind: 'research', title: 'Research the current behavior', goal: 'Collect evidence.', acceptanceCriteria: ['Evidence is recorded.'], dependencies: [] },
      { key: 'implementation', kind: 'implementation', title: 'Implement the result', goal: 'Apply the evidence.', acceptanceCriteria: ['Tests pass.'], dependencies: ['research'] }],
  };
  assert.deepEqual(validateRefinementOutcome(JSON.stringify(value)), value);
  assert.throws(() => validateRefinementOutcome(JSON.stringify({ ...value, workType: null })), /work type/);
  assert.throws(() => validateRefinementOutcome(JSON.stringify({ ...value, workItems: value.workItems.map((item) => ({ ...item, dependencies: ['implementation'] })) })), /acyclic/);
  assert.throws(() => validateRefinementOutcome(JSON.stringify({ ...value, status: 'needs_input', questions: [] })), /focused question/);
});
