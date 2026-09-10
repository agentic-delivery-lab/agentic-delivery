import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import {
  deterministicReview,
  formatReviewMarkdown,
  matchesPattern,
  parseEvidenceMarker,
  validateEvidenceRecord,
} from '../../scripts/lib/architecture-review.mjs';
import { parseSemanticOutcome, runSemanticReview } from '../../scripts/lib/architecture-review-agent.mjs';
import { runNodeScript } from '../helpers/process.mjs';

const repositoryRoot = path.resolve(import.meta.dirname, '../..');

test('impact patterns and evidence markers are deterministic and bounded', () => {
  assert.equal(matchesPattern('scripts/codex-delivery.mjs', 'scripts/codex-delivery.mjs'), true);
  assert.equal(matchesPattern('tests/delivery/codex-controller.test.mjs', 'tests/delivery/codex-*.test.mjs'), true);
  assert.equal(matchesPattern('docs/decisions/0011-example.md', 'docs/decisions/**'), true);
  assert.equal(matchesPattern('docs/README.md', 'docs/**/*.md'), true);
  assert.equal(matchesPattern('docs/delivery/README.md', 'docs/**/*.md'), true);
  assert.equal(matchesPattern('docs/other.txt', 'docs/decisions/**'), false);
  const marker = parseEvidenceMarker('before\n<!-- codex-delivery-evidence:v1\n{"schemaVersion":1,"producer":"codex-delivery"}\n-->\nafter');
  assert.deepEqual(marker, { schemaVersion: 1, producer: 'codex-delivery' });
  assert.equal(parseEvidenceMarker('<!-- codex-delivery-evidence:v1\nnot-json\n-->').__error, 'Evidence marker is not valid JSON.');
});

test('the current architecture map covers the official ADR set and emits a concise result', async () => {
  const head = (await import('node:child_process')).execFile;
  const { promisify } = await import('node:util');
  const run = promisify(head);
  const { stdout } = await run('git', ['-C', repositoryRoot, 'rev-parse', 'HEAD'], { encoding: 'utf8' });
  const revision = stdout.trim();
  const review = await deterministicReview({ repositoryRoot, base: revision, head: revision });
  assert.equal(review.status, 'pass');
  assert.equal(review.mergeBase, revision);
  assert.equal(review.checks.find((item) => item.id === 'adr-map-coverage').status, 'pass');
  assert.equal(review.checks.find((item) => item.id === 'bounded-context-map').status, 'pass');
  assert.match(formatReviewMarkdown(review), /Harness Architecture Review/);
  assert.match(formatReviewMarkdown(review), /adr-map-coverage/);
});

test('controller evidence is required only when a delivery marker is present', async (t) => {
  const fixture = await mkdtemp(path.join(os.tmpdir(), 'agentic-delivery-review-event-'));
  t.after(() => rm(fixture, { recursive: true, force: true }));
  const revision = (await (async () => {
    const { execFile } = await import('node:child_process');
    const { promisify } = await import('node:util');
    const { stdout } = await promisify(execFile)('git', ['-C', repositoryRoot, 'rev-parse', 'HEAD'], { encoding: 'utf8' });
    return stdout.trim();
  })());
  await writeFile(path.join(fixture, 'event.json'), JSON.stringify({
    repository: { full_name: 'sjefsharp/agentic-delivery' },
    pull_request: {
      number: 25,
      html_url: 'https://github.com/sjefsharp/agentic-delivery/pull/25',
      body: '<!-- codex-delivery-evidence:v1\n{"schemaVersion":1}\n-->',
      head: { ref: 'feat/issue-25-review', sha: revision },
    },
  }));
  const review = await deterministicReview({
    repositoryRoot,
    base: revision,
    head: revision,
    eventPath: path.join(fixture, 'event.json'),
  });
  assert.equal(review.checks.find((item) => item.id === 'delivery-evidence').status, 'fail');
});

test('semantic output requires cited findings and keeps model uncertainty advisory', () => {
  const aligned = parseSemanticOutcome(JSON.stringify({
    status: 'aligned', summary: 'No semantic drift found.', affectedAdrs: ['ADR-0009'],
    affectedContexts: ['agentic-delivery-governance'], findings: [], evidenceGaps: [],
  }));
  assert.equal(aligned.status, 'aligned');
  const findings = parseSemanticOutcome(JSON.stringify({
    status: 'findings', summary: 'The evidence contract is incomplete.', affectedAdrs: ['ADR-0009'],
    affectedContexts: ['agentic-delivery-governance'], evidenceGaps: [], findings: [{
      category: 'traceability', severity: 'concern', statement: 'The PR lacks a session reference.',
      evidence: ['docs/architecture/delivery-evidence.schema.json:12'], recommendedAction: 'Add the reference.',
    }],
  }));
  assert.equal(findings.status, 'findings');
  assert.equal(findings.findings.length, 1);
  const invalid = parseSemanticOutcome(JSON.stringify({
    status: 'aligned', summary: 'bad', affectedAdrs: [], affectedContexts: [],
    findings: [{ category: 'drift', severity: 'concern', statement: 'uncited', evidence: [], recommendedAction: '' }], evidenceGaps: [],
  }));
  assert.equal(invalid.status, 'inconclusive');
});

test('semantic execution reports quota and structured findings without becoming deterministic proof', async () => {
  const revision = (await (async () => {
    const { execFile } = await import('node:child_process');
    const { promisify } = await import('node:util');
    const { stdout } = await promisify(execFile)('git', ['-C', repositoryRoot, 'rev-parse', 'HEAD'], { encoding: 'utf8' });
    return stdout.trim();
  })());
  const review = await deterministicReview({ repositoryRoot, base: revision, head: revision });
  const unavailable = await runSemanticReview({
    repositoryRoot,
    review,
    createClient: () => ({ initialize: async () => {}, capabilities: async () => { throw new Error('quota'); }, close: async () => {} }),
  });
  assert.equal(unavailable.status, 'inconclusive');
  const findings = await runSemanticReview({
    repositoryRoot,
    review,
    createClient: () => ({
      initialize: async () => {}, capabilities: async () => ({}),
      startThread: async () => ({ thread: { id: '019fb023-24b8-7881-9119-509f078b610e' } }), close: async () => {},
    }),
    runTurnImpl: async () => ({ status: 'completed', text: JSON.stringify({
      status: 'findings', summary: 'A cited concern remains.', affectedAdrs: ['ADR-0009'], affectedContexts: ['agentic-delivery-governance'],
      findings: [{ category: 'observability', severity: 'advisory', statement: 'Runtime evidence is unavailable.', evidence: ['Safe runner-state summary'], recommendedAction: 'Record the gap.' }], evidenceGaps: [],
    }) }),
  });
  assert.equal(findings.status, 'findings');
  assert.equal(findings.findings[0].severity, 'advisory');
});

test('the evidence contract validates the complete projection and rejects mismatches', async () => {
  const { execFile } = await import('node:child_process');
  const { promisify } = await import('node:util');
  const { stdout } = await promisify(execFile)('git', ['-C', repositoryRoot, 'rev-parse', 'HEAD'], { encoding: 'utf8' });
  const revision = stdout.trim();
  const evidence = {
    schemaVersion: 1,
    producer: 'codex-delivery',
    repository: 'sjefsharp/agentic-delivery',
    sourceIssue: { number: 25, url: 'https://github.com/sjefsharp/agentic-delivery/issues/25' },
    deliveryRun: { id: '123', attempt: '1', url: 'https://github.com/sjefsharp/agentic-delivery/actions/runs/123' },
    revision: { branch: 'feat/issue-25-review', commit: revision, tree: revision },
    codexSession: { id: '019fb023-24b8-7881-9119-509f078b610e' },
    modelTurns: [{ phase: 'plan', model: 'gpt-5.6-sol', effort: 'high', mode: 'plan' }],
    architectureContext: { officialAdrs: ['ADR-0001'], provisionalAdrs: ['ADR-0011'], affectedAdrs: ['ADR-0011'], boundedContexts: ['agentic-delivery-governance'] },
    validation: { status: 'passed', summary: 'Focused validation passed.' },
    telemetry: { maxUsedPercent: 42, subscriptionOnly: true, capturedAt: '2026-09-10T10:00:00.000Z' },
    auditCheckpoint: { stateVersion: 2, entryCount: 4, sha256: 'a'.repeat(64) },
  };
  assert.deepEqual(validateEvidenceRecord(evidence, { repository: evidence.repository, issueNumber: 25, head: revision }), { valid: true, errors: [] });
  const invalid = validateEvidenceRecord({ ...evidence, revision: { ...evidence.revision, commit: 'b'.repeat(40) } }, { repository: evidence.repository, issueNumber: 25, head: revision });
  assert.equal(invalid.valid, false);
  assert.match(invalid.errors.join(' '), /revision commit/);

  const schema = JSON.parse(await readFile(path.join(repositoryRoot, 'docs/architecture/delivery-evidence.schema.json'), 'utf8'));
  assert.deepEqual(schema.required, ['schemaVersion', 'producer', 'repository', 'sourceIssue', 'deliveryRun', 'revision', 'codexSession', 'modelTurns', 'architectureContext', 'validation', 'auditCheckpoint']);
  assert.ok(schema.properties.modelTurns.items.properties.phase.enum.includes('implement'));
  assert.ok(schema.properties.modelTurns.items.properties.phase.enum.includes('review'));
});

test('the baseline report contains one required matrix row for every official ADR', async () => {
  const report = await readFile(path.join(repositoryRoot, 'docs/architecture/harness-conformance-review.md'), 'utf8');
  for (let number = 1; number <= 10; number += 1) assert.match(report, new RegExp(`\\| ADR-${String(number).padStart(4, '0')}\\b`));
  for (const field of ['Architectural invariant', 'Expected reflection', 'Repository evidence', 'Runtime/history evidence', 'Contradictory evidence', 'Missing evidence', 'Enforcement level', 'Confidence', 'Conformance', 'ADR action']) assert.match(report, new RegExp(field));
  assert.match(report, /agentic-delivery-governance/);
});

test('architecture-review workflow is read-only and does not publish comments', async () => {
  const workflow = await readFile(path.join(repositoryRoot, '.github/workflows/harness-architecture-review.yml'), 'utf8');
  for (const phrase of ['pull_request:', 'contents: read', 'issues: read', 'pull-requests: read', 'actions: read', 'cancel-in-progress: true', '--semantic']) {
    assert.ok(workflow.includes(phrase), `missing workflow control: ${phrase}`);
  }
  assert.doesNotMatch(workflow, /issues:\s*write|pull-requests:\s*write|contents:\s*write/);
  assert.doesNotMatch(workflow, /gh issue comment|curl .*comments|pulls\/.*PATCH/);
});

test('review CLI reserves exit code 2 for invalid invocation', async () => {
  const result = await runNodeScript(path.join(repositoryRoot, 'scripts/harness-architecture-review.mjs'), [], { cwd: repositoryRoot });
  assert.equal(result.status, 2);
  assert.match(result.stderr, /Usage:/);
});
