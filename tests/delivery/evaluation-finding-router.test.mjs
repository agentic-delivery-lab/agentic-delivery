import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';

import {
  compilePinnedEvaluationReportSchema,
  EvaluationFindingRoutingError,
  loadPinnedEvaluationReportSchema,
  routeEvaluationReports,
} from '../../scripts/lib/evaluation-finding-router.mjs';
import { loadParticipantRegistry } from '../../scripts/lib/participant-registry.mjs';
import { parseRepositoryYaml } from '../../scripts/lib/yaml.mjs';

const repositoryRoot = path.resolve(import.meta.dirname, '../..');
const architectureRoot = process.env.EVALUATION_ARCHITECTURE_ROOT;
const schemaContract = architectureRoot ? await loadPinnedEvaluationReportSchema(architectureRoot) : null;
const participantRegistry = await loadParticipantRegistry(repositoryRoot);
const syntheticUnmeasuredReport = parseRepositoryYaml(
  await readFile(path.join(repositoryRoot, 'tests/fixtures/evaluation-reports/synthetic-unmeasured-report.yml'), 'utf8'),
  'synthetic evaluation report fixture',
);
const measuredOwnerIssueReport = parseRepositoryYaml(
  await readFile(path.join(repositoryRoot, 'tests/fixtures/evaluation-reports/measured-owner-issue.yml'), 'utf8'),
  'measured owner Issue report fixture',
);

const sourceIssueUrl = 'https://github.com/agentic-delivery-lab/agentic-delivery/issues/103';
const ownerRepository = 'agentic-delivery-lab/agentic-delivery';
const ownerIssueUrl = `https://github.com/${ownerRepository}/issues/101`;

function pin(repository, seed = 'a') {
  return {
    repository,
    commit: seed.repeat(40),
    path: `evidence/${seed}/artifact.yml`,
    sha256: seed.repeat(64),
  };
}

function measurement(value, overrides = {}) {
  return {
    metricId: 'task-success',
    value,
    unit: 'ratio',
    observationWindow: '100 named cases',
    observedAt: '2026-10-09T09:00:00Z',
    evidenceRefs: ['https://example.invalid/evaluations/run-1'],
    ...overrides,
  };
}

function report(overrides = {}) {
  return { ...structuredClone(measuredOwnerIssueReport), ...overrides };
}

function routeTest(name, callback) {
  test(name, {
    skip: schemaContract ? false : 'Set EVALUATION_ARCHITECTURE_ROOT to the pinned Architecture checkout.',
  }, callback);
}

function route(reports) {
  return routeEvaluationReports({
    reports,
    schemaContract,
    participantRegistry,
    sourceIssueUrl,
  });
}

routeTest('routes a measured report into a review proposal while preserving the complete report', () => {
  const input = report();
  const result = route([input]);

  assert.equal(result.proposals.length, 1);
  assert.equal(result.proposals[0].target.repository, ownerRepository);
  assert.equal(result.proposals[0].target.issueUrl, ownerIssueUrl);
  assert.equal(result.proposals[0].sourceIssueUrl, sourceIssueUrl);
  assert.equal(result.sourceIssueUrl, sourceIssueUrl);
  assert.equal(result.proposals[0].planningStatus, 'awaiting-human-prioritization');
  assert.equal(result.proposals[0].executionAuthorized, false);
  assert.deepEqual(result.proposals[0].sourceReport, input);
  assert.equal(result.proposals[0].reportReference.sha256.length, 64);
  assert.equal(result.proposals[0].reportReference.algorithm, 'sha256-canonical-json-v1');
  assert.equal(result.proposals[0].sourceEvidence.verification, 'references-preserved-but-not-retrieved');
  assert.deepEqual(result.proposals[0].sourceEvidence.evidence, input.evidence);
  assert.deepEqual(result.proposals[0].sourceEvidence.sourcePins.map(({ role }) => role), [
    'subject', 'dataset', 'dependency:0:evaluation-runner', 'grader:deterministic',
    'grader:semantic', 'baseline-definition', 'comparator',
  ]);
  assert.equal('priority' in result.proposals[0], false);
  assert.equal('lifecycleStage' in result.proposals[0], false);
  assert.equal('readiness' in result.proposals[0], false);
  assert.equal('projectItem' in result.proposals[0], false);
  assert.equal(result.mutationsRequested, false);
});

routeTest('keeps the synthetic unmeasured Architecture example as a no-action disposition', () => {
  const result = route([syntheticUnmeasuredReport]);

  assert.equal(result.proposals.length, 0);
  assert.equal(result.dispositions[0].action, 'no-action');
  assert.equal(result.dispositions[0].status, 'no-action');
  assert.equal(result.dispositions[0].reportReference.reportId, syntheticUnmeasuredReport.reportId);
  assert.equal(result.mutationsRequested, false);
});

routeTest('keeps human-review recommendations as dispositions without creating owner proposals', () => {
  const result = route([report({
    recommendation: { action: 'human-review', rationale: 'A human must interpret the evidence.' },
  })]);

  assert.equal(result.proposals.length, 0);
  assert.equal(result.dispositions[0].status, 'awaiting-human-review');
});

routeTest('does not route synthetic evaluation data as an actionable Issue proposal', () => {
  const syntheticAction = report({
    classification: 'synthetic',
    recommendation: { action: 'owner-issue', ownerIssue: ownerIssueUrl, rationale: 'Synthetic only.' },
  });

  assert.throws(() => route([syntheticAction]), /Synthetic reports cannot propose owner Issues/);
});

routeTest('rejects reports with missing pins and schema references that are not immutable', () => {
  const missingPin = report();
  delete missingPin.dataset.sourcePin.sha256;
  assert.throws(() => route([missingPin]), EvaluationFindingRoutingError);

  const unpinnedSchema = report({ $schema: '../../contracts/evaluation-report.schema.json' });
  assert.throws(() => route([unpinnedSchema]), /immutable Architecture schema pin/);
});

routeTest('rejects unsupported contract versions and improvement claims with an unmeasured baseline', () => {
  assert.throws(() => route([report({ contractVersion: '2.0.0' })]), /contractVersion/);

  const unmeasuredImprovement = report({
    baseline: {
      status: 'unmeasured',
      definitionPin: pin('agentic-delivery-lab/agentic-delivery-primitives', '6'),
      reasonUnmeasured: 'No comparable prior run exists.',
    },
  });
  assert.throws(() => route([unmeasuredImprovement]), /baseline|measurement/);
});

routeTest('rejects incomparable baseline and candidate measurements', () => {
  const incomparable = report({
    comparison: {
      ...report().comparison,
      candidateMeasurement: measurement(0.6, { unit: 'points' }),
    },
  });
  assert.throws(() => route([incomparable]), /incomparable/);
});

routeTest('retains deterministic failures, semantic uncertainty, review state, and regression severity', () => {
  const failure = report({
    reportId: 'eval:agent-capability:deterministic-failure',
    classification: 'observed',
    results: {
      deterministicChecks: [{
        checkId: 'protected-file-write',
        outcome: 'fail',
        details: 'The candidate attempted to modify a protected file.',
        evidenceRefs: ['https://example.invalid/evaluations/run-2/checks/protected-file'],
      }],
      semanticJudgments: [{
        criterionId: 'intent-alignment',
        outcome: 'inconclusive',
        reviewer: { id: 'reviewer-2', kind: 'human', relationshipToAuthor: 'unknown' },
        confidence: 0.4,
        rationale: 'The available evidence is ambiguous.',
        evidenceRefs: ['https://example.invalid/evaluations/run-2/reviews/1'],
      }],
    },
    uncertainty: { level: 'high', summary: 'The semantic result is uncertain.', factors: ['The reviewer could not resolve intent.'] },
    review: { status: 'pending', reviewerId: null, rationale: 'Human review remains pending.' },
    regressionAssessment: { severity: 'high', rationale: 'The deterministic boundary check failed.' },
    baseline: {
      status: 'unmeasured',
      definitionPin: pin('agentic-delivery-lab/agentic-delivery-primitives', '6'),
      reasonUnmeasured: 'This deterministic failure does not require a comparative metric.',
    },
    comparison: { ...report().comparison, claim: 'not-compared', candidateMeasurement: undefined },
  });
  delete failure.comparison.candidateMeasurement;

  const result = route([failure]);
  assert.equal(result.proposals[0].sourceReport.results.deterministicChecks[0].outcome, 'fail');
  assert.equal(result.proposals[0].sourceReport.results.semanticJudgments[0].outcome, 'inconclusive');
  assert.equal(result.proposals[0].sourceReport.uncertainty.level, 'high');
  assert.equal(result.proposals[0].sourceReport.review.status, 'pending');
  assert.equal(result.proposals[0].sourceReport.regressionAssessment.severity, 'high');
  assert.equal(result.proposals[0].executionAuthorized, false);
});

routeTest('deduplicates exact replay by report ID and rejects conflicting reuse of that identity', () => {
  const repeated = report();
  const result = route([repeated, structuredClone(repeated)]);
  assert.equal(result.proposals.length, 1);
  assert.equal(result.proposals[0].duplicateCount, 2);

  const conflicting = structuredClone(repeated);
  conflicting.recommendation.rationale = 'A conflicting meaning for the same report ID.';
  assert.throws(() => route([repeated, conflicting]), /conflicting reports share reportId/);
});

routeTest('rejects non-canonical, unregistered, self-targeting, and ambiguous owners', () => {
  assert.throws(() => route([report({
    recommendation: { action: 'owner-issue', ownerIssue: 'https://github.com/agentic-delivery-lab/agentic-delivery-primitives/issues/3', rationale: 'Wrong owner.' },
  })]), /must match the subject sourcePin repository/);

  assert.throws(() => route([report({
    subject: { ...report().subject, sourcePin: pin('agentic-delivery-lab/unknown-product', '8') },
    recommendation: { action: 'owner-issue', ownerIssue: 'https://github.com/agentic-delivery-lab/unknown-product/issues/3', rationale: 'Unknown owner.' },
  })]), /not present in the participant registry/);

  assert.throws(() => route([report({
    recommendation: { action: 'owner-issue', ownerIssue: sourceIssueUrl, rationale: 'Recursive self-target.' },
  })]), /must not target the source Issue/);

  assert.throws(() => route([report({
    recommendation: { action: 'owner-issue', ownerIssue: 'https://github.com/agentic-delivery-lab/agentic-delivery/issues/101?state=open', rationale: 'Non-canonical owner URI.' },
  })]), /canonical GitHub Issue URL/);
});

routeTest('preserves the layer and its pinned canonical owner without collapsing reports', () => {
  const examples = [
    ['agent-capability', 'agentic-delivery-lab/agentic-delivery-primitives', 'a'],
    ['factory', ownerRepository, 'b'],
    ['product-outcome', 'agentic-delivery-lab/agentic-delivery-distribution', 'c'],
  ];
  const reports = examples.map(([layer, owner, seed]) => {
    const input = report({
      reportId: `eval:${layer}:owner-test`,
      layer,
      subject: { ...report().subject, layer, sourcePin: pin(owner, seed) },
      recommendation: {
        action: 'owner-issue',
        ownerIssue: `https://github.com/${owner}/issues/42`,
        rationale: `Keep ${layer} at its pinned owner.`,
      },
    });
    return input;
  });

  const result = route(reports);
  assert.deepEqual(result.proposals.map(({ layer, target }) => [layer, target.repository]), examples.map(([layer, owner]) => [layer, owner]));
});

routeTest('rejects schema bytes that differ from the pinned Architecture digest', () => {
  assert.throws(() => compilePinnedEvaluationReportSchema('not the pinned schema bytes'), /schema SHA-256 does not match the pinned Architecture contract/);
});
