import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import {
  compilePinnedEvaluationReportSchema,
  EvaluationFindingRoutingError,
  loadPinnedEvaluationReportSchema,
  routeEvaluationReports,
} from '../../scripts/lib/evaluation-finding-router.mjs';
import { createEvaluationFindingProposals } from '../../scripts/route-evaluation-findings.mjs';
import { parseRepositoryYaml } from '../../scripts/lib/yaml.mjs';

const repositoryRoot = path.resolve(import.meta.dirname, '../..');
const architectureRoot = process.env.EVALUATION_ARCHITECTURE_ROOT;
const schemaContract = architectureRoot ? await loadPinnedEvaluationReportSchema(architectureRoot) : null;
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
  assert.deepEqual(result.proposals[0].ownershipVerification, {
    status: 'unverified-report-claim',
    source: 'recommendation.ownerIssue',
    requiresHumanConfirmation: true,
  });
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
  assert.deepEqual(result.dispositions[0].sourceReport, syntheticUnmeasuredReport);
  assert.deepEqual(result.dispositions[0].sourceEvidence.evidence, syntheticUnmeasuredReport.evidence);
  assert.deepEqual(result.dispositions[0].sourceEvidence.uncertainty, syntheticUnmeasuredReport.uncertainty);
  assert.deepEqual(result.dispositions[0].sourceEvidence.review, syntheticUnmeasuredReport.review);
  assert.equal(result.dispositions[0].sourceEvidence.sourcePins.length, 7);
  assert.equal(result.mutationsRequested, false);
});

routeTest('keeps human-review recommendations as dispositions without creating owner proposals', () => {
  const input = report({
    recommendation: { action: 'human-review', rationale: 'A human must interpret the evidence.' },
  });

  const result = route([input]);
  assert.equal(result.proposals.length, 0);
  assert.equal(result.dispositions[0].status, 'awaiting-human-review');
  const disposition = result.dispositions[0];
  assert.deepEqual(disposition.sourceReport, input);
  assert.deepEqual(disposition.sourceEvidence.uncertainty, input.uncertainty);
  assert.deepEqual(disposition.sourceEvidence.review, input.review);
  assert.deepEqual(disposition.sourceEvidence.sourcePins, [
    { role: 'subject', pin: input.subject.sourcePin },
    { role: 'dataset', pin: input.dataset.sourcePin },
    { role: 'dependency:0:evaluation-runner', pin: input.dependencies[0].sourcePin },
    { role: 'grader:deterministic', pin: input.graders.deterministic.sourcePin },
    { role: 'grader:semantic', pin: input.graders.semantic.sourcePin },
    { role: 'baseline-definition', pin: input.baseline.definitionPin },
    { role: 'comparator', pin: input.comparison.comparator.sourcePin },
  ]);
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

routeTest('checks directional absolute-difference claims against the measurements', () => {
  const improvement = route([report()]).proposals[0];
  assert.equal(improvement.comparisonVerification.status, 'directionally-consistent');

  const lowerIsBetterRegression = report({
    baseline: { ...report().baseline, measurement: measurement(0.4) },
    comparison: {
      ...report().comparison,
      claim: 'regression',
      comparator: { ...report().comparison.comparator, direction: 'lower-is-better' },
      candidateMeasurement: measurement(0.6),
    },
  });
  assert.equal(route([lowerIsBetterRegression]).proposals[0].comparisonVerification.status, 'directionally-consistent');

  const equalValues = report({
    baseline: { ...report().baseline, measurement: measurement(0.6) },
    comparison: { ...report().comparison, claim: 'no-change', candidateMeasurement: measurement(0.6) },
  });
  assert.equal(route([equalValues]).proposals[0].comparisonVerification.status, 'directionally-consistent');

  const contradiction = report({
    comparison: { ...report().comparison, candidateMeasurement: measurement(0.2) },
  });
  assert.throws(() => route([contradiction]), /contradicts measured values and comparator direction/);

  const unequalNoChange = report({
    comparison: { ...report().comparison, claim: 'no-change' },
  });
  assert.equal(route([unequalNoChange]).proposals[0].comparisonVerification.status, 'requires-human-comparator-review');
});

routeTest('marks comparator-dependent claims for human review when the comparator definition is unavailable', () => {
  for (const comparator of [
    { method: 'relative-change', direction: 'higher-is-better' },
    { method: 'threshold', direction: 'lower-is-better' },
    { method: 'absolute-difference', direction: 'target-range' },
  ]) {
    const candidate = report({
      comparison: {
        ...report().comparison,
        comparator: { ...report().comparison.comparator, ...comparator },
      },
    });
    assert.equal(route([candidate]).proposals[0].comparisonVerification.status, 'requires-human-comparator-review');
  }
});

routeTest('runs the proposal CLI without loading a participant registry', async () => {
  const emptyWorkspace = await mkdtemp(path.join(tmpdir(), 'evaluation-finding-router-'));
  try {
    const result = await createEvaluationFindingProposals([
      '--architecture-root', architectureRoot,
      '--source-issue', sourceIssueUrl,
      '--report', path.join(repositoryRoot, 'tests/fixtures/evaluation-reports/measured-owner-issue.yml'),
    ], { cwd: emptyWorkspace });

    assert.equal(result.proposals.length, 1);
    assert.equal(result.proposals[0].ownershipVerification.status, 'unverified-report-claim');
  } finally {
    await rm(emptyWorkspace, { recursive: true, force: true });
  }
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

routeTest('keeps a report-asserted owner candidate unverified when it differs from the subject repository or participant registry', () => {
  const candidateUrl = 'https://github.com/example-product/unregistered/issues/42';
  const candidate = report({
    subject: { ...report().subject, sourcePin: pin('example-product/source-repo', '8') },
    recommendation: { action: 'owner-issue', ownerIssue: candidateUrl, rationale: 'The report proposes a separate product owner.' },
  });
  const proposal = route([candidate]).proposals[0];

  assert.equal(proposal.target.repository, 'example-product/unregistered');
  assert.equal(proposal.target.issueUrl, candidateUrl);
  assert.deepEqual(proposal.ownershipVerification, {
    status: 'unverified-report-claim',
    source: 'recommendation.ownerIssue',
    requiresHumanConfirmation: true,
  });

  assert.throws(() => route([report({
    recommendation: { action: 'owner-issue', ownerIssue: 'https://github.com/agentic-delivery-lab/agentic-delivery/issues/101?state=open', rationale: 'Non-canonical owner URI.' },
  })]), /canonical GitHub Issue URL/);
});

routeTest('rejects self-targeting owner Issues', () => {

  assert.throws(() => route([report({
    recommendation: { action: 'owner-issue', ownerIssue: sourceIssueUrl, rationale: 'Recursive self-target.' },
  })]), /must not target the source Issue/);
});

routeTest('preserves the layer and each report-asserted owner candidate without collapsing reports', () => {
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
