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
import { parseSemanticOutcome, projectQuotaDiagnostics, runSemanticReview } from '../../scripts/lib/architecture-review-agent.mjs';
import { QUOTA_DIAGNOSTICS_SCHEMA_VERSION, supportsQuotaDiagnosticsSchemaVersion } from '../../scripts/lib/quota-diagnostics.mjs';
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

test('semantic output is redacted, bounded, and rendered as plain Markdown text', () => {
  const unsafe = parseSemanticOutcome(JSON.stringify({
    status: 'findings',
    summary: '## Injected heading\n- fake item\n"access_token":\n  "fixture secret with spaces"\npassword:\n  fixture multiline secret\ntoken: >-\n  fixture block secret value',
    affectedAdrs: ['ADR-0009'],
    affectedContexts: ['agentic-delivery-governance'],
    findings: [{
      category: 'security',
      severity: 'concern',
      statement: '<img src=x onerror=alert(1)> Bearer abcdefghijklmnopqrstuvwxyz',
      evidence: ['docs/example.md:12'],
      recommendedAction: 'Remove the unsafe rendering path.',
    }],
    evidenceGaps: ['Authorization: Bearer abcdefghijklmnopqrstuvwxyz'],
    unmodeled: 'extra model content must not reach the report',
  }));
  assert.equal(unsafe.status, 'findings');
  assert.equal(Object.hasOwn(unsafe, 'unmodeled'), false);
  assert.doesNotMatch(JSON.stringify(unsafe), /fixture secret with spaces|fixture block secret value|abcdefghijklmnopqrstuvwxyz/);
  assert.match(unsafe.summary, /access_token"?:[\s\S]{0,30}\[redacted\]/);

  const markdown = formatReviewMarkdown({
    status: 'pass', base: 'base', head: 'head', affectedAdrs: [], affectedContexts: [], checks: [], semantic: unsafe,
  });
  assert.doesNotMatch(markdown, /^## Injected heading/m);
  assert.doesNotMatch(markdown, /\n- fake item/);
  assert.doesNotMatch(markdown, /<img/i);
  assert.match(markdown, /&lt;img/);
  assert.doesNotMatch(markdown, /abcdefghijklmnopqrstuvwxyz|fixture secret with spaces/);

  const listInjection = parseSemanticOutcome(JSON.stringify({
    status: 'aligned', summary: '- fabricated reviewer finding', affectedAdrs: [], affectedContexts: [], findings: [], evidenceGaps: [],
  }));
  const listMarkdown = formatReviewMarkdown({
    status: 'pass', base: 'base', head: 'head', affectedAdrs: [], affectedContexts: [], checks: [], semantic: listInjection,
  });
  assert.doesNotMatch(listMarkdown, /\n- fabricated reviewer finding/);
  assert.match(listMarkdown, /\\- fabricated reviewer finding/);

  const oversized = parseSemanticOutcome(JSON.stringify({
    status: 'aligned', summary: 'A'.repeat(4_001), affectedAdrs: [], affectedContexts: [], findings: [], evidenceGaps: [],
  }));
  assert.equal(oversized.status, 'inconclusive');
});

test('quota diagnostics schema documents the internal SemVer projection', async () => {
  const schema = JSON.parse(await readFile(path.join(repositoryRoot, 'docs/architecture/quota-diagnostics.schema.json'), 'utf8'));
  const projected = projectQuotaDiagnostics({
    reasonCode: 'credit_spillover',
    diagnostics: {
      reasonCode: 'credit_spillover',
      triggerReasons: ['credit_spillover', 'missing_or_invalid_window', 'window_reserve', 'server_rate_limit', 'spend_control'],
      windows: [
        { bucket: 'bucket-1', slot: 'primary', usedPercent: 99, windowDurationMins: 300, resetsAt: 1_800_000_100, valid: true },
        { bucket: 'bucket-2', slot: 'secondary', usedPercent: null, windowDurationMins: null, resetsAt: null, valid: false },
      ],
      triggeringWindows: [{ bucket: 'bucket-1', slot: 'primary', usedPercent: 99, windowDurationMins: 300, resetsAt: 1_800_000_100, valid: true }],
      serverBlocks: [{ bucket: 'bucket-1', rateLimitReached: true, spendControlReached: true }],
      nextEligibleAt: null,
    },
  }, 'active_turn');

  assert.deepEqual(schema.required, Object.keys(projected));
  assert.deepEqual(Object.keys(projected), Object.keys(schema.properties));
  assert.equal(schema.additionalProperties, true);
  assert.equal(schema.$defs.window.additionalProperties, true);
  assert.equal(schema.$defs.serverBlock.additionalProperties, true);
  assert.match(schema.$id, /quota-diagnostics\.schema\.json$/);
  assert.match(schema.description, /not a participant contract/);
  assert.equal(schema.properties.triggerReasons.maxItems, 9);
  assert.equal(schema.properties.windows.maxItems, 64);
  assert.equal(schema.properties.triggeringWindows.maxItems, 32);
  assert.equal(schema.properties.serverBlocks.maxItems, 32);
  assert.equal(schema.properties.truncated.type, 'boolean');
  const schemaVersionPattern = new RegExp(schema.properties.schemaVersion.pattern);
  assert.equal(schemaVersionPattern.test('1.2.3-beta.1+build.6'), true);
  assert.equal(schemaVersionPattern.test('1.1.0'), true);
  assert.equal(schemaVersionPattern.test('1.2.3-01'), false);
  const futureMinorPayload = { ...projected, schemaVersion: '1.1.0', optionalFutureField: true };
  assert.equal(schemaVersionPattern.test(futureMinorPayload.schemaVersion), true);
  assert.equal(schema.additionalProperties, true, 'minor-version optional fields are permitted');
  assert.deepEqual(projected.triggerReasons, ['credit_spillover', 'missing_or_invalid_window', 'window_reserve', 'server_rate_limit', 'spend_control']);
  assert.equal(projected.triggeringWindows.some((window) => !window.valid), true);
  assert.equal(projected.truncated, false);
  assert.equal(supportsQuotaDiagnosticsSchemaVersion(projected.schemaVersion), true);
  assert.equal(supportsQuotaDiagnosticsSchemaVersion('2.0.0'), false);
});

test('semantic execution reports quota and structured findings without becoming deterministic proof', async (t) => {
  const revision = (await (async () => {
    const { execFile } = await import('node:child_process');
    const { promisify } = await import('node:util');
    const { stdout } = await promisify(execFile)('git', ['-C', repositoryRoot, 'rev-parse', 'HEAD'], { encoding: 'utf8' });
    return stdout.trim();
  })());
  const review = await deterministicReview({ repositoryRoot, base: revision, head: revision });
  const eventDirectory = await mkdtemp(path.join(os.tmpdir(), 'agentic-delivery-review-event-'));
  t.after(() => rm(eventDirectory, { recursive: true, force: true }));
  const eventPath = path.join(eventDirectory, 'event.json');
  const currentPullRequestBody = `## Plan\nKeep the review read-only.\n\nAuthorization=fixture-secret\n\n<!-- codex-delivery-evidence:v1\n{\n  "access_token":\n    "fixture marker secret with spaces"\n}\n-->\n${'x'.repeat(10_050)}`;
  await writeFile(eventPath, JSON.stringify({
    repository: { full_name: 'agentic-delivery-lab/agentic-delivery' },
    pull_request: {
      number: 25,
      title: 'stale event title',
      body: 'stale event body',
    },
  }));
  const previousGithubToken = process.env.GH_TOKEN;
  process.env.GH_TOKEN = 'fixture-github-token';
  t.after(() => {
    if (previousGithubToken === undefined) delete process.env.GH_TOKEN;
    else process.env.GH_TOKEN = previousGithubToken;
  });
  const unavailable = await runSemanticReview({
    repositoryRoot,
    review,
    createClient: () => ({ initialize: async () => {}, capabilities: async () => { throw new Error('quota'); }, close: async () => {} }),
  });
  assert.equal(unavailable.status, 'inconclusive');
  let bundlePath;
  let bundleText = '';
  const findings = await runSemanticReview({
    repositoryRoot,
    review: { ...review, sourceIssue: { number: 68 } },
    eventPath,
    fetchImpl: async (url, options) => {
      assert.equal(options.headers.Authorization, 'Bearer fixture-github-token');
      assert.equal(options.headers.Accept, 'application/vnd.github+json');
      if (url === 'https://api.github.com/repos/agentic-delivery-lab/agentic-delivery/pulls/25') {
        return {
          ok: true,
          status: 200,
          json: async () => ({ number: 25, title: 'fix(review): preserve evidence', body: currentPullRequestBody }),
        };
      }
      if (url === 'https://api.github.com/repos/agentic-delivery-lab/agentic-delivery/issues/68') {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            number: 68,
            title: 'Clarify quota review evidence boundary',
            body: 'Source issue evidence.',
            state: 'open',
            labels: [{ name: 'adr:proposed' }],
          }),
        };
      }
      if (url === 'https://api.github.com/repos/agentic-delivery-lab/agentic-delivery/issues/68/comments?per_page=100') {
        return { ok: true, status: 200, json: async () => [] };
      }
      throw new Error(`Unexpected GitHub evidence URL: ${url}`);
    },
    createClient: ({ readableFiles }) => {
      [bundlePath] = readableFiles;
      return {
        initialize: async () => {}, capabilities: async () => ({}),
        startThread: async () => ({ thread: { id: '019fb023-24b8-7881-9119-509f078b610e' } }), close: async () => {},
      };
    },
    runTurnImpl: async () => {
      bundleText = await readFile(bundlePath, 'utf8');
      return { status: 'completed', text: JSON.stringify({
        status: 'findings', summary: 'A cited concern remains.', affectedAdrs: ['ADR-0009'], affectedContexts: ['agentic-delivery-governance'],
        findings: [{ category: 'observability', severity: 'advisory', statement: 'Runtime evidence is unavailable.', evidence: ['Safe runner-state summary'], recommendedAction: 'Record the gap.' }], evidenceGaps: [],
      }) };
    },
  });
  assert.equal(findings.status, 'findings');
  assert.equal(findings.findings[0].severity, 'advisory');
  const pullRequestDescription = bundleText.split('## Pull-request description\n\n')[1]?.split('\n\n## Pull-request evidence marker')[0];
  assert.ok(pullRequestDescription);
  const projectedDescription = JSON.parse(pullRequestDescription);
  assert.equal(projectedDescription.status, 'current');
  assert.equal(projectedDescription.title, 'fix(review): preserve evidence');
  assert.match(projectedDescription.body, /Keep the review read-only\./);
  assert.match(projectedDescription.body, /Authorization=\[redacted\]/);
  assert.equal(projectedDescription.body.length, 10_000);
  assert.equal(projectedDescription.bodyTruncated, true);
  assert.doesNotMatch(bundleText, /stale event title|stale event body/);
  const sourceIssueText = bundleText.split('## Source issue intent\n\n')[1]?.split('\n\n## Pull-request description')[0];
  assert.ok(sourceIssueText);
  const sourceIssueProjection = JSON.parse(sourceIssueText);
  assert.deepEqual(sourceIssueProjection.labels, ['adr:proposed']);
  assert.equal(sourceIssueProjection.body, 'Source issue evidence.');
  assert.doesNotMatch(bundleText, /fixture secret with spaces|fixture marker secret with spaces/);
  assert.match(bundleText, /Head internal quota diagnostics schema/);

  const quotaPaused = await runSemanticReview({
    repositoryRoot,
    review,
    createClient: () => ({
      initialize: async () => {}, capabilities: async () => ({}),
      startThread: async () => ({ thread: { id: '019fb023-24b8-7881-9119-509f078b610e' } }), close: async () => {},
    }),
    runTurnImpl: async () => ({
      status: 'paused', reason: 'Codex allowance reached the finalization reserve.', stopPhase: 'active_turn',
      budget: {
        reasonCode: 'window_reserve',
        diagnostics: {
          reasonCode: 'window_reserve',
          triggerReasons: ['window_reserve', 'server_rate_limit', 'access_token=fixture-secret'],
          windows: [
            { bucket: 'bucket-1', slot: 'primary', usedPercent: 99, windowDurationMins: 300, resetsAt: 1_800_000_100, valid: true },
            { bucket: 'access_token=fixture-secret', slot: 'secondary', usedPercent: 2, windowDurationMins: 10080, resetsAt: 1_800_000_100, valid: true },
          ],
          triggeringWindows: [{ bucket: 'bucket-1', slot: 'primary', usedPercent: 99, windowDurationMins: 300, resetsAt: 1_800_000_100, valid: true }],
          serverBlocks: [{ bucket: 'bucket-1', rateLimitReached: true, spendControlReached: false, providerMessage: 'fixture-secret' }],
          nextEligibleAt: 1_800_000_100,
          accountId: 'private-account-id',
        },
      },
    }),
  });
  assert.equal(quotaPaused.status, 'inconclusive');
  assert.deepEqual(quotaPaused.quotaDiagnostics, {
    schemaVersion: QUOTA_DIAGNOSTICS_SCHEMA_VERSION,
    reasonCode: 'window_reserve',
    stopPhase: 'active_turn',
    triggerReasons: ['window_reserve', 'server_rate_limit'],
    windows: [{ bucket: 'bucket-1', slot: 'primary', usedPercent: 99, windowDurationMins: 300, resetsAt: 1_800_000_100, valid: true }],
    triggeringWindows: [{ bucket: 'bucket-1', slot: 'primary', usedPercent: 99, windowDurationMins: 300, resetsAt: 1_800_000_100, valid: true }],
    serverBlocks: [{ bucket: 'bucket-1', rateLimitReached: true, spendControlReached: false }],
    truncated: true,
    nextEligibleAt: 1_800_000_100,
  });
  assert.doesNotMatch(JSON.stringify(quotaPaused), /fixture-secret|private-account-id|providerMessage/);

  const nonQuotaPause = await runSemanticReview({
    repositoryRoot,
    review,
    createClient: () => ({
      initialize: async () => {}, capabilities: async () => ({}),
      startThread: async () => ({ thread: { id: '019fb023-24b8-7881-9119-509f078b610e' } }), close: async () => {},
    }),
    runTurnImpl: async () => ({ status: 'paused', reason: 'password:\n  fixture paused secret value' }),
  });
  assert.equal(nonQuotaPause.status, 'inconclusive');
  assert.doesNotMatch(JSON.stringify(nonQuotaPause), /fixture paused secret value/);
  assert.match(nonQuotaPause.evidenceGaps[0], /password:[\s\S]*\[redacted\]/);

  const markdown = formatReviewMarkdown({ ...review, semantic: quotaPaused });
  assert.match(markdown, /#### Quota diagnostics/);
  assert.match(markdown, /Stop phase: active turn/);
  assert.match(markdown, /99% of the 300-minute window/);
  assert.match(markdown, /2027-01-15T08:01:40\.000Z/);
  assert.doesNotMatch(markdown, /fixture-secret|private-account-id/);

  let startedThread = false;
  let startedTurn = false;
  const preflight = await runSemanticReview({
    repositoryRoot,
    review,
    createClient: () => ({
      initialize: async () => {},
      capabilities: async () => ({
        stop: true,
        reasonCode: 'telemetry_unavailable',
        diagnostics: {
          reasonCode: 'telemetry_unavailable', triggerReasons: ['telemetry_unavailable'],
          windows: [], triggeringWindows: [], serverBlocks: [], nextEligibleAt: null,
        },
      }),
      startThread: async () => { startedThread = true; throw new Error('must not start'); },
      close: async () => {},
    }),
    runTurnImpl: async () => { startedTurn = true; throw new Error('must not start'); },
  });
  assert.equal(preflight.status, 'inconclusive');
  assert.equal(preflight.quotaDiagnostics.stopPhase, 'preflight');
  assert.equal(preflight.quotaDiagnostics.reasonCode, 'telemetry_unavailable');
  assert.equal(startedThread, false);
  assert.equal(startedTurn, false);
});

test('quota diagnostic projection and formatting cover each independent stop reason', () => {
  const cases = [
    ['invalid_bucket', { windows: [{ bucket: 'bucket-1', slot: 'secondary', usedPercent: null, windowDurationMins: null, resetsAt: null, valid: false }] }, /invalid bucket/],
    ['credit_spillover', { windows: [], serverBlocks: [] }, /spendable credits are available/],
    ['unlimited_credits', { windows: [], serverBlocks: [] }, /unlimited credits are available/],
    ['credit_telemetry_unavailable', { windows: [], serverBlocks: [] }, /credit telemetry was unavailable/],
    ['server_rate_limit', { triggerReasons: ['server_rate_limit'], serverBlocks: [{ bucket: 'bucket-1', rateLimitReached: true, spendControlReached: false }] }, /server rate-limit flag set/],
    ['spend_control', { triggerReasons: ['spend_control'], serverBlocks: [{ bucket: 'bucket-1', rateLimitReached: false, spendControlReached: true }] }, /server spend-control flag set/],
  ];
  for (const [reasonCode, extra, expected] of cases) {
    const quotaDiagnostics = projectQuotaDiagnostics({
      reasonCode,
      diagnostics: {
        reasonCode,
        triggerReasons: [reasonCode],
        windows: [], triggeringWindows: [], serverBlocks: [], nextEligibleAt: null,
        ...extra,
      },
    }, 'preflight');
    assert.equal(quotaDiagnostics.reasonCode, reasonCode);
    assert.equal(quotaDiagnostics.schemaVersion, QUOTA_DIAGNOSTICS_SCHEMA_VERSION);
    assert.equal(quotaDiagnostics.stopPhase, 'preflight');
    const markdown = formatReviewMarkdown({
      status: 'pass', base: 'base', head: 'head', affectedAdrs: [], affectedContexts: [], checks: [],
      semantic: { status: 'inconclusive', summary: 'Review stopped.', findings: [], evidenceGaps: [], quotaDiagnostics },
    });
    assert.match(markdown, expected, reasonCode);
    assert.match(markdown, /Stop phase: preflight/);
  }
  const unsupported = formatReviewMarkdown({
    status: 'pass', base: 'base', head: 'head', affectedAdrs: [], affectedContexts: [], checks: [],
    semantic: {
      status: 'inconclusive', summary: 'Review stopped.', findings: [], evidenceGaps: [],
      quotaDiagnostics: { schemaVersion: '2.0.0', reasonCode: 'window_reserve' },
    },
  });
  assert.doesNotMatch(unsupported, /#### Quota diagnostics/, 'unknown diagnostic schema versions are not interpreted as v1');

  const compatibleUnknownCode = formatReviewMarkdown({
    status: 'pass', base: 'base', head: 'head', affectedAdrs: [], affectedContexts: [], checks: [],
    semantic: {
      status: 'inconclusive', summary: 'Review stopped.', findings: [], evidenceGaps: [],
      quotaDiagnostics: {
        schemaVersion: '1.2.0-beta.1+build.6', reasonCode: 'future_reason', stopPhase: 'preflight',
        triggerReasons: ['future_trigger', 'window_reserve'],
        windows: [{ bucket: 'bucket-1', slot: 'primary', usedPercent: 98, windowDurationMins: 300, valid: true }],
      },
    },
  });
  assert.match(compatibleUnknownCode, /Contract version: 1\.2\.0-beta\.1\+build\.6/);
  assert.match(compatibleUnknownCode, /Reason: unrecognized by this consumer/);
  assert.match(compatibleUnknownCode, /Trigger signals: 98% usage reserve/);
  assert.match(compatibleUnknownCode, /98% of the 300-minute window/);
  assert.doesNotMatch(compatibleUnknownCode, /future_reason|future_trigger/);
});

test('quota diagnostics cap bucket details, prioritize triggers, and mark omitted records', () => {
  const windows = Array.from({ length: 40 }, (_, index) => ({
    bucket: `bucket-${index + 1}`,
    slot: 'primary',
    usedPercent: index === 39 ? 99 : 20,
    windowDurationMins: 300,
    resetsAt: 1_800_000_100,
    valid: true,
  }));
  const serverBlocks = Array.from({ length: 40 }, (_, index) => ({
    bucket: `bucket-${index + 1}`,
    rateLimitReached: index === 39,
    spendControlReached: false,
  }));
  const quotaDiagnostics = projectQuotaDiagnostics({
    reasonCode: 'window_reserve',
    diagnostics: {
      reasonCode: 'window_reserve',
      triggerReasons: ['window_reserve', 'server_rate_limit'],
      windows,
      triggeringWindows: [windows[39]],
      serverBlocks,
      nextEligibleAt: null,
    },
  }, 'active_turn');

  assert.equal(quotaDiagnostics.windows.length, 33, 'all trigger windows plus 32 context windows are retained');
  assert.equal(quotaDiagnostics.windows.some((window) => window.bucket === 'bucket-40'), true);
  assert.equal(quotaDiagnostics.serverBlocks.length, 32, 'server-block output has an absolute limit');
  assert.equal(quotaDiagnostics.serverBlocks.some((block) => block.bucket === 'bucket-40' && block.rateLimitReached), true);
  assert.equal(quotaDiagnostics.truncated, true);
  const markdown = formatReviewMarkdown({
    status: 'pass', base: 'base', head: 'head', affectedAdrs: [], affectedContexts: [], checks: [],
    semantic: { status: 'inconclusive', summary: 'Review stopped.', findings: [], evidenceGaps: [], quotaDiagnostics },
  });
  assert.match(markdown, /Bucket 40 primary: 99% .*triggered the stop/);
  assert.match(markdown, /Bucket 40: server rate-limit flag set/);
  assert.match(markdown, /Some bucket details were omitted/);

  const manyTriggerWindows = Array.from({ length: 80 }, (_, index) => ({
    bucket: `bucket-${index + 1}`,
    slot: 'primary',
    usedPercent: 99,
    windowDurationMins: 300,
    resetsAt: 1_800_000_100,
    valid: true,
  }));
  const manyServerBlocks = manyTriggerWindows.map((window) => ({
    bucket: window.bucket,
    rateLimitReached: true,
    spendControlReached: false,
  }));
  const heavilyTruncated = projectQuotaDiagnostics({
    reasonCode: 'window_reserve',
    diagnostics: {
      reasonCode: 'window_reserve',
      triggerReasons: ['window_reserve', 'server_rate_limit'],
      windows: manyTriggerWindows,
      triggeringWindows: manyTriggerWindows,
      serverBlocks: manyServerBlocks,
      nextEligibleAt: null,
    },
  }, 'active_turn');
  assert.equal(heavilyTruncated.windows.length, 32);
  assert.equal(heavilyTruncated.triggeringWindows.length, 32);
  assert.equal(heavilyTruncated.serverBlocks.length, 32);
  assert.equal(heavilyTruncated.truncated, true);
  assert.deepEqual(heavilyTruncated.triggerReasons, ['window_reserve', 'server_rate_limit']);

  const invalidWindow = { ...windows[39], valid: false, usedPercent: null };
  const invalidQuotaDiagnostics = projectQuotaDiagnostics({
    reasonCode: 'missing_or_invalid_window',
    diagnostics: {
      reasonCode: 'missing_or_invalid_window',
      triggerReasons: [],
      windows: [...windows.slice(0, 39), invalidWindow],
      triggeringWindows: [],
      serverBlocks: [],
      nextEligibleAt: null,
    },
  }, 'preflight');
  assert.equal(invalidQuotaDiagnostics.triggeringWindows.some((window) => window.bucket === 'bucket-40'), true);
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

test('architecture-review workflow is pinned, read-only, and does not publish comments', async () => {
  const workflow = await readFile(path.join(repositoryRoot, '.github/workflows/harness-architecture-review.yml'), 'utf8');
  for (const phrase of ['pull_request:', 'contents: read', 'issues: read', 'pull-requests: read', 'actions: read', 'cancel-in-progress: true', 'agentic-delivery-architecture', 'architecture-authority', '--architecture-root', '--architecture-commit', '--architecture-digest', '--semantic']) {
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
