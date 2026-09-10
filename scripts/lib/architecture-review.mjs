import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

import { parseRepositoryYaml } from './yaml.mjs';

const execFileAsync = promisify(execFile);
const ADR_FILE = /^docs\/decisions\/(\d{4})-[a-z0-9-]+\.md$/;
const EVIDENCE_MARKER = /<!--\s*codex-delivery-evidence:v1\s*([\s\S]*?)\s*-->/i;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SHA = /^[0-9a-f]{40}$/i;
const URL = /^https?:\/\/\S+$/;

export const REVIEW_SCHEMA_VERSION = 1;

async function git(repositoryRoot, args) {
  const { stdout } = await execFileAsync('git', ['-C', repositoryRoot, ...args], {
    encoding: 'utf8',
    windowsHide: true,
    maxBuffer: 8 * 1024 * 1024,
  });
  return stdout.trim();
}

export async function gitFiles(repositoryRoot, revision, prefix = '') {
  const output = await git(repositoryRoot, ['ls-tree', '-r', '--name-only', revision, ...(prefix ? ['--', prefix] : [])]);
  return output.split(/\r?\n/).filter(Boolean);
}

export async function gitShow(repositoryRoot, revision, file) {
  return git(repositoryRoot, ['show', `${revision}:${file}`]);
}

export async function changedFiles(repositoryRoot, base, head) {
  const output = await git(repositoryRoot, ['diff', '--name-only', `${base}..${head}`]);
  return output.split(/\r?\n/).filter(Boolean);
}

async function mergeBase(repositoryRoot, base, head) {
  return git(repositoryRoot, ['merge-base', base, head]);
}

function patternRegex(pattern) {
  let expression = '^';
  for (let index = 0; index < pattern.length; index += 1) {
    const char = pattern[index];
    if (char === '*' && pattern[index + 1] === '*') {
      if (pattern[index + 2] === '/') {
        expression += '(?:.*/)?';
        index += 2;
      } else {
        expression += '.*';
        index += 1;
      }
    } else if (char === '*') expression += '[^/]*';
    else if (char === '?') expression += '[^/]';
    else expression += char.replace(/[\\^$+.()|[\]{}]/g, '\\$&');
  }
  return new RegExp(`${expression}$`);
}

export function matchesPattern(file, pattern) {
  return patternRegex(pattern).test(file);
}

export function parseEvidenceMarker(body) {
  const match = EVIDENCE_MARKER.exec(String(body ?? ''));
  if (!match) return null;
  try {
    const value = JSON.parse(match[1]);
    return value && typeof value === 'object' ? value : { __error: 'Evidence marker must contain an object.' };
  } catch {
    return { __error: 'Evidence marker is not valid JSON.' };
  }
}

function issueNumberFromBranch(branch) {
  const match = /^\w+\/issue-([1-9][0-9]*)-/.exec(String(branch ?? ''));
  return match ? Number(match[1]) : null;
}

function check(id, status, message, evidence = []) {
  return { id, status, message, evidence };
}

export function validateEvidenceRecord(value, { repository, issueNumber, head } = {}) {
  const errors = [];
  const required = ['schemaVersion', 'producer', 'repository', 'sourceIssue', 'deliveryRun', 'revision', 'codexSession', 'modelTurns', 'architectureContext', 'validation', 'auditCheckpoint'];
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { valid: false, errors: ['Evidence must be an object.'] };
  for (const key of required) if (value[key] === undefined) errors.push(`missing ${key}`);
  const allowed = new Set([...required, 'telemetry']);
  for (const key of Object.keys(value)) if (!allowed.has(key)) errors.push(`unexpected property ${key}`);
  if (value.schemaVersion !== 1) errors.push('schemaVersion must be 1');
  if (value.producer !== 'codex-delivery') errors.push('producer must be codex-delivery');
  if (typeof value.repository !== 'string' || !/^[^/\s]+\/[^/\s]+$/.test(value.repository)) errors.push('repository is invalid');
  if (repository && value.repository !== repository) errors.push('repository does not match the review repository');
  const sourceIssue = value.sourceIssue;
  if (!sourceIssue || !Number.isSafeInteger(sourceIssue.number) || sourceIssue.number < 1 || !URL.test(sourceIssue.url ?? '')) errors.push('sourceIssue is invalid');
  if (issueNumber && sourceIssue?.number !== issueNumber) errors.push('source issue does not match the branch issue');
  if (repository && sourceIssue?.number && sourceIssue.url !== `https://github.com/${repository}/issues/${sourceIssue.number}`) errors.push('source issue URL does not match the repository and issue number');
  const run = value.deliveryRun;
  if (!run || !/^\d+$/.test(String(run.id ?? '')) || !/^\d+$/.test(String(run.attempt ?? '')) || !URL.test(run.url ?? '')) errors.push('deliveryRun is invalid');
  const revision = value.revision;
  if (!revision || typeof revision.branch !== 'string' || !revision.branch.trim() || !SHA.test(revision.commit ?? '') || !SHA.test(revision.tree ?? '')) errors.push('revision is invalid');
  if (head && revision?.commit !== head) errors.push('revision commit does not match the pull-request head');
  if (!value.codexSession || !UUID.test(value.codexSession.id ?? '')) errors.push('codexSession is invalid');
  if (!Array.isArray(value.modelTurns) || value.modelTurns.some((turn) => !turn || !['plan', 'implement', 'review'].includes(turn.phase) || typeof turn.model !== 'string' || typeof turn.effort !== 'string' || typeof turn.mode !== 'string')) errors.push('modelTurns are invalid');
  const architecture = value.architectureContext;
  const adrList = (items) => Array.isArray(items) && items.every((item) => typeof item === 'string' && /^ADR-\d{4}$/.test(item));
  if (!architecture || !adrList(architecture.officialAdrs) || !adrList(architecture.provisionalAdrs) || !adrList(architecture.affectedAdrs) || !Array.isArray(architecture.boundedContexts) || architecture.boundedContexts.some((item) => typeof item !== 'string' || !item.trim())) errors.push('architectureContext is invalid');
  if (!value.validation || !['passed', 'failed', 'inconclusive'].includes(value.validation.status) || typeof value.validation.summary !== 'string' || !value.validation.summary.trim()) errors.push('validation is invalid');
  const checkpoint = value.auditCheckpoint;
  if (!checkpoint || !Number.isSafeInteger(checkpoint.stateVersion) || checkpoint.stateVersion < 1 || !Number.isSafeInteger(checkpoint.entryCount) || checkpoint.entryCount < 0 || !/^[0-9a-f]{64}$/i.test(checkpoint.sha256 ?? '')) errors.push('auditCheckpoint is invalid');
  if (value.telemetry !== undefined && (!value.telemetry || typeof value.telemetry !== 'object' || (value.telemetry.maxUsedPercent !== undefined && (!Number.isFinite(value.telemetry.maxUsedPercent) || value.telemetry.maxUsedPercent < 0 || value.telemetry.maxUsedPercent > 100)))) errors.push('telemetry is invalid');
  return { valid: errors.length === 0, errors };
}

async function mapData(repositoryRoot) {
  const source = await readFile(path.join(repositoryRoot, 'docs/architecture/harness-review.yml'), 'utf8');
  const value = parseRepositoryYaml(source, 'harness review map');
  if (!value || value.version !== 1 || !Array.isArray(value.adrs) || !Array.isArray(value['bounded-contexts']) || !Array.isArray(value['runtime-surfaces'])) {
    throw new Error('harness review map must define version 1, adrs, bounded-contexts, and runtime-surfaces');
  }
  const validPaths = (entry) => Array.isArray(entry?.paths) && entry.paths.length > 0 && entry.paths.every((pattern) => typeof pattern === 'string' && pattern.trim());
  if (value.adrs.some((entry) => !/^ADR-\d{4}$/.test(entry?.id ?? '') || typeof entry.file !== 'string' || !validPaths(entry))
    || new Set(value.adrs.map((entry) => entry.id)).size !== value.adrs.length
    || value['bounded-contexts'].some((entry) => typeof entry?.id !== 'string' || typeof entry.register !== 'string' || !validPaths(entry))
    || value['runtime-surfaces'].some((entry) => typeof entry?.id !== 'string' || !validPaths(entry))) {
    throw new Error('harness review map contains an invalid or duplicate entry');
  }
  return value;
}

function adrIds(files) {
  return files.map((file) => file.match(ADR_FILE)?.[1]).filter(Boolean).map((number) => `ADR-${number}`);
}

function adrEntry(map, id) {
  return map.adrs.find((entry) => entry.id === id);
}

function affectedEntries(map, files, field = 'adrs') {
  return map[field]
    .filter((entry) => (entry.paths ?? []).some((pattern) => files.some((file) => matchesPattern(file, pattern))))
    .map((entry) => entry.id);
}

async function eventData(eventPath) {
  if (!eventPath) return {};
  try { return JSON.parse(await readFile(eventPath, 'utf8')); } catch (error) { throw new Error(`Cannot read pull-request event: ${error.message}`); }
}

function validateEvidence(value, { repository, issueNumber, head }) {
  if (!value) return { status: 'not-applicable', message: 'No Codex delivery evidence marker is present; treat this as a human-created pull request unless other evidence says otherwise.', evidence: [] };
  if (value.__error) return { status: 'fail', message: value.__error, evidence: [] };
  const result = validateEvidenceRecord(value, { repository, issueNumber, head });
  if (!result.valid) return { status: 'fail', message: `Evidence marker validation failed: ${result.errors.join('; ')}.`, evidence: [] };
  return { status: 'pass', message: 'Codex delivery evidence marker is complete and correlated to this revision.', evidence: ['pull-request body:codex-delivery-evidence:v1'] };
}

export async function deterministicReview({ repositoryRoot, base, head, eventPath } = {}) {
  if (!repositoryRoot || !base || !head) throw new Error('repositoryRoot, base, and head are required');
  const event = await eventData(eventPath);
  const repository = event.repository?.full_name ?? process.env.GITHUB_REPOSITORY ?? 'unknown/unknown';
  const pullRequest = event.pull_request ?? {};
  const branch = pullRequest.head?.ref ?? process.env.GITHUB_HEAD_REF ?? '';
  const issueNumber = issueNumberFromBranch(branch);
  const commonAncestor = await mergeBase(repositoryRoot, base, head);
  const files = await changedFiles(repositoryRoot, commonAncestor, head);
  const map = await mapData(repositoryRoot);
  const baseFiles = await gitFiles(repositoryRoot, base, 'docs/decisions');
  const headFiles = await gitFiles(repositoryRoot, head, 'docs/decisions');
  const headRepositoryFiles = await gitFiles(repositoryRoot, head);
  const officialAdrs = adrIds(baseFiles.filter((file) => ADR_FILE.test(file)));
  const currentIds = adrIds(headFiles.filter((file) => ADR_FILE.test(file)));
  const mappedIds = map.adrs.map((entry) => entry.id);
  const checks = [];

  const missingMappings = currentIds.filter((id) => !mappedIds.includes(id));
  checks.push(missingMappings.length
    ? check('adr-map-coverage', 'fail', `The impact map is missing ${missingMappings.join(', ')}.`, ['docs/architecture/harness-review.yml'])
    : check('adr-map-coverage', 'pass', `The impact map covers all ${currentIds.length} ADR records.`, ['docs/architecture/harness-review.yml', 'docs/decisions/README.md']));
  const staleMappings = headRepositoryFiles.includes('docs/architecture/harness-review.yml')
    ? mappedIds.filter((id) => !currentIds.includes(id))
    : [];
  checks.push(staleMappings.length
    ? check('adr-map-stale-entries', 'fail', `The impact map contains ADRs absent from the reviewed revision: ${staleMappings.join(', ')}.`, ['docs/architecture/harness-review.yml', 'docs/decisions/README.md'])
    : check('adr-map-stale-entries', 'pass', 'The impact map has no entries for removed ADR records.', ['docs/architecture/harness-review.yml']));

  const missingIndexLinks = [];
  const index = await readFile(path.join(repositoryRoot, 'docs/decisions/README.md'), 'utf8');
  for (const file of headFiles.filter((candidate) => ADR_FILE.test(candidate))) if (!index.includes(`(${path.basename(file)})`)) missingIndexLinks.push(file);
  checks.push(missingIndexLinks.length
    ? check('adr-index-links', 'fail', `The decision index does not link ${missingIndexLinks.join(', ')}.`, ['docs/decisions/README.md'])
    : check('adr-index-links', 'pass', 'Every numbered ADR is linked from the decision index.', ['docs/decisions/README.md']));

  const contextIds = map['bounded-contexts'].map((entry) => entry.id);
  checks.push(contextIds.includes('agentic-delivery-governance')
    ? check('bounded-context-map', 'pass', 'The registered agentic-delivery-governance context is mapped.', ['docs/domain/ubiquitous-language.yml', 'docs/architecture/harness-review.yml'])
    : check('bounded-context-map', 'fail', 'The architecture map has no registered bounded context.', ['docs/architecture/harness-review.yml']));

  const missingRegisters = map['bounded-contexts']
    .filter((entry) => !headRepositoryFiles.includes(entry.register))
    .map((entry) => `${entry.id}: ${entry.register}`);
  checks.push(missingRegisters.length
    ? check('domain-register-structure', 'fail', `A mapped bounded context is missing its register: ${missingRegisters.join(', ')}.`, ['docs/domain/ubiquitous-language.yml', 'docs/architecture/harness-review.yml'])
    : check('domain-register-structure', 'pass', 'Every mapped bounded context has a register in the reviewed revision.', ['docs/domain/ubiquitous-language.yml', 'docs/architecture/harness-review.yml']));

  const evidence = validateEvidence(parseEvidenceMarker(pullRequest.body), { repository, issueNumber, head });
  checks.push(check('delivery-evidence', evidence.status, evidence.message, evidence.evidence));

  const reviewWorkflow = '.github/workflows/harness-architecture-review.yml';
  if (files.includes(reviewWorkflow)) {
    if (!headRepositoryFiles.includes(reviewWorkflow)) {
      checks.push(check('review-workflow-boundary', 'fail', 'The architecture-review workflow was removed from the reviewed revision.', [reviewWorkflow]));
    } else {
      const workflow = await gitShow(repositoryRoot, head, reviewWorkflow);
      const forbiddenPermissions = /(?:contents|issues|pull-requests|actions):\s*write/i.test(workflow);
      const mutationCommand = /(?:gh\s+(?:issue|pr)\s+(?:comment|close)|pulls\/.*PATCH|git\s+(?:push|commit))/i.test(workflow);
      checks.push(forbiddenPermissions || mutationCommand
        ? check('review-workflow-boundary', 'fail', 'The architecture-review workflow grants write access or contains a mutation command.', [reviewWorkflow])
        : check('review-workflow-boundary', 'pass', 'The architecture-review workflow remains read-only and mutation-free.', [reviewWorkflow]));
    }
  } else checks.push(check('review-workflow-boundary', 'not-applicable', 'The architecture-review workflow is unchanged in this revision.', [reviewWorkflow]));

  const changedAdrIds = adrIds(files.filter((file) => ADR_FILE.test(file)));
  const affectedAdrs = [...new Set([...affectedEntries(map, files), ...changedAdrIds])].sort();
  const affectedContexts = [...new Set(map['bounded-contexts']
    .filter((entry) => (entry.paths ?? []).some((pattern) => files.some((file) => matchesPattern(file, pattern))))
    .map((entry) => entry.id))].sort();
  const affectedRuntime = map['runtime-surfaces']
    .filter((entry) => (entry.paths ?? []).some((pattern) => files.some((file) => matchesPattern(file, pattern))))
    .map((entry) => entry.id);

  if (pullRequest.number && !issueNumber) checks.push(check('source-issue-branch', 'fail', 'The pull-request branch does not use an issue-linked name.', ['pull_request.head.ref']));
  else checks.push(check('source-issue-branch', 'pass', issueNumber ? `Branch maps to source issue #${issueNumber}.` : 'No pull-request branch was supplied in the event fixture.', ['pull_request.head.ref']));

  const status = checks.some((item) => item.status === 'fail') ? 'fail' : 'pass';
  return {
    schemaVersion: REVIEW_SCHEMA_VERSION,
    status,
    repository,
    base,
    mergeBase: commonAncestor,
    head,
    pullRequest: pullRequest.number ? { number: pullRequest.number, url: pullRequest.html_url ?? null, branch } : null,
    sourceIssue: issueNumber ? { number: issueNumber, url: `https://github.com/${repository}/issues/${issueNumber}` } : null,
    officialAdrs,
    provisionalAdrs: currentIds.filter((id) => !officialAdrs.includes(id)),
    changedFiles: files,
    affectedAdrs,
    affectedContexts,
    affectedRuntime,
    checks,
    semantic: { status: 'not-run', findings: [], sessionId: null },
  };
}

export function formatReviewMarkdown(review) {
  const title = review.status === 'fail' ? '### Harness Architecture Review: deterministic violations' : '### Harness Architecture Review';
  const lines = [title, '', review.status === 'fail' ? 'Objective architecture checks failed.' : 'Objective architecture checks passed.', ''];
  lines.push(`- Base: \`${review.base}\``);
  if (review.mergeBase) lines.push(`- Merge-base: \`${review.mergeBase}\``);
  lines.push(`- Head: \`${review.head}\``);
  if (review.pullRequest) lines.push(`- Pull request: #${review.pullRequest.number}`);
  if (review.sourceIssue) lines.push(`- Source issue: #${review.sourceIssue.number}`);
  lines.push(`- Affected ADRs: ${review.affectedAdrs.join(', ') || 'none detected'}`);
  lines.push(`- Affected bounded contexts: ${review.affectedContexts.join(', ') || 'none detected'}`);
  lines.push('', '#### Deterministic checks', '');
  for (const item of review.checks) lines.push(`- **${item.status}** \`${item.id}\`: ${item.message}`);
  if (review.semantic?.status && review.semantic.status !== 'not-run') {
    lines.push('', `#### Semantic review: ${review.semantic.status}`, '', review.semantic.summary ?? 'No semantic summary was returned.');
    for (const finding of review.semantic.findings ?? []) lines.push(`- **${finding.severity ?? 'advisory'}** ${finding.statement} (Evidence: ${(finding.evidence ?? []).join(', ') || 'none'})`);
    if (review.semantic.evidenceGaps?.length) {
      lines.push('', '**Evidence gaps**', '', ...review.semantic.evidenceGaps.map((gap) => `- ${gap}`));
    }
  }
  return `${lines.join('\n')}\n`;
}

export { EVIDENCE_MARKER };
