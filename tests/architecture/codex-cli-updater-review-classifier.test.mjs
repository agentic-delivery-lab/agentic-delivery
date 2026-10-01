import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  classifyUpdaterReview,
  releaseTaskMatches,
  updaterReviewCandidate,
} from '../../scripts/classify-codex-cli-updater-review.mjs';

const repository = 'agentic-delivery-lab/agentic-delivery';
const version = '0.159.4';
const sha256 = 'a'.repeat(64);
const issueNumber = 742;

function graphQlIssueType(name = 'Task') {
  return { ok: true, json: async () => ({ data: { repository: { issue: { issueType: name ? { name } : null } } } }) };
}

function pullRequestEvent(overrides = {}) {
  const marker = `<!-- codex-cli-release-update:v1:${version} -->`;
  const sourceLine = `- Source issue: Closes #${issueNumber} — [Task: Update pinned Codex CLI to ${version}](https://github.com/${repository}/issues/${issueNumber})`;
  const releaseLine = `- Official release: [${version}](https://github.com/openai/codex/releases/tag/rust-v${version})`;
  const digestLine = `- Official Linux x64 asset SHA-256: \`${sha256}\``;
  const pullRequest = {
    state: 'open',
    user: { login: 'agentic-delivery-lab-invoker-7f3a[bot]' },
    base: { ref: 'main', repo: { full_name: repository } },
    head: {
      ref: `chore/issue-${issueNumber}-update-codex-cli-${version.replaceAll('.', '-')}`,
      repo: { full_name: repository },
    },
    title: `chore(delivery): 🔧 update pinned Codex CLI to ${version}`,
    body: `# Pull request\n\n${marker}\n\n## Source\n\n${sourceLine}\n\n## Evidence\n\n${releaseLine}\n${digestLine}\n`,
  };
  return {
    action: 'opened',
    repository: { full_name: repository },
    pull_request: { ...pullRequest, ...overrides },
  };
}

function releaseTask(overrides = {}) {
  return {
    number: issueNumber,
    state: 'open',
    title: `Task: Update pinned Codex CLI to ${version}`,
    html_url: `https://github.com/${repository}/issues/${issueNumber}`,
    body: [
      `<!-- codex-cli-release-update:v1:${version} -->`,
      '',
      '## Requested outcome',
      '',
      `Promote Codex CLI ${version} to the central Actions runner pin.`,
      '',
      '## Related work',
      '',
      `- Official Codex release: [${version}](https://github.com/openai/codex/releases/tag/rust-v${version}).`,
      `- Verified Linux x64 asset SHA-256: \`${sha256}\`.`,
    ].join('\n'),
    ...overrides,
  };
}

test('suppresses only a registered updater PR whose native Task verifies the same release', async () => {
  const requestedUrls = [];
  const result = await classifyUpdaterReview({
    event: pullRequestEvent(),
    repository,
    token: 'test-token',
    fetchImpl: async (url, options) => {
      assert.equal(options.headers.Authorization, 'Bearer test-token');
      requestedUrls.push(String(url));
      if (String(url) === 'https://api.github.com/graphql') return graphQlIssueType();
      return { ok: true, json: async () => releaseTask() };
    },
  });

  assert.deepEqual(requestedUrls, [
    `https://api.github.com/repos/${repository}/issues/${issueNumber}`,
    'https://api.github.com/graphql',
  ]);
  assert.deepEqual(result, {
    suppressReview: true,
    reason: 'The registered updater PR and its linked release Task match the same version.',
  });
});

test('any PR identity, branch, title, marker, source-reference, or base mismatch runs normal review', async () => {
  const original = pullRequestEvent();
  const invalidEvents = [
    { ...original, pull_request: { ...original.pull_request, user: { login: 'other[bot]' } } },
    { ...original, pull_request: { ...original.pull_request, base: { ref: 'release', repo: { full_name: repository } } } },
    { ...original, pull_request: { ...original.pull_request, head: { ...original.pull_request.head, ref: `chore/issue-${issueNumber}-update-codex-cli-0-159-5` } } },
    { ...original, pull_request: { ...original.pull_request, title: `chore(delivery): 🔧 update pinned Codex CLI to 0.159.5` } },
    { ...original, pull_request: { ...original.pull_request, body: original.pull_request.body.replace(version, '0.159.5') } },
    { ...original, pull_request: { ...original.pull_request, body: original.pull_request.body.replace(`#${issueNumber}`, '#743') } },
    { ...original, pull_request: { ...original.pull_request, body: original.pull_request.body.replace(sha256, 'b'.repeat(64)) } },
    { ...original, pull_request: { ...original.pull_request, body: original.pull_request.body.replace('openai/codex/releases/tag/rust-v0.159.4', 'openai/codex/releases/tag/rust-v0.159.5') } },
    { ...original, pull_request: { ...original.pull_request, head: { ...original.pull_request.head, repo: { full_name: 'someone/fork' } } } },
  ];
  let issueLookups = 0;

  for (const event of invalidEvents) {
    const result = await classifyUpdaterReview({
      event,
      repository,
      token: 'test-token',
      fetchImpl: async () => { issueLookups += 1; return { ok: true, json: async () => releaseTask() }; },
    });
    assert.equal(result.suppressReview, false);
  }
  // A structurally valid PR with a different digest still needs the linked
  // Task lookup before normal review can be selected.
  assert.equal(issueLookups, 2);
  assert.equal(updaterReviewCandidate({ event: { action: 'workflow_dispatch' }, repository }), null);
});

test('a source Task must match issue URL, exact title, state, release marker, release URL, and asset digest', async () => {
  const invalidIssues = [
    { ...releaseTask(), title: 'Task: Update pinned Codex CLI to 0.159.5' },
    { ...releaseTask(), state: 'closed' },
    { ...releaseTask(), html_url: 'https://github.com/another/repo/issues/742' },
    { ...releaseTask(), body: releaseTask().body.replace(version, '0.159.5') },
    { ...releaseTask(), body: releaseTask().body.replace('openai/codex/releases/tag/rust-v0.159.4', 'openai/codex/releases/tag/rust-v0.159.5') },
    { ...releaseTask(), body: releaseTask().body.replace(sha256, 'b'.repeat(64)) },
    { ...releaseTask(), body: releaseTask().body.replace(`- Verified Linux x64 asset SHA-256: \`${sha256}\`.`, '') },
    { ...releaseTask(), pull_request: { url: 'https://api.github.com/repos/agentic-delivery-lab/agentic-delivery/pulls/742' } },
  ];
  for (const issue of invalidIssues) {
    assert.equal(releaseTaskMatches({ issue, nativeIssueType: 'Task', issueNumber, repository, version, sha256 }), false);
    const result = await classifyUpdaterReview({
      event: pullRequestEvent(),
      repository,
      token: 'test-token',
      fetchImpl: async (url) => String(url) === 'https://api.github.com/graphql'
        ? graphQlIssueType()
        : ({ ok: true, json: async () => issue }),
    });
    assert.equal(result.suppressReview, false);
  }
  assert.equal(releaseTaskMatches({ issue: releaseTask(), nativeIssueType: null, issueNumber, repository, version, sha256 }), false);
});

test('a same-looking release issue without native Task type does not suppress semantic review', async () => {
  const result = await classifyUpdaterReview({
    event: pullRequestEvent(),
    repository,
    token: 'test-token',
    fetchImpl: async (url) => String(url) === 'https://api.github.com/graphql'
      ? graphQlIssueType(null)
      : ({ ok: true, json: async () => releaseTask() }),
  });
  assert.equal(result.suppressReview, false);
});

test('missing or unavailable issue evidence fails open to ordinary Harness review', async () => {
  const unavailable = await classifyUpdaterReview({
    event: pullRequestEvent(),
    repository,
    token: 'test-token',
    fetchImpl: async () => ({ ok: false, status: 403 }),
  });
  const networkError = await classifyUpdaterReview({
    event: pullRequestEvent(),
    repository,
    token: 'test-token',
    fetchImpl: async () => { throw new Error('unavailable'); },
  });
  assert.equal(unavailable.suppressReview, false);
  assert.equal(networkError.suppressReview, false);
});
