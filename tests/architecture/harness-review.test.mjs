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
import { runArchitectureReview } from '../../scripts/harness-architecture-review.mjs';
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
  for (const id of ['traceability-index-equality', 'primitive-reference-integrity', 'adr-domain-compatibility', 'adr-required-enforcement', 'runtime-context-minimal']) {
    assert.equal(review.checks.find((item) => item.id === id).status, 'pass', id);
  }
  assert.equal(review.checks.find((item) => item.id === 'bounded-context-map').status, 'pass');
  const reviewMap = await readFile(path.join(repositoryRoot, 'docs/architecture/harness-review.yml'), 'utf8');
  assert.match(reviewMap, /id: agent-invocation/);
  assert.match(formatReviewMarkdown(review), /Harness Architecture Review/);
  assert.match(formatReviewMarkdown(review), /adr-map-coverage/);
});

test('review reads provisional architecture evidence from the requested head revision', async (t) => {
  const fixture = await mkdtemp(path.join(os.tmpdir(), 'agentic-delivery-revision-review-'));
  t.after(() => rm(fixture, { recursive: true, force: true }));
  const clone = path.join(fixture, 'repository');
  const { execFile } = await import('node:child_process');
  const { promisify } = await import('node:util');
  const run = promisify(execFile);
  await run('git', ['clone', '--quiet', '--no-hardlinks', repositoryRoot, clone]);
  const { stdout } = await run('git', ['-C', clone, 'rev-parse', 'HEAD'], { encoding: 'utf8' });
  const revision = stdout.trim();
  await Promise.all([
    writeFile(path.join(clone, 'docs/architecture/harness-review.yml'), 'invalid working tree data\n'),
    writeFile(path.join(clone, 'docs/architecture/adr-primitive-index.json'), '{}\n'),
    writeFile(path.join(clone, 'docs/decisions/README.md'), 'invalid working tree data\n'),
    writeFile(path.join(clone, 'docs/domain/ubiquitous-language.yml'), 'invalid working tree data\n'),
  ]);
  const review = await deterministicReview({ repositoryRoot: clone, base: revision, head: revision });
  assert.equal(review.status, 'pass');
  const { stdout: decisionFiles } = await run('git', ['-C', clone, 'ls-tree', '-r', '--name-only', revision, 'docs/decisions'], { encoding: 'utf8' });
  const expectedAdrCount = decisionFiles.split(/\r?\n/).filter((file) => /^docs\/decisions\/\d{4}-[a-z0-9-]+\.md$/.test(file)).length;
  assert.equal(review.officialAdrs.length, expectedAdrCount);
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
    repository: { full_name: 'agentic-delivery-lab/agentic-delivery' },
    pull_request: {
      number: 25,
      html_url: 'https://github.com/agentic-delivery-lab/agentic-delivery/pull/25',
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

test('deterministic architecture violations skip semantic model execution', async (t) => {
  const fixture = await mkdtemp(path.join(os.tmpdir(), 'agentic-delivery-harness-skip-'));
  t.after(() => rm(fixture, { recursive: true, force: true }));
  const revision = (await (async () => {
    const { execFile } = await import('node:child_process');
    const { promisify } = await import('node:util');
    const { stdout } = await promisify(execFile)('git', ['-C', repositoryRoot, 'rev-parse', 'HEAD'], { encoding: 'utf8' });
    return stdout.trim();
  })());
  const eventPath = path.join(fixture, 'event.json');
  await writeFile(eventPath, JSON.stringify({
    repository: { full_name: 'agentic-delivery-lab/agentic-delivery' },
    pull_request: { number: 25, head: { ref: 'unlinked-branch', sha: revision } },
  }));
  const result = await runArchitectureReview({
    repositoryRoot,
    base: revision,
    head: revision,
    event: eventPath,
    semantic: true,
  });
  assert.equal(result.status, 'fail');
  assert.equal(result.semantic.status, 'not-run');
  assert.match(result.semantic.skippedReason, /no semantic model turn was started/);
});

test('semantic execution reports quota and structured findings without becoming deterministic proof', async () => {
  const fixture = await mkdtemp(path.join(os.tmpdir(), 'agentic-delivery-semantic-state-'));
  const envKeys = ['GITHUB_REPOSITORY', 'CODEX_REVIEW_STATE_DIR', 'GH_TOKEN'];
  const previousEnv = new Map(envKeys.map((key) => [key, process.env[key]]));
  try {
    const revision = (await (async () => {
      const { execFile } = await import('node:child_process');
      const { promisify } = await import('node:util');
      const { stdout } = await promisify(execFile)('git', ['-C', repositoryRoot, 'rev-parse', 'HEAD'], { encoding: 'utf8' });
      return stdout.trim();
    })());
    const repository = 'agentic-delivery-lab/agentic-delivery';
    const eventPath = path.join(fixture, 'event.json');
    await writeFile(eventPath, JSON.stringify({
      repository: { id: 1, full_name: repository },
      pull_request: {
        number: 25,
        html_url: `https://github.com/${repository}/pull/25`,
        body: 'Semantic review fixture.',
        head: { ref: 'feat/issue-25-semantic-review', sha: revision },
        base: { ref: 'main', sha: revision },
      },
    }));
    Object.assign(process.env, { GITHUB_REPOSITORY: repository, CODEX_REVIEW_STATE_DIR: path.join(fixture, 'reviews') });
    delete process.env.GH_TOKEN;
    const review = await deterministicReview({ repositoryRoot, base: revision, head: revision, eventPath });
    const unavailable = await runSemanticReview({
      repositoryRoot,
      review,
      eventPath,
      createClient: () => ({ initialize: async () => {}, capabilities: async () => { throw new Error('quota'); }, close: async () => {} }),
    });
    assert.equal(unavailable.status, 'inconclusive');
    const findings = await runSemanticReview({
      repositoryRoot,
      review,
      eventPath,
      createClient: () => ({
        initialize: async () => {},
        capabilities: async () => ({
          stop: false,
          usedPercent: 35,
          windows: [{ bucketIndex: 1, slot: 'primary', durationMinutes: 300, usedPercent: 35, resetsAt: 1_800_000_100 }],
          guardSignals: { windowThresholdReached: false, rateLimitReached: false, spendControlReached: false },
        }),
        startThread: async () => ({ thread: { id: '019fb023-24b8-7881-9119-509f078b610e' } }),
        close: async () => {},
      }),
      runTurnImpl: async () => ({ status: 'completed', text: JSON.stringify({
        status: 'findings',
        summary: 'A cited concern remains.',
        affectedAdrs: ['ADR-0009'],
        affectedContexts: ['agentic-delivery-governance'],
        findings: [{
          category: 'observability',
          severity: 'advisory',
          statement: 'Runtime evidence is unavailable.',
          evidence: ['Safe runner-state summary'],
          recommendedAction: 'Record the gap.',
        }],
        evidenceGaps: [],
      }) }),
    });
    assert.equal(findings.status, 'findings');
    assert.equal(findings.findings[0].severity, 'advisory');
    assert.equal(findings.quotaTelemetry.before.highestWindowUsedPercent, 35);
    assert.equal(findings.quotaTelemetry.after.highestWindowUsedPercent, 35);
    assert.match(formatReviewMarkdown({ ...review, semantic: findings }), /highest window use was 35% before and 35% after/);
    assert.match(formatReviewMarkdown({ ...review, semantic: findings }), /bucket 1 primary 300m 35%/);
  } finally {
    for (const key of envKeys) {
      if (previousEnv.get(key) === undefined) delete process.env[key];
      else process.env[key] = previousEnv.get(key);
    }
    await rm(fixture, { recursive: true, force: true });
  }
});

test('semantic evidence bundle includes the live PR body, exact-head checks, and runner preflight', async (t) => {
  const fixture = await mkdtemp(path.join(os.tmpdir(), 'agentic-delivery-semantic-evidence-'));
  t.after(() => rm(fixture, { recursive: true, force: true }));
  const revision = (await (async () => {
    const { execFile } = await import('node:child_process');
    const { promisify } = await import('node:util');
    const { stdout } = await promisify(execFile)('git', ['-C', repositoryRoot, 'rev-parse', 'HEAD'], { encoding: 'utf8' });
    return stdout.trim();
  })());
  const repository = 'agentic-delivery-lab/agentic-delivery';
  let pullRequestBody = 'Runner and semantic checks are pending at PR creation.';
  let qualityConclusion = 'success';
  let pendingQualityFetches = 1;
  let checkFetches = 0;
  const eventPath = path.join(fixture, 'event.json');
  const preflightPath = path.join(fixture, 'preflight.json');
  await Promise.all([
    writeFile(eventPath, JSON.stringify({
      repository: { id: 25, full_name: repository },
      pull_request: {
        number: 25,
        html_url: `https://github.com/${repository}/pull/25`,
        title: 'feat(delivery): ✨ review evidence',
        body: pullRequestBody,
        state: 'open',
        head: { ref: 'feat/issue-25-review-evidence', sha: revision },
        base: { ref: 'main', sha: revision },
      },
    })),
    writeFile(preflightPath, `${JSON.stringify({
      schemaVersion: 1,
      status: 'passed',
      codexCliVersion: '0.159.3',
      accountType: 'chatgpt',
      planMode: 'passed',
      modelCatalog: 'passed',
      permissionProfiles: 'passed',
      modelEffortPairs: [
        { model: 'gpt-6-luna', effort: 'low' },
        { model: 'gpt-6-luna', effort: 'medium' },
        { model: 'gpt-6-luna', effort: 'max' },
        { model: 'gpt-6-sol', effort: 'high' },
      ],
      quota: {
        highestWindowUsedPercent: 96,
        allowanceAvailable: true,
        windows: [
          { bucketIndex: 1, slot: 'primary', durationMinutes: 300, usedPercent: 96, resetsAt: 1_800_000_100 },
          { bucketIndex: 1, slot: 'secondary', durationMinutes: 10_080, usedPercent: 62, resetsAt: 1_800_000_200 },
        ],
        guardSignals: { windowThresholdReached: false, rateLimitReached: false, spendControlReached: false },
      },
      sessionProbe: 'start-and-resume-passed',
      noModelTurn: true,
      capturedAt: '2026-10-01T12:00:00.000Z',
    }, null, 2)}\n`),
  ]);

  const envKeys = ['GH_TOKEN', 'GITHUB_REPOSITORY', 'CODEX_PREFLIGHT_REPORT_PATH', 'CODEX_REVIEW_STATE_DIR', 'RUNNER_PREFLIGHT_OUTCOME', 'RUNNER_SANDBOX_OUTCOME', 'GITHUB_RUN_ID', 'GITHUB_RUN_ATTEMPT', 'HEAD_SHA'];
  const previousEnv = new Map(envKeys.map((key) => [key, process.env[key]]));
  const previousFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = previousFetch;
    for (const key of envKeys) {
      if (previousEnv.get(key) === undefined) delete process.env[key];
      else process.env[key] = previousEnv.get(key);
    }
  });
  Object.assign(process.env, {
    GH_TOKEN: 'test-token',
    GITHUB_REPOSITORY: repository,
    CODEX_PREFLIGHT_REPORT_PATH: preflightPath,
    CODEX_REVIEW_STATE_DIR: path.join(fixture, 'review-state'),
    RUNNER_PREFLIGHT_OUTCOME: 'success',
    RUNNER_SANDBOX_OUTCOME: 'success',
    GITHUB_RUN_ID: '123456',
    GITHUB_RUN_ATTEMPT: '1',
    HEAD_SHA: revision,
  });
  globalThis.fetch = async (url) => {
    const address = String(url);
    if (address.endsWith('/pulls/25')) return {
      ok: true,
      json: async () => ({
        number: 25,
        html_url: `https://github.com/${repository}/pull/25`,
        title: 'feat(delivery): ✨ review evidence',
        body: pullRequestBody,
        state: 'open',
        user: { login: 'octocat' },
        head: { ref: 'feat/issue-25-review-evidence', sha: revision },
        base: { ref: 'main', sha: revision },
      }),
    };
    if (address.includes(`/commits/${revision}/check-runs`)) return {
      ok: true,
      json: async () => {
        checkFetches += 1;
        const qualityPending = pendingQualityFetches > 0;
        if (qualityPending) pendingQualityFetches -= 1;
        const checks = [
          ['Validate pull request body', 654321],
          ['quality', 654322],
          ['portability (ubuntu-latest)', 654323],
          ['portability (macos-latest)', 654324],
          ['portability (windows-latest)', 654325],
          ['review', 654326],
        ].map(([name, id]) => ({
          id,
          name,
          status: name === 'review' ? 'in_progress' : 'completed',
          ...(name === 'quality' && qualityPending
            ? { status: 'in_progress', conclusion: null }
            : { conclusion: name === 'review' ? null : name === 'quality' ? qualityConclusion : 'success' }),
          head_sha: revision,
          html_url: `https://github.com/${repository}/actions/runs/123456/job/${id}`,
          details_url: null,
          app: { name: 'GitHub Actions' },
          started_at: '2026-10-01T12:01:00Z',
          completed_at: name === 'review' ? null : '2026-10-01T12:02:00Z',
          output: { summary: name === 'review' ? 'Do not include this self-review result.' : 'Exact PR head passed.' },
        }));
        return { total_count: checks.length, check_runs: checks };
      },
    };
    if (address.endsWith('/issues/25')) return {
      ok: true,
      json: async () => ({ number: 25, title: 'Review evidence', body: 'Check evidence collection.', state: 'open' }),
    };
    if (address.includes('/issues/25/comments?')) return { ok: true, json: async () => [] };
    throw new Error('Unexpected GitHub evidence request.');
  };

  const event = {
    repository: { full_name: repository },
    pull_request: {
      number: 25,
      html_url: `https://github.com/${repository}/pull/25`,
      body: pullRequestBody,
      head: { ref: 'feat/issue-25-review-evidence', sha: revision },
    },
  };
  await writeFile(eventPath, JSON.stringify(event));
  const review = await deterministicReview({ repositoryRoot, base: revision, head: revision, eventPath });
  let bundleText = '';
  let capabilityReads = 0;
  let modelTurns = 0;
  let threadStarts = 0;
  const result = await runSemanticReview({
    repositoryRoot,
    review,
    eventPath,
    sleepImpl: async () => {},
    checkWaitTimeoutMs: 1000,
    checkPollIntervalMs: 0,
    createClient: ({ readableFiles }) => ({
      initialize: async () => {},
      capabilities: async () => {
        const usedPercent = capabilityReads++ === 0 ? 96 : 97;
        return {
          stop: false,
          usedPercent,
          windows: [
            { bucketIndex: 1, slot: 'primary', durationMinutes: 300, usedPercent, resetsAt: 1_800_000_100 },
            { bucketIndex: 1, slot: 'secondary', durationMinutes: 10_080, usedPercent: 62, resetsAt: 1_800_000_200 },
          ],
          guardSignals: { windowThresholdReached: false, rateLimitReached: false, spendControlReached: false },
        };
      },
      startThread: async () => ({ thread: { id: threadStarts++ === 0 ? '019fb023-24b8-7881-9119-509f078b610e' : '119fb023-24b8-7881-9119-509f078b610e' } }),
      close: async () => {},
      readableFiles,
    }),
    runTurnImpl: async ({ client }) => {
      modelTurns += 1;
      bundleText = await readFile(client.readableFiles[0], 'utf8');
      return { status: 'completed', text: JSON.stringify({
        status: 'aligned',
        summary: 'The review evidence is sufficient.',
        affectedAdrs: ['ADR-0009'],
        affectedContexts: ['agentic-delivery-governance'],
        findings: [],
        evidenceGaps: [],
      }) };
    },
  });
  assert.equal(result.status, 'aligned');
  assert.equal(result.reviewSession.disposition, 'completed');
  assert.equal(checkFetches, 2, 'Harness waits for required exact-head checks before the model turn.');
  assert.match(bundleText, /Runner and semantic checks are pending at PR creation\./);
  assert.match(bundleText, /"id": 654321/);
  assert.match(bundleText, /"conclusion": "success"/);
  assert.match(bundleText, /"codexCliVersion": "0\.159\.3"/);
  assert.match(bundleText, /no ADR-linked primitives selected because this review has no affected ADR/);
  assert.doesNotMatch(bundleText, /function safePreflightReport|export async function runSemanticReview/);
  assert.ok(bundleText.length < 100_000, 'unrelated primitive source files must not inflate the semantic evidence bundle');
  assert.doesNotMatch(bundleText, /Do not include this self-review result|"id": 654326/);
  assert.match(bundleText, /quota telemetry is recorded by the runner/i);
  const quotaFields = /highestWindowUsedPercent|allowanceAvailable|durationMinutes|windowThresholdReached/;
  const quotaFieldMatch = quotaFields.exec(bundleText);
  assert.equal(quotaFieldMatch, null, quotaFieldMatch
    ? bundleText.slice(Math.max(0, quotaFieldMatch.index - 120), quotaFieldMatch.index + 180)
    : undefined);
  assert.match(bundleText, /"preflightStepOutcome": "success"/);
  assert.equal(result.quotaTelemetry.after.highestWindowUsedPercent, 97);
  assert.equal(result.quotaTelemetry.after.windows[0].usedPercent, 97);

  const cached = await runSemanticReview({
    repositoryRoot,
    review,
    eventPath,
    createClient: () => { throw new Error('an exact cache hit must not create Codex'); },
    runTurnImpl: async () => { throw new Error('an exact cache hit must not start a model turn'); },
  });
  assert.equal(cached.status, 'aligned');
  assert.equal(cached.reviewSession.disposition, 'cached');
  assert.equal(cached.reviewSession.noModelTurn, true);
  assert.equal(modelTurns, 1);

  const quotaBlockedPreflight = JSON.parse(await readFile(preflightPath, 'utf8'));
  quotaBlockedPreflight.status = 'failed';
  quotaBlockedPreflight.quota.highestWindowUsedPercent = 100;
  quotaBlockedPreflight.quota.allowanceAvailable = false;
  await writeFile(preflightPath, `${JSON.stringify(quotaBlockedPreflight, null, 2)}\n`);
  process.env.RUNNER_PREFLIGHT_OUTCOME = 'failure';
  const cachedDuringQuotaHold = await runSemanticReview({
    repositoryRoot,
    review,
    eventPath,
    createClient: () => { throw new Error('a cached exact review must work without available quota'); },
    runTurnImpl: async () => { throw new Error('a cached exact review must not spend quota'); },
  });
  assert.equal(cachedDuringQuotaHold.reviewSession.disposition, 'cached');
  assert.equal(cachedDuringQuotaHold.reviewSession.noModelTurn, true);
  assert.equal(modelTurns, 1);

  pullRequestBody = 'The exact-head checks and review guidance have been updated.';
  const changedButQuotaBlocked = await runSemanticReview({
    repositoryRoot,
    review,
    eventPath,
    createClient: () => { throw new Error('changed evidence must not bypass a failed quota preflight'); },
    runTurnImpl: async () => { throw new Error('changed evidence must not start a model turn after failed preflight'); },
  });
  assert.equal(changedButQuotaBlocked.status, 'inconclusive');
  assert.equal(changedButQuotaBlocked.reviewSession.noModelTurn, true);
  assert.equal(modelTurns, 1);

  const availablePreflight = JSON.parse(await readFile(preflightPath, 'utf8'));
  availablePreflight.status = 'passed';
  availablePreflight.quota.highestWindowUsedPercent = 96;
  availablePreflight.quota.allowanceAvailable = true;
  await writeFile(preflightPath, `${JSON.stringify(availablePreflight, null, 2)}\n`);
  process.env.RUNNER_PREFLIGHT_OUTCOME = 'success';
  qualityConclusion = 'failure';
  const failedStaticChecks = await runSemanticReview({
    repositoryRoot,
    review,
    eventPath,
    createClient: () => { throw new Error('failed exact-head checks must stop before Codex initialization'); },
    runTurnImpl: async () => { throw new Error('failed exact-head checks must not start a model turn'); },
  });
  assert.equal(failedStaticChecks.status, 'inconclusive');
  assert.equal(failedStaticChecks.reviewSession.disposition, 'checks-failed');
  assert.equal(failedStaticChecks.reviewSession.noModelTurn, true);
  assert.equal(modelTurns, 1);
  qualityConclusion = 'success';

  const changedEvidence = await runSemanticReview({
    repositoryRoot,
    review,
    eventPath,
    createClient: () => ({
      initialize: async () => {},
      capabilities: async () => ({ stop: false, usedPercent: 97, windows: [], guardSignals: { windowThresholdReached: false, rateLimitReached: false, spendControlReached: false } }),
      startThread: async () => ({ thread: { id: '219fb023-24b8-7881-9119-509f078b610e' } }),
      close: async () => {},
    }),
    runTurnImpl: async () => {
      modelTurns += 1;
      return { status: 'completed', text: JSON.stringify({
        status: 'aligned', summary: 'The changed evidence is aligned.', affectedAdrs: [], affectedContexts: [], findings: [], evidenceGaps: [],
      }) };
    },
  });
  assert.equal(changedEvidence.status, 'aligned');
  assert.equal(changedEvidence.reviewSession.disposition, 'completed');
  assert.equal(modelTurns, 2);

  const preflight = JSON.parse(await readFile(preflightPath, 'utf8'));
  preflight.codexCliVersion = '0.159.4';
  await writeFile(preflightPath, `${JSON.stringify(preflight, null, 2)}\n`);
  const interrupted = await runSemanticReview({
    repositoryRoot,
    review,
    eventPath,
    createClient: () => ({
      initialize: async () => {},
      capabilities: async () => ({ stop: false, usedPercent: 97, windows: [], guardSignals: { windowThresholdReached: false, rateLimitReached: false, spendControlReached: false } }),
      startThread: async () => ({ thread: { id: '319fb023-24b8-7881-9119-509f078b610e' } }),
      close: async () => {},
    }),
    runTurnImpl: async () => ({ status: 'paused', reason: 'The quota boundary interrupted the review.' }),
  });
  assert.equal(interrupted.status, 'inconclusive');
  assert.equal(interrupted.reviewSession.disposition, 'interrupted');

  let resumedThread = false;
  const resumed = await runSemanticReview({
    repositoryRoot,
    review,
    eventPath,
    createClient: () => ({
      initialize: async () => {},
      capabilities: async () => ({ stop: false, usedPercent: 96, windows: [], guardSignals: { windowThresholdReached: false, rateLimitReached: false, spendControlReached: false } }),
      startThread: async () => { throw new Error('an interrupted review must resume its saved thread'); },
      resumeThread: async (_cwd, id) => { resumedThread = id === '319fb023-24b8-7881-9119-509f078b610e'; },
      close: async () => {},
    }),
    runTurnImpl: async ({ prompt }) => {
      assert.match(prompt, /Continue the interrupted read-only architecture review/);
      assert.doesNotMatch(prompt, /Compare verification statements/);
      modelTurns += 1;
      return { status: 'completed', text: JSON.stringify({
        status: 'aligned', summary: 'The resumed review is aligned.', affectedAdrs: [], affectedContexts: [], findings: [], evidenceGaps: [],
      }) };
    },
  });
  assert.equal(resumedThread, true);
  assert.equal(resumed.status, 'aligned');
  assert.equal(resumed.reviewSession.disposition, 'resumed');
  assert.equal(modelTurns, 3);
});

test('the evidence contract validates the complete projection and rejects mismatches', async () => {
  const { execFile } = await import('node:child_process');
  const { promisify } = await import('node:util');
  const { stdout } = await promisify(execFile)('git', ['-C', repositoryRoot, 'rev-parse', 'HEAD'], { encoding: 'utf8' });
  const revision = stdout.trim();
  const evidence = {
    schemaVersion: 1,
    producer: 'codex-delivery',
    repository: 'agentic-delivery-lab/agentic-delivery',
    sourceIssue: { number: 25, url: 'https://github.com/agentic-delivery-lab/agentic-delivery/issues/25' },
    deliveryRun: { id: '123', attempt: '1', url: 'https://github.com/agentic-delivery-lab/agentic-delivery/actions/runs/123' },
    revision: { branch: 'feat/issue-25-review', commit: revision, tree: revision },
    codexSession: { id: '019fb023-24b8-7881-9119-509f078b610e' },
    modelTurns: [{ phase: 'plan', model: 'gpt-6-sol', effort: 'high', mode: 'plan' }],
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
  assert.ok(schema.properties.modelTurns.items.properties.phase.enum.includes('refine'));
  assert.ok(schema.properties.modelTurns.items.properties.phase.enum.includes('implement'));
  assert.ok(schema.properties.modelTurns.items.properties.phase.enum.includes('review'));
});

test('the baseline report contains one required matrix row for every official ADR', async () => {
  const report = await readFile(path.join(repositoryRoot, 'docs/architecture/harness-conformance-review.md'), 'utf8');
  for (let number = 1; number <= 10; number += 1) assert.match(report, new RegExp(`\\| ADR-${String(number).padStart(4, '0')}\\b`));
  for (const field of ['Architectural invariant', 'Expected reflection', 'Repository evidence', 'Runtime/history evidence', 'Contradictory evidence', 'Missing evidence', 'Enforcement level', 'Confidence', 'Conformance', 'ADR action']) assert.match(report, new RegExp(field));
  assert.match(report, /agentic-delivery-governance/);
});

test('architecture-review workflow is pinned, read-only, resumable, and does not publish comments', async () => {
  const workflow = await readFile(path.join(repositoryRoot, '.github/workflows/harness-architecture-review.yml'), 'utf8');
  for (const phrase of ['pull_request:', 'contents: read', 'issues: read', 'pull-requests: read', 'actions: read', 'cancel-in-progress: true', 'CODEX_REVIEW_STATE_DIR: /var/lib/github-runner/.codex/harness-reviews', 'codex-cli-release-update:v1:', 'agentic-delivery-architecture', 'architecture-authority', '--architecture-root', '--architecture-commit', '--architecture-digest', '--semantic']) {
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
