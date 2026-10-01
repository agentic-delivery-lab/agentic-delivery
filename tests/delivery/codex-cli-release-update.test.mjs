import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

import {
  checkedRelease,
  adrQualityWorkflowAppliesToFiles,
  listCheckRuns,
  listPullRequests,
  reviewCheckReadiness,
  resolveClosedUpdateIssueStates,
  resolveSourceIssue,
  selectPendingUpdatePullRequest,
  verifyDownload,
} from '../../scripts/codex-cli-release-update.mjs';
import { RELEASE } from '../../scripts/setup-runner-codex.mjs';

const repository = 'agentic-delivery-lab/agentic-delivery';
const assetName = 'codex-package-x86_64-unknown-linux-musl.tar.gz';

function nextPatchVersion(version) {
  const [major, minor, patch] = version.split('.').map(Number);
  return `${major}.${minor}.${patch + 1}`;
}

function release(version, { prerelease = false, digest = 'a'.repeat(64), size = 1024 } = {}) {
  const tag = `rust-v${version}`;
  return {
    tag_name: tag,
    draft: false,
    prerelease,
    assets: [{
      name: assetName,
      browser_download_url: `https://github.com/openai/codex/releases/download/${tag}/${assetName}`,
      digest: `sha256:${digest}`,
      size,
    }],
  };
}

test('selects only a newer stable release with the official Linux asset digest', () => {
  const candidate = checkedRelease(release(nextPatchVersion(RELEASE.version)), RELEASE.version);
  assert.equal(candidate.version, nextPatchVersion(RELEASE.version));
  assert.equal(candidate.sha256, 'a'.repeat(64));
  assert.equal(checkedRelease(release(RELEASE.version), RELEASE.version), null);
  assert.throws(() => checkedRelease(release(nextPatchVersion(RELEASE.version), { prerelease: true }), RELEASE.version), /stable published release/);
});

test('verifies the downloaded archive bytes against the official digest and size', async () => {
  const bytes = Buffer.from('pinned Codex CLI artifact');
  const candidate = checkedRelease(release(nextPatchVersion(RELEASE.version), {
    digest: createHash('sha256').update(bytes).digest('hex'),
    size: bytes.length,
  }), RELEASE.version);
  const response = {
    ok: true,
    url: candidate.url,
    arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
  };
  await verifyDownload(candidate, async () => response);
  await assert.rejects(verifyDownload({ ...candidate, sha256: 'b'.repeat(64) }, async () => response), /official SHA-256 digest/);
});

test('reuses one open update pull request and blocks unresolved duplicate decisions', () => {
  const version = nextPatchVersion(RELEASE.version);
  const branch = `chore/issue-742-update-codex-cli-${version.replaceAll('.', '-')}`;
  const pullRequest = {
    number: 815,
    state: 'open',
    base: { ref: 'main', repo: { full_name: repository } },
    head: { ref: branch, sha: 'a'.repeat(40), repo: { full_name: repository } },
  };
  const selected = selectPendingUpdatePullRequest([pullRequest], repository, version.replaceAll('.', '-'));
  assert.equal(selected.pullRequest.number, 815);
  assert.equal(selected.issueNumber, '742');
  assert.equal(selected.sameCandidate, true);
  assert.equal(selectPendingUpdatePullRequest([pullRequest], repository, '9-9-9').sameCandidate, false);
  assert.equal(selectPendingUpdatePullRequest([], repository, '9-9-9'), null);
  assert.throws(() => selectPendingUpdatePullRequest([pullRequest, { ...pullRequest, number: 816 }], repository, '9-9-9'), /More than one open/);
  assert.throws(() => selectPendingUpdatePullRequest([{ ...pullRequest, state: 'closed', merged_at: null }], repository, version.replaceAll('.', '-')), /verified release source issue/);
});

test('paginates repository pull requests before deciding whether an update is pending', async () => {
  const version = nextPatchVersion(RELEASE.version);
  const updatePullRequest = {
    number: 815,
    state: 'open',
    base: { ref: 'main', repo: { full_name: repository } },
    head: {
      ref: `chore/issue-742-update-codex-cli-${version.replaceAll('.', '-')}`,
      repo: { full_name: repository },
    },
  };
  const requestedPages = [];
  const pullRequests = await listPullRequests(repository, 'test-token', async (url) => {
    const page = Number(new URL(String(url)).searchParams.get('page'));
    requestedPages.push(page);
    assert.equal(new URL(String(url)).searchParams.get('sort'), 'created');
    assert.equal(new URL(String(url)).searchParams.get('direction'), 'asc');
    return {
      ok: true,
      json: async () => page === 1
        ? Array.from({ length: 100 }, (_, index) => ({ number: index + 1, state: 'closed', head: { ref: 'feature/unrelated' } }))
        : [updatePullRequest],
    };
  });
  const pending = selectPendingUpdatePullRequest(pullRequests, repository, '9-9-9');
  assert.deepEqual(requestedPages, [1, 2]);
  assert.equal(pending.pullRequest.number, 815);
  assert.equal(pending.sameCandidate, false);
});

test('a closed release Task resolves its old PR without blocking later releases', async () => {
  const version = nextPatchVersion(RELEASE.version);
  const issueNumber = 742;
  const closedPullRequest = {
    number: 815,
    state: 'closed',
    merged_at: null,
    base: { ref: 'main', repo: { full_name: repository } },
    head: { ref: `chore/issue-${issueNumber}-update-codex-cli-${version.replaceAll('.', '-')}`, repo: { full_name: repository } },
  };
  let state = 'closed';
  const fetchImpl = async (url) => {
    assert.equal(String(url), `https://api.github.com/repos/${repository}/issues/${issueNumber}`);
    return {
      ok: true,
      json: async () => ({
        number: issueNumber,
        title: `Task: Update pinned Codex CLI to ${version}`,
        body: `<!-- codex-cli-release-update:v1:${version} -->\nRelease task`,
        state,
        html_url: `https://github.com/${repository}/issues/${issueNumber}`,
      }),
    };
  };
  const closedStates = await resolveClosedUpdateIssueStates([closedPullRequest], repository, 'test-token', fetchImpl);
  assert.deepEqual(closedStates.get(issueNumber), { state: 'closed', version });
  assert.equal(selectPendingUpdatePullRequest([closedPullRequest], repository, version.replaceAll('.', '-'), closedStates).rejectedCandidate, true);
  assert.equal(selectPendingUpdatePullRequest([closedPullRequest], repository, nextPatchVersion(version).replaceAll('.', '-'), closedStates), null);

  state = 'open';
  const openStates = await resolveClosedUpdateIssueStates([closedPullRequest], repository, 'test-token', fetchImpl);
  assert.throws(() => selectPendingUpdatePullRequest([closedPullRequest], repository, nextPatchVersion(version).replaceAll('.', '-'), openStates), /source issue #742 remains open/);
  await assert.rejects(resolveClosedUpdateIssueStates([closedPullRequest], repository, '', fetchImpl), /GH_TOKEN/);
});

test('semantic review readiness requires exact-head deterministic checks and ignores its own check run', () => {
  const sha = 'a'.repeat(40);
  const names = [
    'Validate pull request body',
    'quality',
    'portability (ubuntu-latest)',
    'portability (macos-latest)',
    'portability (windows-latest)',
  ];
  const checkRuns = names.map((name, index) => ({
    name, id: index + 1, head_sha: sha, status: 'completed', conclusion: 'success',
    started_at: '2026-10-01T12:00:00Z', app: { name: 'GitHub Actions' },
  }));
  checkRuns.push({ name: 'review', head_sha: sha, status: 'in_progress', app: { name: 'GitHub Actions' } });
  assert.equal(reviewCheckReadiness(checkRuns, sha).ready, true);
  assert.deepEqual(reviewCheckReadiness(checkRuns, sha, true).missing, ['validate']);
  assert.deepEqual(reviewCheckReadiness(checkRuns.map((run) => ({ ...run, head_sha: 'b'.repeat(40) })), sha).missing, names);
  const failed = checkRuns.map((run) => run.name === 'quality' ? { ...run, conclusion: 'failure' } : run);
  assert.deepEqual(reviewCheckReadiness(failed, sha).failed, ['quality']);
});

test('requires ADR validation whenever changed files trigger the ADR-quality workflow', () => {
  for (const file of [
    'CHANGELOG.md',
    '.github/workflows/adr-quality.yml',
    'docs/delivery/codex-workflow.md',
    'docs/decisions/0011-example.md',
    'scripts/codex-cli-release-update.mjs',
    'tests/domain/validate-domain-language.test.mjs',
  ]) assert.equal(adrQualityWorkflowAppliesToFiles([file]), true, file);
  for (const file of ['README.md', 'src/app.ts', 'docs/other.md', 'scripts/example.txt']) {
    assert.equal(adrQualityWorkflowAppliesToFiles([file]), false, file);
  }
});

test('paginates all exact-head check runs before declaring deterministic checks ready', async () => {
  const sha = 'a'.repeat(40);
  const names = [
    'Validate pull request body',
    'quality',
    'portability (ubuntu-latest)',
    'portability (macos-latest)',
    'portability (windows-latest)',
    'validate',
  ];
  const baseUrl = `https://api.github.com/repos/${repository}/commits/${sha}/check-runs?filter=latest`;
  const requestedPages = [];
  const evidence = await listCheckRuns(baseUrl, 'test-token', async (url) => {
    const page = Number(new URL(String(url)).searchParams.get('page'));
    requestedPages.push(page);
    const unrelated = Array.from({ length: 100 }, (_, index) => ({
      id: index + 1, name: `unrelated-${index}`, head_sha: sha, status: 'completed',
      conclusion: 'success', app: { name: 'GitHub Actions' },
    }));
    const required = names.map((name, index) => ({
      id: 101 + index, name, head_sha: sha, status: 'completed', conclusion: 'success',
      started_at: '2026-10-01T12:00:00Z', app: { name: 'GitHub Actions' },
    }));
    return {
      ok: true,
      json: async () => ({ total_count: 106, check_runs: page === 1 ? unrelated : required }),
    };
  });
  assert.deepEqual(requestedPages, [1, 2]);
  assert.equal(evidence.complete, true);
  assert.equal(evidence.checkRuns.length, 106);
  assert.equal(reviewCheckReadiness(evidence.checkRuns, sha, true).ready, true);
});

test('does not treat a short paginated check-run response as complete evidence', async () => {
  const sha = 'a'.repeat(40);
  const evidence = await listCheckRuns(
    `https://api.github.com/repos/${repository}/commits/${sha}/check-runs?filter=latest`,
    'test-token',
    async (url) => {
      const page = Number(new URL(String(url)).searchParams.get('page'));
      return {
        ok: true,
        json: async () => ({
          total_count: 101,
          check_runs: page === 1
            ? Array.from({ length: 100 }, (_, index) => ({ id: index + 1, name: `run-${index}` }))
            : [],
        }),
      };
    },
  );
  assert.equal(evidence.complete, false);
  assert.deepEqual(evidence.checkRuns, []);
});

test('reuses a matching open release issue and creates a typed task when no issue exists', async () => {
  const version = nextPatchVersion(RELEASE.version);
  const candidate = checkedRelease(release(version), RELEASE.version);
  const title = `Task: Update pinned Codex CLI to ${version}`;
  const marker = `<!-- codex-cli-release-update:v1:${version} -->`;
  let createCount = 0;
  const fetchImpl = async (url) => {
    assert.match(String(url), /search\/issues\?/);
    return {
      ok: true,
      json: async () => ({ total_count: 1, incomplete_results: false, items: [{
        number: 742,
        title,
        body: `${marker}\nRelease task`,
        state: 'open',
        html_url: `https://github.com/${repository}/issues/742`,
      }] }),
    };
  };
  const reused = await resolveSourceIssue({ candidate, repository, token: 'test-token', fetchImpl, createIssue: async () => { createCount += 1; } });
  assert.deepEqual(reused, { number: 742, url: `https://github.com/${repository}/issues/742`, title, created: false });
  assert.equal(createCount, 0);

  await assert.rejects(resolveSourceIssue({
    candidate,
    repository,
    token: 'test-token',
    fetchImpl: async () => ({ ok: true, json: async () => ({ total_count: 1, incomplete_results: false, items: [{
      number: 741,
      title: `Task: Update pinned Codex CLI to ${RELEASE.version}`,
      body: `<!-- codex-cli-release-update:v1:${RELEASE.version} -->`,
      state: 'open',
      html_url: `https://github.com/${repository}/issues/741`,
    }] }) }),
    createIssue: async () => { createCount += 1; },
  }), /resolve it before starting/);
  assert.equal(createCount, 0);

  const created = await resolveSourceIssue({
    candidate,
    repository,
    token: 'test-token',
    fetchImpl: async () => ({ ok: true, json: async () => ({ total_count: 0, incomplete_results: false, items: [] }) }),
    createIssue: async ({ issueTitle, issueBody }) => {
      createCount += 1;
      assert.equal(issueTitle, title);
      assert.ok(issueBody.includes(marker));
      return { number: 743, url: `https://github.com/${repository}/issues/743` };
    },
  });
  assert.deepEqual(created, { number: 743, url: `https://github.com/${repository}/issues/743`, title, created: true });
  assert.equal(createCount, 1);
});

test('release source issue discovery paginates and fails closed on incomplete or capped search results', async () => {
  const version = nextPatchVersion(RELEASE.version);
  const candidate = checkedRelease(release(version), RELEASE.version);
  const title = `Task: Update pinned Codex CLI to ${version}`;
  const marker = `<!-- codex-cli-release-update:v1:${version} -->`;
  const pages = [];
  const fetchImpl = async (url) => {
    const page = Number(new URL(String(url)).searchParams.get('page'));
    pages.push(page);
    const items = page === 1
      ? Array.from({ length: 100 }, (_, index) => ({
        number: index + 1,
        title: 'Task: An unrelated task',
        body: 'No Codex release marker',
        state: 'open',
      }))
      : [{
        number: 742,
        title,
        body: `${marker}\nRelease task`,
        state: 'open',
        html_url: `https://github.com/${repository}/issues/742`,
      }];
    return { ok: true, json: async () => ({ total_count: 101, incomplete_results: false, items }) };
  };

  const reused = await resolveSourceIssue({ candidate, repository, token: 'test-token', fetchImpl });
  assert.deepEqual(reused, { number: 742, url: `https://github.com/${repository}/issues/742`, title, created: false });
  assert.deepEqual(pages, [1, 2]);

  const createIssue = async () => { throw new Error('A source issue must not be created from incomplete search evidence.'); };
  await assert.rejects(resolveSourceIssue({
    candidate,
    repository,
    token: 'test-token',
    fetchImpl: async () => ({ ok: true, json: async () => ({ total_count: 1, incomplete_results: true, items: [] }) }),
    createIssue,
  }), /incomplete results/);
  await assert.rejects(resolveSourceIssue({
    candidate,
    repository,
    token: 'test-token',
    fetchImpl: async () => ({ ok: true, json: async () => ({ total_count: 101, incomplete_results: false, items: [{ number: 1 }] }) }),
    createIssue,
  }), /fewer results than its total_count/);
  await assert.rejects(resolveSourceIssue({
    candidate,
    repository,
    token: 'test-token',
    fetchImpl: async () => ({ ok: true, json: async () => ({ total_count: 1001, incomplete_results: false, items: [] }) }),
    createIssue,
  }), /beyond the Search API limit/);
});

test('the updater uses a restricted App token for PR events and dispatches runner review after smoke', async () => {
  const workflow = await readFile(new URL('../../.github/workflows/codex-cli-release-update.yml', import.meta.url), 'utf8');
  assert.match(workflow, /issues:\s*write/);
  assert.match(workflow, /actions\/create-github-app-token@[a-f0-9]{40} # v3/);
  assert.match(workflow, /permission-contents: read/);
  assert.match(workflow, /permission-pull-requests: write/);
  assert.match(workflow, /pull-requests: read/);
  assert.match(workflow, /checks: read/);
  assert.match(workflow, /--ensure-source-issue/);
  assert.match(workflow, /CODEX_RELEASE_SLUG: \$\{\{ steps\.release\.outputs\.slug \}\}/);
  assert.match(workflow, /CODEX_VERSION: \$\{\{ steps\.release\.outputs\.version \}\}/);
  assert.match(workflow, /PR_TITLE: "chore\(delivery\): 🔧 update pinned Codex CLI to \$\{\{ steps\.release\.outputs\.version \}\}"/);
  assert.match(workflow, /pnpm branch:start chore "\$SOURCE_ISSUE"/);
  assert.match(workflow, /Source issue: Closes #\$PR_SOURCE_ISSUE/);
  assert.match(workflow, /Ongoing policy: Refs #70/);
  assert.match(workflow, /pull-request-body\.yml --repo "\$GITHUB_REPOSITORY" --ref "\$PR_BRANCH"/);
  assert.match(workflow, /<!-- codex-cli-release-update:v1:\$CODEX_VERSION -->/);
  assert.match(workflow, /Harness semantic review starts only after that smoke passes/);
  assert.match(workflow, /Wait for exact-head deterministic checks/);
  assert.match(workflow, /steps\.static\.outputs\.checks_ready == 'true'/);
  assert.doesNotMatch(workflow, /Repository Actions setting must permit this workflow token/);
  assert.doesNotMatch(workflow, /branch:start chore 70/);
});
