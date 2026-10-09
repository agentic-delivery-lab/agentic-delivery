// agentic-primitive: {"id":"evaluation-finding-router","kind":"validator","enforcement":"deterministic","adrs":["ADR-0018"],"domains":["agentic-delivery-control-plane"]}
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';

const execFileAsync = promisify(execFile);
const COMPILED_CONTRACTS = new WeakSet();
const GITHUB_ISSUE_URL = /^https:\/\/github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)\/issues\/([1-9][0-9]*)$/;
const MEASURED_CLAIMS = new Set(['improvement', 'regression', 'no-change']);

export const EVALUATION_REPORT_SCHEMA_PIN = Object.freeze({
  repository: 'agentic-delivery-lab/agentic-delivery-architecture',
  version: '0.1.0-draft.20',
  commit: '06e8f6e3daf4e1c5de99dd2342b9e775b9fb13ed',
  path: 'architecture/contracts/evaluation-report.schema.json',
  sha256: '4906c3741ed7e04a4fb655763cea7dcfec5d06000aace38a69aa133035a064cd',
});

export const EVALUATION_REPORT_SCHEMA_URL = `https://github.com/${EVALUATION_REPORT_SCHEMA_PIN.repository}/blob/${EVALUATION_REPORT_SCHEMA_PIN.commit}/${EVALUATION_REPORT_SCHEMA_PIN.path}`;

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

function validateRegistry(registry) {
  if (!registry?.valid || !(registry.participants instanceof Map)) {
    throw new EvaluationFindingRoutingError('A valid participant registry is required to resolve canonical owners.');
  }
}

function canonicalOwnerExists(registry, repository) {
  return [...registry.participants.values()].some((participant) => participant?.expectedFullName === repository);
}

function compareMeasurements(report) {
  const baseline = report.baseline.measurement;
  const candidate = report.comparison.candidateMeasurement;
  if (MEASURED_CLAIMS.has(report.comparison.claim) && (!baseline || !candidate || report.baseline.status !== 'measured')) {
    throw new EvaluationFindingRoutingError(`The ${report.comparison.claim} claim requires measured baseline and candidate measurements.`);
  }
  if (!baseline || !candidate) return;

  for (const key of ['metricId', 'unit', 'observationWindow']) {
    if (baseline[key] !== candidate[key]) {
      throw new EvaluationFindingRoutingError(`Baseline and candidate measurements are incomparable because ${key} differs.`);
    }
  }
}

function collectSourcePins(report) {
  const pins = [
    { role: 'subject', pin: report.subject.sourcePin },
    { role: 'dataset', pin: report.dataset.sourcePin },
    ...report.dependencies.map((dependency, index) => ({ role: `dependency:${index}:${dependency.id}`, pin: dependency.sourcePin })),
    { role: 'grader:deterministic', pin: report.graders.deterministic.sourcePin },
    { role: 'grader:semantic', pin: report.graders.semantic.sourcePin },
    { role: 'baseline-definition', pin: report.baseline.definitionPin },
    { role: 'comparator', pin: report.comparison.comparator.sourcePin },
  ];
  return pins.map(({ role, pin }) => ({ role, pin: structuredClone(pin) }));
}

function validateReport(report, schemaContract) {
  const valid = schemaContract.validate(report);
  if (!valid) throw new EvaluationFindingRoutingError(`Evaluation report violates contract 1.0.0: ${schemaValidationErrors(schemaContract.validate.errors)}.`);
  if (report.$schema !== EVALUATION_REPORT_SCHEMA_URL) {
    throw new EvaluationFindingRoutingError('Evaluation report must reference the exact immutable Architecture schema pin.');
  }
  compareMeasurements(report);
}

function buildReportReference(report, schemaContract, canonicalReport) {
  return {
    reportId: report.reportId,
    algorithm: 'sha256-canonical-json-v1',
    sha256: sha256(canonicalReport),
    schema: {
      contractVersion: report.contractVersion,
      url: schemaContract.url,
      sourcePin: { ...schemaContract.pin },
    },
  };
}

function routeOne(report, { schemaContract, participantRegistry, sourceIssueUrl, canonicalReport }) {
  const reportReference = buildReportReference(report, schemaContract, canonicalReport);
  const action = report.recommendation.action;

  if (action !== 'owner-issue') {
    return {
      reportId: report.reportId,
      action,
      status: action === 'human-review' ? 'awaiting-human-review' : 'no-action',
      reportReference,
    };
  }

  if (report.classification !== 'observed') {
    throw new EvaluationFindingRoutingError('Synthetic reports cannot propose owner Issues.');
  }

  const targetUrl = canonicalIssueUrl(report.recommendation.ownerIssue, 'Recommendation ownerIssue');
  const targetRepository = repositoryForIssueUrl(targetUrl, 'Recommendation ownerIssue');
  const subjectRepository = report.subject.sourcePin.repository;
  if (targetRepository !== subjectRepository) {
    throw new EvaluationFindingRoutingError('Recommendation owner must match the subject sourcePin repository.');
  }
  if (!canonicalOwnerExists(participantRegistry, targetRepository)) {
    throw new EvaluationFindingRoutingError(`Canonical owner ${targetRepository} is not present in the participant registry.`);
  }
  if (targetUrl === sourceIssueUrl) {
    throw new EvaluationFindingRoutingError('Recommendation ownerIssue must not target the source Issue.');
  }

  return {
    reportId: report.reportId,
    duplicateCount: 1,
    layer: report.layer,
    target: { repository: targetRepository, issueUrl: targetUrl },
    sourceIssueUrl,
    planningStatus: 'awaiting-human-prioritization',
    executionAuthorized: false,
    reportReference,
    sourceEvidence: {
      verification: 'references-preserved-but-not-retrieved',
      evidence: structuredClone(report.evidence),
      sourcePins: collectSourcePins(report),
    },
    sourceReport: structuredClone(report),
  };
}

export function routeEvaluationReports({ reports, schemaContract, participantRegistry, sourceIssueUrl } = {}) {
  if (!COMPILED_CONTRACTS.has(schemaContract)) {
    throw new EvaluationFindingRoutingError('A schema contract compiled from the pinned Architecture bytes is required.');
  }
  validateRegistry(participantRegistry);
  const canonicalSourceIssue = canonicalIssueUrl(sourceIssueUrl, 'Source Issue');
  if (!Array.isArray(reports) || reports.length === 0) {
    throw new EvaluationFindingRoutingError('At least one evaluation report is required.');
  }

  const uniqueReports = new Map();
  for (const report of reports) {
    validateReport(report, schemaContract);
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
    uniqueReports.set(report.reportId, { report, canonicalReport, fingerprint, duplicateCount: 1 });
  }

  const proposals = [];
  const dispositions = [];
  for (const { report, canonicalReport, duplicateCount } of uniqueReports.values()) {
    const result = routeOne(report, {
      schemaContract,
      participantRegistry,
      sourceIssueUrl: canonicalSourceIssue,
      canonicalReport,
    });
    if (result.target) {
      result.duplicateCount = duplicateCount;
      proposals.push(result);
    } else {
      dispositions.push({ ...result, duplicateCount });
    }
  }

  return {
    schemaPin: { ...schemaContract.pin },
    sourceIssueUrl: canonicalSourceIssue,
    proposals,
    dispositions,
    mutationsRequested: false,
  };
}
