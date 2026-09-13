import assert from 'node:assert/strict';
import path from 'node:path';
import { test } from 'node:test';

import { loadLifecycleConfig } from '../../scripts/issue-intake.mjs';
import { classifyIssue, validateRoutingProposal } from '../../scripts/lib/issue-routing.mjs';

const repositoryRoot = path.resolve(import.meta.dirname, '../..');
const config = await loadLifecycleConfig(repositoryRoot);

function issue(overrides = {}) {
  return { state: 'open', title: 'Work', body: 'Work details.', labels: [], ...overrides };
}

function formBody(fields) {
  return Object.entries(fields).map(([heading, value]) => `### ${heading}\n\n${value}`).join('\n\n');
}

test('does not infer work type or route from title and body wording', () => {
  const bug = classifyIssue({
    issue: issue({
      title: 'Bug: broken intake',
      body: formBody({
        'Observed behavior': 'The issue is routed incorrectly.',
        'Expected behavior': 'The issue remains in triage.',
        'Reproduction steps': 'Open an issue.',
        Environment: 'CI',
        'Evidence or logs': 'None',
        Impact: 'Planning starts too early.',
      }),
    }),
    config,
  });
  assert.equal(bug.workType, null);
  assert.equal(bug.state, 'needs-triage');
  assert.equal(bug.route, 'hold');

  const feature = classifyIssue({
    issue: issue({
      title: 'Feature: controlled handoff',
      body: formBody({
        Problem: 'Issues enter delivery too soon.',
        'Desired outcome': 'Ready work starts automatically.',
        'Beneficiary or user': 'Maintainers.',
        'Current behavior': 'Every opened issue starts Plan.',
        Constraints: 'Keep the existing controller.',
        'Acceptance signals': 'A ready label starts Plan.',
        'Known architectural impact': 'None known',
      }),
    }),
    config,
  });
  assert.equal(feature.workType, null);
  assert.equal(feature.state, 'needs-triage');
});

test('allows an untyped blank issue to enter model-selected refinement', () => {
  const proposal = validateRoutingProposal({
    proposal: { route: 'refine', workType: null, state: 'needs-triage', governance: [], summary: 'Clarify the goal.', message: '' },
    issue: issue({ title: '', body: '' }), event: { kind: 'issues', action: 'opened' }, config,
  });
  assert.equal(proposal.route, 'refine');
  assert.equal(proposal.workType, null);
});

test('routes a partially completed structured form to requirements with needs-info readiness', () => {
  const result = classifyIssue({
    issue: issue({
      title: 'Bug: incomplete report',
      body: '### Observed behavior\n\nIt fails.\n\n### Expected behavior\n\nIt should work.',
      labels: ['type:bug', 'state:needs-triage'],
    }),
    config,
  });
  assert.equal(result.formDetected, true);
  assert.equal(result.readiness, 'needs-info');
  assert.equal(result.state, 'needs-triage');
  assert.ok(result.missingFields.includes('Reproduction steps'));
  assert.equal(result.route, 'requirements');
});

test('keeps registered label metadata authoritative over prose signals', () => {
  const result = classifyIssue({
    issue: issue({
      title: 'Feature: conflicting report',
      labels: ['type:bug', 'state:needs-triage'],
      body: formBody({
        'Observed behavior': 'The issue is routed incorrectly.',
        'Expected behavior': 'The issue remains in triage.',
        'Reproduction steps': 'Open an issue.',
        Environment: 'CI',
        'Evidence or logs': 'None',
        Impact: 'Planning starts too early.',
      }),
    }),
    config,
  });
  assert.equal(result.workType, 'bug');
  assert.equal(result.conflict, null);
  assert.equal(result.state, 'needs-triage');
  assert.equal(result.route, 'requirements');
});

test('preserves the semantic distinction between Research, Idea, and final disposition', () => {
  const research = classifyIssue({ issue: issue({ labels: ['type:research', 'state:investigating'] }), config });
  assert.equal(research.workType, 'research');
  assert.equal(research.state, 'investigating');
  assert.equal(research.route, 'research');

  const researchFromTriage = classifyIssue({ issue: issue({ labels: ['type:research', 'state:needs-triage'] }), config });
  assert.equal(researchFromTriage.state, 'needs-triage');
  assert.equal(researchFromTriage.route, 'hold');

  const parked = classifyIssue({ issue: issue({ labels: ['type:idea', 'state:parked'] }), config });
  assert.equal(parked.workType, 'idea');
  assert.equal(parked.state, 'parked');
  assert.equal(parked.route, 'hold');

  const abandoned = classifyIssue({ issue: issue({ state: 'closed', state_reason: 'not planned', labels: ['type:idea'] }), config });
  assert.equal(abandoned.state, 'done');
  assert.equal(abandoned.resolution, 'not planned');

  const reopened = classifyIssue({
    issue: issue({ labels: ['type:feature', 'state:done'] }),
    config,
    eventAction: 'reopened',
  });
  assert.equal(reopened.state, 'requirements');
  assert.match(reopened.reasons.join(' '), /Reopened/);
});

test('readiness is deterministic and blocks unresolved governance and discovery work', () => {
  const ready = classifyIssue({
    issue: issue({ labels: ['type:task', 'state:ready-for-plan'] }),
    config,
  });
  assert.equal(ready.readinessGate.ok, true);
  assert.equal(ready.route, 'plan');

  const adrBlocked = classifyIssue({
    issue: issue({ labels: ['type:feature', 'state:ready-for-plan', 'adr:needed'] }),
    config,
  });
  assert.equal(adrBlocked.readinessGate.ok, false);
  assert.equal(adrBlocked.state, 'ready-for-plan');
  assert.match(adrBlocked.reasons.join(' '), /governance/);

  const architectureReady = classifyIssue({
    issue: issue({ labels: ['type:architecture', 'state:decision-needed', 'adr:needed'] }),
    config,
  });
  assert.equal(architectureReady.readinessGate.ok, false, 'architecture work needs its own decision outcome before delivery');
  assert.equal(architectureReady.route, 'architecture');

  const architectureFromDecision = validateRoutingProposal({
    proposal: { route: 'architecture', workType: 'architecture', lifecycleStage: 'decision', readiness: 'needs-info', governance: ['adr:needed'], orchestrationPattern: 'architecture-decision', summary: 'Analyze the ADR change.', message: '' },
    issue: issue({ labels: ['type:architecture', 'state:decision-needed', 'adr:needed'] }),
    event: { kind: 'issues', action: 'edited' }, config,
  });
  assert.equal(architectureFromDecision.route, 'architecture');

  const ideaReady = classifyIssue({
    issue: issue({ labels: ['type:idea', 'state:ready-for-plan'] }),
    config,
  });
  assert.equal(ideaReady.route, 'hold');
  assert.equal(ideaReady.state, 'ready-for-plan');
  assert.match(ideaReady.reasons.join(' '), /does not authorize/);
});

test('conflicting work-type metadata remains visible and routes to triage', () => {
  const result = classifyIssue({
    issue: issue({ labels: ['type:bug', 'type:feature', 'state:needs-triage'] }),
    config,
  });
  assert.equal(result.workType, null);
  assert.deepEqual(result.conflict, ['bug', 'feature']);
  assert.equal(result.state, 'needs-triage');
  assert.equal(result.route, 'hold');
});

test('conflicting lifecycle state metadata routes to triage instead of guessing', () => {
  const result = classifyIssue({
    issue: issue({ labels: ['type:task', 'state:requirements', 'state:in-progress'] }),
    config,
  });
  assert.equal(result.state, 'needs-triage');
  assert.equal(result.stateConflict, true);
  assert.equal(result.route, 'hold');
  assert.match(result.reasons.join(' '), /multiple legacy lifecycle labels/i);
});

test('invalid requested transitions are rejected without changing the current state', () => {
  const result = classifyIssue({
    issue: issue({ labels: ['type:feature', 'state:needs-triage'] }),
    config,
    requestedStage: 'validation',
  });
  assert.equal(result.state, 'needs-triage');
  assert.equal(result.lifecycleStage, 'intake');
  assert.equal(result.route, 'hold');
  assert.match(result.reasons.join(' '), /not allowed/);
});

test('validates a model routing proposal against configured fields and transitions', () => {
  const current = issue({
    labels: ['type:task', 'state:in-progress'],
    plan: { exists: true, valid: true, digest: 'a'.repeat(64) },
    session: { exists: true, resumable: true, id: '019fb023-24b8-7881-9119-509f078b610e' },
  });
  const result = validateRoutingProposal({
    proposal: {
      route: 'resume', workType: 'task', lifecycleStage: 'execution', readiness: 'working', governance: [], orchestrationPattern: 'implementation-continuation',
      summary: 'Continue the saved implementation.', message: '',
    },
    issue: current,
    event: { kind: 'issue_comment', action: 'created', comment: { body: 'Any paraphrase can carry this intent.' } },
    config,
  });
  assert.equal(result.route, 'resume');
  assert.deepEqual(result.targetFields.lifecycle_stage, 'execution');
  assert.deepEqual(result.targetLabels, []);

  assert.throws(() => validateRoutingProposal({
    proposal: { route: 'hold', workType: 'task', state: 'in-progress', governance: ['state:model-invented'], summary: 'No.', message: '' },
    issue: current, event: {}, config,
  }), /approved governance label/);

  assert.throws(() => validateRoutingProposal({
    proposal: { route: 'plan', workType: 'feature', lifecycleStage: 'validation', readiness: 'ready', governance: [], orchestrationPattern: 'implementation-fresh', summary: 'Skip ahead.', message: '' },
    issue: issue({ labels: ['type:feature', 'state:requirements'] }), event: {}, config,
  }), /transition|Planning|readiness/);

  assert.throws(() => validateRoutingProposal({
    proposal: { route: 'plan', workType: 'task', lifecycleStage: 'parked', readiness: 'ready', governance: [], orchestrationPattern: 'implementation-fresh', summary: 'Bypass the lifecycle.', message: '' },
    issue: issue({ labels: ['type:task', 'state:needs-triage'] }), event: {}, config,
  }), /Only Idea|transition|cannot plan/);
});
