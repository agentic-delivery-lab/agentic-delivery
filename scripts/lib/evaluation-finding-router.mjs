// agentic-primitive: {"id":"evaluation-finding-router","kind":"validator","enforcement":"deterministic","adrs":["ADR-0018"],"domains":["agentic-delivery-control-plane"]}
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';

const execFileAsync = promisify(execFile);
const COMPILED_CONTRACTS = new WeakSet();
const OWNERSHIP_CONTRACTS = new WeakMap();
const GITHUB_ISSUE_URL = /^https:\/\/github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)\/issues\/([1-9][0-9]*)$/;
const MEASURED_CLAIMS = new Set(['improvement', 'regression', 'no-change']);

export const EVALUATION_REPORT_SCHEMA_PIN = Object.freeze({
  repository: 'agentic-delivery-lab/agentic-delivery-architecture',
  version: '0.1.0-draft.24',
  commit: '7b1d21462f70c411e75ae67ce80dcf688c9973e8',
  path: 'architecture/contracts/evaluation-report.schema.json',
  sha256: '02ae624c21234bb7494dfc3308fe5cd54c112909e215192e2a07307651ebf55d',
});

export const EVALUATION_REPORT_SCHEMA_PINS = Object.freeze([
  EVALUATION_REPORT_SCHEMA_PIN,
  Object.freeze({ ...EVALUATION_REPORT_SCHEMA_PIN,
    version: '0.1.0-draft.77', commit: 'e1cb20f94ee398c8a26899cc6219b380975da3ca' }),
]);

function schemaUrl(pin) {
  return `https://github.com/${pin.repository}/blob/${pin.commit}/${pin.path}`;
}

function schemaPinForReport(report, schemaContract) {
  return schemaContract.pins.find(pin => schemaUrl(pin) === report.$schema);
}

export const EVALUATION_REPORT_SCHEMA_URL = `https://github.com/${EVALUATION_REPORT_SCHEMA_PIN.repository}/blob/${EVALUATION_REPORT_SCHEMA_PIN.commit}/${EVALUATION_REPORT_SCHEMA_PIN.path}`;

// Offline source accepted in Architecture PR28; source acceptance and
// runtime adoption remain separate from this integrity-bound consumer.
export const EVALUATION_OWNERSHIP_PIN = Object.freeze({
  repository: 'agentic-delivery-lab/agentic-delivery-architecture',
  commit: '6cd215fd5af50fc042f010cbdc70495c1e71d91b',
  path: 'architecture/evaluation/owners.json',
  sha256: '81d549c1288505767af5a836f078434e94f7d46b29d810325b217b36bedb574b',
  contractVersion: '1.0.0',
});
export const EVALUATION_OWNERSHIP_SCHEMA_PIN = Object.freeze({
  repository: EVALUATION_OWNERSHIP_PIN.repository,
  commit: EVALUATION_OWNERSHIP_PIN.commit,
  path: 'architecture/contracts/evaluation-owners.schema.json',
  sha256: '61241f71db8ae9eed2e0f182d783415b04b353f5fb2aae935eb9ab53e9eda1d3',
});

export class EvaluationFindingRoutingError extends Error {
  constructor(message) {
    super(message);
    this.name = 'EvaluationFindingRoutingError';
  }
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]));
  }
  return value;
}

function canonicalJson(value) {
  return JSON.stringify(canonicalize(value));
}

function schemaValidationErrors(errors = []) {
  return errors.map(({ instancePath, keyword, message }) => `${instancePath || '/'} ${keyword}: ${message}`).join('; ');
}

export function compilePinnedEvaluationReportSchema(schemaSource) {
  return compileEvaluationReportSchema(schemaSource, [EVALUATION_REPORT_SCHEMA_PIN]);
}

function compileEvaluationReportSchema(schemaSource, pins) {
  const source = Buffer.isBuffer(schemaSource) ? schemaSource.toString('utf8') : String(schemaSource ?? '');
  if (sha256(source) !== EVALUATION_REPORT_SCHEMA_PIN.sha256) {
    throw new EvaluationFindingRoutingError('Evaluation report schema SHA-256 does not match the pinned Architecture contract.');
  }

  let schema;
  try {
    schema = JSON.parse(source);
  } catch (error) {
    throw new EvaluationFindingRoutingError(`Pinned evaluation report schema is not valid JSON: ${error.message}`);
  }

  if (schema.$schema !== 'https://json-schema.org/draft/2020-12/schema') {
    throw new EvaluationFindingRoutingError('Pinned evaluation report schema must use JSON Schema draft 2020-12.');
  }

  let validate;
  try {
    // This valid 2020-12 schema has a conditional `required` that refers to a
    // property declared on its parent object, beyond Ajv's local strict check.
    const ajv = new Ajv2020({ allErrors: true, strict: true, strictRequired: false, validateFormats: true });
    addFormats(ajv);
    validate = ajv.compile(schema);
  } catch (error) {
    throw new EvaluationFindingRoutingError(`Pinned evaluation report schema could not be compiled: ${error.message}`);
  }

  const contract = Object.freeze({
    pin: EVALUATION_REPORT_SCHEMA_PIN,
    pins: Object.freeze([...pins]),
    url: EVALUATION_REPORT_SCHEMA_URL,
    validate,
  });
  COMPILED_CONTRACTS.add(contract);
  return contract;
}

export async function loadPinnedEvaluationReportSchema(architectureRoot) {
  if (typeof architectureRoot !== 'string' || architectureRoot.length === 0) {
    throw new EvaluationFindingRoutingError('An Architecture checkout containing the pinned schema commit is required.');
  }
  let schemaSource;
  try {
    const result = await execFileAsync('git', [
      '-C', architectureRoot,
      'show',
      `${EVALUATION_REPORT_SCHEMA_PIN.commit}:${EVALUATION_REPORT_SCHEMA_PIN.path}`,
    ], { encoding: 'utf8', windowsHide: true, maxBuffer: 2 * 1024 * 1024 });
    schemaSource = result.stdout;
  } catch (error) {
    throw new EvaluationFindingRoutingError(`Could not read the pinned Architecture evaluation schema: ${error.message}`);
  }
  return compilePinnedEvaluationReportSchema(schemaSource);
}

export async function loadPinnedEvaluationReportSchemas(architectureRoot) {
  if (typeof architectureRoot !== 'string' || !architectureRoot) {
    throw new EvaluationFindingRoutingError('An Architecture checkout containing the supported immutable schema commits is required.');
  }
  const sources = await Promise.all(EVALUATION_REPORT_SCHEMA_PINS.map(async pin => {
    let result;
    try {
      result = await execFileAsync('git', [
        '--no-lazy-fetch', '--no-replace-objects', '-c', 'core.fsmonitor=false',
        '-C', architectureRoot, 'show', `${pin.commit}:${pin.path}`,
      ], { encoding: 'utf8', windowsHide: true, maxBuffer: 2 * 1024 * 1024 });
    } catch (error) {
      throw new EvaluationFindingRoutingError(`Could not read pinned Architecture evaluation schema: ${error.message}`);
    }
    if (sha256(result.stdout) !== pin.sha256) {
      throw new EvaluationFindingRoutingError('Evaluation report schema SHA-256 does not match its immutable Architecture pin.');
    }
    return result.stdout;
  }));
  // These two reviewed occurrences have identical 2.0.0 bytes. Any future
  // different schema requires explicit version dispatch, never a URL alias.
  if (sources.some(source => source !== sources[0])) {
    throw new EvaluationFindingRoutingError('Supported report schema pins no longer contain identical contract bytes.');
  }
  return compileEvaluationReportSchema(sources[0], EVALUATION_REPORT_SCHEMA_PINS);
}

function ownershipRoutingKey(layer, subjectId, repository, sourcePath) {
  return canonicalJson([layer, subjectId, repository.toLowerCase(), sourcePath]);
}

export function compilePinnedEvaluationOwnership(mappingSource, schemaSource) {
  const mappingText = Buffer.isBuffer(mappingSource) ? mappingSource.toString('utf8') : String(mappingSource ?? '');
  const schemaText = Buffer.isBuffer(schemaSource) ? schemaSource.toString('utf8') : String(schemaSource ?? '');
  if (sha256(mappingText) !== EVALUATION_OWNERSHIP_PIN.sha256
      || sha256(schemaText) !== EVALUATION_OWNERSHIP_SCHEMA_PIN.sha256) {
    throw new EvaluationFindingRoutingError('Evaluation ownership mapping/schema SHA-256 must match the pinned Architecture bytes.');
  }
  const mapping = JSON.parse(mappingText);
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  addFormats(ajv);
  const validate = ajv.compile(JSON.parse(schemaText));
  if (!validate(mapping)) throw new EvaluationFindingRoutingError(`Invalid pinned ownership map: ${schemaValidationErrors(validate.errors)}`);
  const subjects = new Set();
  const routingSubjects = new Set();
  for (const entry of mapping.mappings) {
    const key = canonicalJson([entry.layer, entry.subjectId, entry.subjectSource.repositoryId, entry.subjectSource.path]);
    const routingKey = ownershipRoutingKey(entry.layer, entry.subjectId, entry.subjectSource.repository, entry.subjectSource.path);
    if (subjects.has(key) || routingSubjects.has(routingKey)) {
      throw new EvaluationFindingRoutingError('Duplicate or conflicting pinned owner mappings.');
    }
    subjects.add(key);
    routingSubjects.add(routingKey);
  }
  // Keep parsed mappings private. A caller cannot mutate a validated owner's
  // identity through a returned object or manufacture a validated contract.
  const contract = Object.freeze({ mappingPin: EVALUATION_OWNERSHIP_PIN, schemaPin: EVALUATION_OWNERSHIP_SCHEMA_PIN });
  OWNERSHIP_CONTRACTS.set(contract, mapping.mappings);
  return contract;
}

export async function loadPinnedEvaluationOwnership(architectureRoot) {
  if (typeof architectureRoot !== 'string' || !architectureRoot) {
    throw new EvaluationFindingRoutingError('An Architecture checkout containing the pinned ownership commit is required.');
  }
  async function readPin(pin) {
    try {
      const result = await execFileAsync('git', [
        '--no-lazy-fetch', '--no-replace-objects', '-c', 'core.fsmonitor=false',
        '-C', architectureRoot, 'show', `${pin.commit}:${pin.path}`,
      ], { encoding: 'utf8', windowsHide: true, maxBuffer: 2 * 1024 * 1024 });
      return result.stdout;
    } catch (error) {
      throw new EvaluationFindingRoutingError(`Could not read pinned Architecture ownership bytes: ${error.message}`);
    }
  }
  return compilePinnedEvaluationOwnership(await readPin(EVALUATION_OWNERSHIP_PIN), await readPin(EVALUATION_OWNERSHIP_SCHEMA_PIN));
}

function canonicalIssueUrl(value, description) {
  if (typeof value !== 'string' || !GITHUB_ISSUE_URL.test(value)) {
    throw new EvaluationFindingRoutingError(`${description} must be a canonical GitHub Issue URL.`);
  }
  return value;
}

function repositoryForIssueUrl(value, description) {
  const canonical = canonicalIssueUrl(value, description);
  const [, owner, name] = GITHUB_ISSUE_URL.exec(canonical);
  return `${owner}/${name}`;
}

function sameGitHubIssue(left, right) {
  const leftParts = GITHUB_ISSUE_URL.exec(left);
  const rightParts = GITHUB_ISSUE_URL.exec(right);
  return leftParts[1].toLowerCase() === rightParts[1].toLowerCase()
    && leftParts[2].toLowerCase() === rightParts[2].toLowerCase()
    && leftParts[3] === rightParts[3];
}

function compareMeasurements(report) {
  const baseline = report.baseline.measurement;
  const candidate = report.comparison.candidateMeasurement;
  if (MEASURED_CLAIMS.has(report.comparison.claim) && (!baseline || !candidate || report.baseline.status !== 'measured')) {
    throw new EvaluationFindingRoutingError(`The ${report.comparison.claim} claim requires measured baseline and candidate measurements.`);
  }
  if (!baseline || !candidate) {
    return {
      claimConsistency: 'not-assessed',
      semanticComparability: {
        status: 'not-assessed',
        reason: 'A measured baseline and candidate are not both present.',
      },
    };
  }

  for (const key of ['metricId', 'unit', 'observationWindow']) {
    if (baseline[key] !== candidate[key]) {
      throw new EvaluationFindingRoutingError(`Baseline and candidate are structurally incomparable because declared ${key} values differ.`);
    }
  }

  const semanticComparability = {
    status: 'unverified',
    matchingDeclarations: ['metricId', 'unit', 'observationWindow'],
    pinnedDefinitions: 'not-retrieved',
    reason: 'Matching measurement labels do not establish semantic comparability; the pinned baseline and comparator definitions were not retrieved.',
  };
  const { claim, comparator } = report.comparison;
  if (!MEASURED_CLAIMS.has(claim)) {
    return {
      claimConsistency: 'not-asserted',
      reason: `The report claim is ${claim}.`,
      semanticComparability,
    };
  }
  if (comparator.method !== 'absolute-difference' || !['higher-is-better', 'lower-is-better'].includes(comparator.direction)) {
    return {
      claimConsistency: 'requires-human-comparator-review',
      reason: 'The pinned comparator definition was not retrieved, so this claim cannot be checked from values and direction alone.',
      semanticComparability,
    };
  }

  const baselineValue = baseline.value;
  const candidateValue = candidate.value;
  const observedClaim = baselineValue === candidateValue
    ? 'no-change'
    : ((candidateValue > baselineValue) === (comparator.direction === 'higher-is-better') ? 'improvement' : 'regression');

  if (claim === 'no-change' && observedClaim !== 'no-change') {
    return {
      claimConsistency: 'requires-human-comparator-review',
      reason: 'Different values may be treated as no change by comparator-specific tolerance rules that are not available locally.',
      semanticComparability,
    };
  }
  if (claim !== observedClaim) {
    throw new EvaluationFindingRoutingError(
      `The ${claim} claim contradicts measured values and comparator direction (observed direction: ${observedClaim}).`,
    );
  }
  return { claimConsistency: 'directionally-consistent', observedClaim, semanticComparability };
}

function collectSourcePins(report) {
  const pins = [
    { role: 'subject', pin: report.subject.sourcePin },
    { role: 'dataset', pin: report.dataset.sourcePin },
    { role: 'dataset-selection-policy', pin: report.dataset.selection.policyPin },
    ...report.dependencies.map((dependency, index) => ({ role: `dependency:${index}:${dependency.id}`, pin: dependency.sourcePin })),
    ...Object.keys(report.graders).sort().flatMap((graderId) => {
      const grader = report.graders[graderId];
      return [
        { role: `grader:${graderId}`, pin: grader.sourcePin },
        ...(grader.calibration.datasetPin
          ? [{ role: `calibration:${graderId}:dataset`, pin: grader.calibration.datasetPin }]
          : []),
      ];
    }),
    { role: 'baseline-definition', pin: report.baseline.definitionPin },
    { role: 'comparator', pin: report.comparison.comparator.sourcePin },
  ];
  return pins.map(({ role, pin }) => ({ role, pin: structuredClone(pin) }));
}

function validateReport(report, schemaContract) {
  const valid = schemaContract.validate(report);
  if (!valid) throw new EvaluationFindingRoutingError(`Evaluation report violates contract 2.0.0: ${schemaValidationErrors(schemaContract.validate.errors)}.`);
  if (!schemaPinForReport(report, schemaContract)) {
    throw new EvaluationFindingRoutingError('Evaluation report must reference the exact immutable Architecture schema pin.');
  }
  return compareMeasurements(report);
}

function buildReportReference(report, schemaContract, canonicalReport) {
  return {
    reportId: report.reportId,
    algorithm: 'sha256-canonical-json-v1',
    sha256: sha256(canonicalReport),
    schema: {
      contractVersion: report.contractVersion,
      url: report.$schema,
      sourcePin: { ...schemaPinForReport(report, schemaContract) },
    },
  };
}

function buildSourceEvidence(report) {
  return {
    verification: 'references-preserved-but-not-retrieved',
    evidence: structuredClone(report.evidence),
    sourcePins: collectSourcePins(report),
    uncertainty: structuredClone(report.uncertainty),
    review: structuredClone(report.review),
  };
}

function routeOne(report, { schemaContract, sourceIssueUrl, canonicalReport, comparisonAssessment, ownershipContract }) {
  const reportReference = buildReportReference(report, schemaContract, canonicalReport);
  const action = report.recommendation.action;
  const shared = {
    reportId: report.reportId,
    layer: report.layer,
    reportReference,
    comparisonAssessment,
    sourceEvidence: buildSourceEvidence(report),
    sourceReport: structuredClone(report),
  };

  if (action !== 'owner-issue') {
    return {
      ...shared,
      action,
      status: action === 'human-review' ? 'awaiting-human-review' : 'no-action',
    };
  }

  const targetUrl = canonicalIssueUrl(report.recommendation.ownerIssue, 'Recommendation ownerIssue');
  const targetRepository = repositoryForIssueUrl(targetUrl, 'Recommendation ownerIssue');
  if (sameGitHubIssue(targetUrl, sourceIssueUrl)) {
    throw new EvaluationFindingRoutingError('Recommendation ownerIssue must not target the source Issue.');
  }

  if (report.classification === 'synthetic') {
    return {
      ...shared,
      action,
      status: 'awaiting-owner-verification',
      ownershipVerification: {
        status: 'unresolved',
        source: 'recommendation.ownerIssue',
        requiresHumanConfirmation: true,
        reason: ownershipContract
          ? 'Synthetic reports cannot expose an owner target, even when an ownership mapping is pinned.'
          : 'Synthetic reports cannot expose an owner target, and no authoritative owner mapping is pinned.',
      },
      executionAuthorized: false,
    };
  }

  const mappings = ownershipContract ? OWNERSHIP_CONTRACTS.get(ownershipContract) : [];
  const routingKey = ownershipRoutingKey(report.layer, report.subject.id, report.subject.sourcePin.repository, report.subject.sourcePin.path);
  const mapping = mappings.find(entry => ownershipRoutingKey(
    entry.layer, entry.subjectId, entry.subjectSource.repository, entry.subjectSource.path,
  ) === routingKey);
  if (mapping) {
    if (targetRepository.toLowerCase() !== mapping.owner.repository.toLowerCase()) {
      throw new EvaluationFindingRoutingError('Report owner Issue contradicts the pinned owner repository.');
    }
    return {
      ...shared,
      action,
      status: 'awaiting-human-prioritization',
      target: { ...mapping.owner },
      ownershipVerification: {
        status: 'mapped-for-review',
        mappingReference: { ...ownershipContract.mappingPin },
        schemaReference: { ...ownershipContract.schemaPin },
        mappingSourceIssue: mapping.sourceIssue,
        subjectRepositoryId: mapping.subjectSource.repositoryId,
        nativeIdentity: 'expected-from-pinned-map-not-reverified',
      },
      requiresTargetVerification: true,
      requiresHumanPrioritization: true,
      empiricalClaimsVerified: false,
      executionAuthorized: false,
    };
  }

  return {
    ...shared,
    action,
    status: 'awaiting-owner-verification',
    candidateTarget: { repository: targetRepository, issueUrl: targetUrl },
    ownershipVerification: {
      status: 'unresolved',
      source: 'recommendation.ownerIssue',
      requiresHumanConfirmation: true,
      reason: ownershipContract
        ? 'No pinned owner mapping matches this report layer, subject and source.'
        : 'No authoritative owner mapping is pinned for this report layer.',
    },
    executionAuthorized: false,
  };
}

export function routeEvaluationReports({ reports, schemaContract, sourceIssueUrl, ownershipContract } = {}) {
  if (ownershipContract !== undefined && !OWNERSHIP_CONTRACTS.has(ownershipContract)) {
    throw new EvaluationFindingRoutingError('A contract compiled from the pinned Architecture ownership bytes is required.');
  }
  if (!COMPILED_CONTRACTS.has(schemaContract)) {
    throw new EvaluationFindingRoutingError('A schema contract compiled from the pinned Architecture bytes is required.');
  }
  const canonicalSourceIssue = canonicalIssueUrl(sourceIssueUrl, 'Source Issue');
  if (!Array.isArray(reports) || reports.length === 0) {
    throw new EvaluationFindingRoutingError('At least one evaluation report is required.');
  }

  const uniqueReports = new Map();
  for (const report of reports) {
    const comparisonAssessment = validateReport(report, schemaContract);
    const canonicalReport = canonicalJson(report);
    const fingerprint = sha256(canonicalReport);
    const previous = uniqueReports.get(report.reportId);
    if (previous) {
      if (previous.fingerprint !== fingerprint) {
        throw new EvaluationFindingRoutingError(`conflicting reports share reportId ${report.reportId}.`);
      }
      previous.duplicateCount += 1;
      continue;
    }
    uniqueReports.set(report.reportId, { report, canonicalReport, fingerprint, duplicateCount: 1, comparisonAssessment });
  }

  const proposals = [];
  const dispositions = [];
  for (const { report, canonicalReport, duplicateCount, comparisonAssessment } of uniqueReports.values()) {
    const result = routeOne(report, {
      schemaContract,
      sourceIssueUrl: canonicalSourceIssue,
      canonicalReport,
      comparisonAssessment,
      ownershipContract,
    });
    if (result.target) {
      result.duplicateCount = duplicateCount;
      proposals.push(result);
    } else {
      dispositions.push({ ...result, duplicateCount });
    }
  }

  const usedSchemaPins = [...new Map([...uniqueReports.values()].map(({ report }) => (
    [report.$schema, schemaPinForReport(report, schemaContract)]
  ))).values()];
  return {
    schemaPin: usedSchemaPins.length === 1 ? { ...usedSchemaPins[0] } : null,
    ...(usedSchemaPins.length > 1 ? { schemaPins: usedSchemaPins.map(pin => ({ ...pin })) } : {}),
    ...(ownershipContract ? { ownership: { mappingPin: { ...ownershipContract.mappingPin }, schemaPin: { ...ownershipContract.schemaPin } } } : {}),
    sourceIssueUrl: canonicalSourceIssue,
    proposals,
    dispositions,
    mutationsRequested: false,
  };
}
