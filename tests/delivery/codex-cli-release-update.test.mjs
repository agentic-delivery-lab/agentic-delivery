import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

import {
  checkedRelease,
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

test('reuses only one open issue-linked CLI update pull request for the candidate', () => {
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
  assert.throws(() => selectPendingUpdatePullRequest([{ ...pullRequest, state: 'closed', merged_at: null }], repository, version.replaceAll('.', '-')), /closed without merging/);
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
      json: async () => ({ items: [{
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
    fetchImpl: async () => ({ ok: true, json: async () => ({ items: [{
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
    fetchImpl: async () => ({ ok: true, json: async () => ({ items: [] }) }),
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

test('the updater links release issues and dispatches the body check against the candidate branch', async () => {
  const workflow = await readFile(new URL('../../.github/workflows/codex-cli-release-update.yml', import.meta.url), 'utf8');
  assert.match(workflow, /issues:\s*write/);
  assert.match(workflow, /--ensure-source-issue/);
  assert.match(workflow, /pnpm branch:start chore "\$SOURCE_ISSUE"/);
  assert.match(workflow, /Source issue: Closes #\$PR_SOURCE_ISSUE/);
  assert.match(workflow, /Ongoing policy: Refs #70/);
  assert.match(workflow, /pull-request-body\.yml --repo "\$GITHUB_REPOSITORY" --ref "\$PR_BRANCH"/);
  assert.match(workflow, /At PR creation,[\s\S]*?results are pending/);
  assert.doesNotMatch(workflow, /branch:start chore 70/);
});
