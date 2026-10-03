// agentic-primitive: {"id":"codex-cli-release-updater","kind":"script","enforcement":"deterministic","adrs":["ADR-0009","ADR-0011"],"domains":["agentic-delivery-governance"]}
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { appendFile, readFile, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import {
  releaseTaskDetailsMatch,
  releaseTaskMatches,
  updaterReviewCandidate,
} from './classify-codex-cli-updater-review.mjs';
import {
  adrQualityWorkflowAppliesToFiles,
  reviewCheckReadiness,
  verifyReviewCheckRunProducers,
} from './lib/pull-request-check-readiness.mjs';
import { getNativeIssueType } from './lib/github-native-issue-type.mjs';
import { packageTreeSha256FromArchive, RELEASE } from './setup-runner-codex.mjs';

export { adrQualityWorkflowAppliesToFiles, reviewCheckReadiness } from './lib/pull-request-check-readiness.mjs';

const execFileAsync = promisify(execFile);
const API_URL = 'https://api.github.com/repos/openai/codex/releases/latest';
const ASSET_NAME = 'codex-package-x86_64-unknown-linux-musl.tar.gz';
const MAX_ASSET_BYTES = 256 * 1024 * 1024;
const GITHUB_PAGE_SIZE = 100;
const MAX_GITHUB_API_PAGES = 30;
const MAX_GITHUB_SEARCH_RESULTS = 1_000;
const MAX_GITHUB_SEARCH_PAGES = Math.ceil(MAX_GITHUB_SEARCH_RESULTS / GITHUB_PAGE_SIZE);
const UPDATE_BRANCH = /^chore\/issue-([1-9][0-9]*)-update-codex-cli-(0|[1-9][0-9]*)-(0|[1-9][0-9]*)-(0|[1-9][0-9]*)$/;
const CODEX_SMOKE_RUN_TITLE = 'Self-hosted runner smoke (codex=true)';

function versionTuple(version) {
  const match = String(version).match(/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/);
  if (!match) throw new Error('Codex release version is not a stable numeric version.');
  return match.slice(1).map(Number);
}

function isNewer(candidate, current) {
  const left = versionTuple(candidate);
  const right = versionTuple(current);
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) return left[index] > right[index];
  }
  return false;
}

export function checkedRelease(release, currentVersion = RELEASE.version) {
  if (!release || release.draft !== false || release.prerelease !== false) {
    throw new Error('The official Codex latest-release response is not a stable published release.');
  }
  const match = String(release.tag_name ?? '').match(/^rust-v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/);
  if (!match) throw new Error('The official Codex release tag is not a stable rust-v semantic version.');
  const version = `${match[1]}.${match[2]}.${match[3]}`;
  if (!isNewer(version, currentVersion)) return null;

  const assets = (release.assets ?? []).filter((asset) => asset.name === ASSET_NAME);
  if (assets.length !== 1) throw new Error('The official Codex release must contain exactly one Linux x64 package asset.');
  const asset = assets[0];
  const digest = String(asset.digest ?? '').match(/^sha256:([a-f0-9]{64})$/)?.[1];
  const url = `https://github.com/openai/codex/releases/download/${release.tag_name}/${ASSET_NAME}`;
  if (!digest || asset.browser_download_url !== url || !Number.isSafeInteger(asset.size) || asset.size < 1 || asset.size > MAX_ASSET_BYTES) {
    throw new Error('The official Codex Linux asset is missing an acceptable SHA-256 digest, URL, or size.');
  }
  return {
    version,
    tag: release.tag_name,
    url,
    sha256: digest,
    releaseUrl: `https://github.com/openai/codex/releases/tag/${release.tag_name}`,
    assetName: asset.name,
    assetSize: asset.size,
  };
}

async function fetchJson(url, token, fetchImpl) {
  const response = await fetchImpl(url, {
    headers: {
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2026-03-10',
      Authorization: `Bearer ${token}`,
    },
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`Codex release metadata request failed (HTTP ${response.status}).`);
  return response.json();
}

export function codexSmokeRunIdentityMatches(run, { runId, expectedSha } = {}) {
  return Number.isSafeInteger(runId)
    && Number.isSafeInteger(run?.id)
    && run.id === runId
    && run.head_sha === expectedSha
    && run.event === 'workflow_dispatch'
    && run.display_title === CODEX_SMOKE_RUN_TITLE;
}

export async function dispatchAndWaitForCodexSmoke({
  repository,
  ref,
  expectedSha,
  token,
  fetchImpl = globalThis.fetch,
  wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
  maxAttempts = 240,
  intervalMs = 15_000,
} = {}) {
  const branchMatch = UPDATE_BRANCH.exec(String(ref ?? ''));
  if (!token || !/^[\w.-]+\/[\w.-]+$/.test(repository ?? '')
    || !branchMatch || !/^[0-9a-f]{40}$/.test(expectedSha ?? '')
    || !Number.isSafeInteger(maxAttempts) || maxAttempts < 1
    || !Number.isSafeInteger(intervalMs) || intervalMs < 0) {
    throw new Error('A verified updater branch, exact pull-request head, repository, and GH_TOKEN are required for Codex runner smoke.');
  }

  const headers = {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2026-03-10',
    Authorization: `Bearer ${token}`,
  };
  const workflowPath = `https://api.github.com/repos/${repository}/actions/workflows/self-hosted-runner-smoke.yml/dispatches`;
  const dispatchResponse = await fetchImpl(workflowPath, {
    method: 'POST',
    headers,
    body: JSON.stringify({ ref, inputs: { codex: true } }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!dispatchResponse.ok) throw new Error(`Codex runner smoke dispatch failed (HTTP ${dispatchResponse.status}).`);

  let dispatch;
  try { dispatch = await dispatchResponse.json(); } catch {
    throw new Error('Codex runner smoke dispatch did not return its exact workflow run ID.');
  }
  const runId = dispatch?.workflow_run_id;
  if (!Number.isSafeInteger(runId) || runId < 1) {
    throw new Error('Codex runner smoke dispatch did not return a valid workflow_run_id; Harness was not dispatched.');
  }
  await appendOutput('run_id', String(runId));

  const runUrl = `https://api.github.com/repos/${repository}/actions/runs/${runId}`;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const response = await fetchImpl(runUrl, {
      headers,
      signal: AbortSignal.timeout(15_000),
    });
    if (response.status === 404) {
      await wait(intervalMs);
      continue;
    }
    if (!response.ok) throw new Error(`Codex runner smoke run ${runId} lookup failed (HTTP ${response.status}).`);

    let run;
    try { run = await response.json(); } catch {
      throw new Error(`Codex runner smoke run ${runId} returned invalid JSON; Harness was not dispatched.`);
    }
    if (!codexSmokeRunIdentityMatches(run, { runId, expectedSha })) {
      throw new Error(`Codex runner smoke run ${runId} did not match its dispatch ID, exact head, workflow_dispatch event, and codex=true title; Harness was not dispatched.`);
    }
    if (run.status === 'completed') {
      if (run.conclusion !== 'success') {
        throw new Error(`Codex runner smoke failed: https://github.com/${repository}/actions/runs/${runId}; Harness was not dispatched.`);
      }
      process.stdout.write(`Codex=true runner smoke passed for ${expectedSha}: https://github.com/${repository}/actions/runs/${runId}\n`);
      return { runId, runUrl: `https://github.com/${repository}/actions/runs/${runId}` };
    }
    if (!['queued', 'in_progress', 'requested', 'waiting', 'pending'].includes(run.status)) {
      throw new Error(`Codex runner smoke run ${runId} has unexpected status ${String(run.status)}; Harness was not dispatched.`);
    }
    await wait(intervalMs);
  }
  throw new Error(`Timed out waiting for exact Codex=true runner smoke run ${runId}; Harness was not dispatched.`);
}

export async function listPullRequests(repository, token, fetchImpl = globalThis.fetch) {
  if (!token || !/^[\w.-]+\/[\w.-]+$/.test(repository ?? '')) {
    throw new Error('A repository and GH_TOKEN are required to list pull requests.');
  }
  const pullRequests = [];
  for (let page = 1; page <= MAX_GITHUB_API_PAGES + 1; page += 1) {
    const batch = await fetchJson(
      `https://api.github.com/repos/${repository}/pulls?state=all&sort=created&direction=asc&per_page=${GITHUB_PAGE_SIZE}&page=${page}`,
      token,
      fetchImpl,
    );
    if (!Array.isArray(batch)) throw new Error('The GitHub pull-request list is invalid.');
    pullRequests.push(...batch);
    if (batch.length < GITHUB_PAGE_SIZE) return pullRequests;
    if (page === MAX_GITHUB_API_PAGES + 1) break;
  }
  throw new Error(`The repository pull-request list exceeds the supported ${MAX_GITHUB_API_PAGES}-page bound.`);
}

export async function listCheckRuns(checkUrl, token, fetchImpl = globalThis.fetch) {
  if (!token) throw new Error('GH_TOKEN is required to list exact-head check runs.');
  const checkRuns = new Map();
  let expectedTotalCount;
  for (let page = 1; page <= MAX_GITHUB_API_PAGES; page += 1) {
    const url = new URL(checkUrl);
    url.searchParams.set('per_page', String(GITHUB_PAGE_SIZE));
    url.searchParams.set('page', String(page));
    const result = await fetchJson(url, token, fetchImpl);
    if (!Array.isArray(result.check_runs) || !Number.isSafeInteger(result.total_count) || result.total_count < 0) {
      throw new Error('The GitHub exact-head check-run response is invalid.');
    }
    if (expectedTotalCount !== undefined && result.total_count !== expectedTotalCount) {
      return { complete: false, checkRuns: [] };
    }
    expectedTotalCount = result.total_count;
    for (const run of result.check_runs) {
      if (!Number.isSafeInteger(run?.id)) throw new Error('The GitHub exact-head check-run response contains an invalid run ID.');
      checkRuns.set(run.id, run);
    }
    if (checkRuns.size === expectedTotalCount) {
      return { complete: true, checkRuns: [...checkRuns.values()] };
    }
    if (result.check_runs.length < GITHUB_PAGE_SIZE) {
      return { complete: false, checkRuns: [] };
    }
  }
  throw new Error(`The exact-head check-run list exceeds the supported ${MAX_GITHUB_API_PAGES}-page bound; runner smoke and semantic review were not dispatched.`);
}

export async function listSearchIssues(query, token, fetchImpl = globalThis.fetch) {
  if (!token || typeof query !== 'string' || !query.trim()) {
    throw new Error('A search query and GH_TOKEN are required to list GitHub issues.');
  }
  const searchUrl = new URL('https://api.github.com/search/issues');
  searchUrl.searchParams.set('q', query);
  searchUrl.searchParams.set('per_page', String(GITHUB_PAGE_SIZE));
  searchUrl.searchParams.set('sort', 'created');
  searchUrl.searchParams.set('order', 'asc');
  const issues = [];
  const issueNumbers = new Set();
  let expectedTotalCount;

  for (let page = 1; page <= MAX_GITHUB_SEARCH_PAGES; page += 1) {
    searchUrl.searchParams.set('page', String(page));
    const result = await fetchJson(searchUrl, token, fetchImpl);
    if (!Array.isArray(result.items)
      || !Number.isSafeInteger(result.total_count)
      || result.total_count < 0
      || typeof result.incomplete_results !== 'boolean'
      || result.items.length > GITHUB_PAGE_SIZE
      || result.items.some((issue) => !Number.isSafeInteger(issue?.number) || issue.number < 1)) {
      throw new Error('The GitHub issue-search response is invalid.');
    }
    if (result.incomplete_results) {
      throw new Error('GitHub issue search returned incomplete results; no release source issue will be created.');
    }
    if (expectedTotalCount !== undefined && result.total_count !== expectedTotalCount) {
      throw new Error('GitHub issue-search result count changed during pagination; no release source issue will be created.');
    }
    expectedTotalCount = result.total_count;
    if (expectedTotalCount > MAX_GITHUB_SEARCH_RESULTS) {
      throw new Error(`GitHub issue search found more than ${MAX_GITHUB_SEARCH_RESULTS} results, beyond the Search API limit; no release source issue will be created.`);
    }

    for (const issue of result.items) {
      if (issueNumbers.has(issue.number)) {
        throw new Error('GitHub issue search repeated an issue across pages; no release source issue will be created.');
      }
      issueNumbers.add(issue.number);
      issues.push(issue);
    }
    if (issues.length > expectedTotalCount) {
      throw new Error('GitHub issue search returned more results than its total_count; no release source issue will be created.');
    }
    if (issues.length === expectedTotalCount) return issues;
    if (result.items.length < GITHUB_PAGE_SIZE) {
      throw new Error('GitHub issue search returned fewer results than its total_count; no release source issue will be created.');
    }
  }

  throw new Error(`GitHub issue search exceeds the supported ${MAX_GITHUB_SEARCH_PAGES}-page bound; no release source issue will be created.`);
}

export async function verifyDownload(candidate, fetchImpl = globalThis.fetch, digestArchive = packageTreeSha256FromArchive) {
  const response = await fetchImpl(candidate.url, { signal: AbortSignal.timeout(120_000), redirect: 'follow' });
  if (!response.ok) throw new Error(`Codex release asset download failed (HTTP ${response.status}).`);
  const finalHost = new URL(response.url).hostname;
  if (!['github.com', 'release-assets.githubusercontent.com', 'objects.githubusercontent.com'].includes(finalHost)) {
    throw new Error('Codex release asset redirected outside the approved GitHub release hosts.');
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length !== candidate.assetSize || bytes.length > MAX_ASSET_BYTES) {
    throw new Error('Codex release asset size did not match official release metadata.');
  }
  const actual = createHash('sha256').update(bytes).digest('hex');
  if (actual !== candidate.sha256) throw new Error('Codex release asset did not match the official SHA-256 digest.');
  const packageTreeSha256 = await digestArchive(bytes);
  if (!/^[a-f0-9]{64}$/.test(packageTreeSha256 ?? '')) {
    throw new Error('Verified Codex package did not produce a valid installed-package digest.');
  }
  return packageTreeSha256;
}

async function appendOutput(name, value) {
  const outputPath = process.env.GITHUB_OUTPUT;
  if (!outputPath) return;
  await appendFile(outputPath, `${name}=${String(value)}\n`);
}

function updaterPullRequests(pulls, repository) {
  return (Array.isArray(pulls) ? pulls : []).filter((pullRequest) => {
    const branch = String(pullRequest.head?.ref ?? '');
    return pullRequest.base?.ref === 'main'
      && pullRequest.base?.repo?.full_name === repository
      && pullRequest.head?.repo?.full_name === repository
      && UPDATE_BRANCH.test(branch);
  });
}

export async function resolveClosedUpdateIssueStates(pulls, repository, token, fetchImpl = globalThis.fetch) {
  if (!token || !/^[\w.-]+\/[\w.-]+$/.test(repository ?? '')) {
    throw new Error('A repository and GH_TOKEN are required to resolve closed Codex CLI update pull requests.');
  }
  const closed = updaterPullRequests(pulls, repository)
    .filter((pullRequest) => pullRequest.state === 'closed' && !pullRequest.merged_at);
  const issues = new Map();
  for (const pullRequest of closed) {
    const match = UPDATE_BRANCH.exec(String(pullRequest.head?.ref ?? ''));
    const issueNumber = Number(match?.[1]);
    const version = match?.slice(2).join('.');
    if (!Number.isSafeInteger(issueNumber) || !version) {
      throw new Error('A closed Codex CLI update pull request has no valid release source issue.');
    }
    const issue = await fetchJson(`https://api.github.com/repos/${repository}/issues/${issueNumber}`, token, fetchImpl);
    const nativeIssueType = await getNativeIssueType({ repository, issueNumber, token, fetchImpl });
    if (nativeIssueType !== 'Task'
      || issue.number !== issueNumber || issue.pull_request
      || issue.html_url !== `https://github.com/${repository}/issues/${issueNumber}`
      || issue.title !== sourceIssueTitle(version)
      || !releaseTaskDetailsMatch({ issue, issueNumber, repository, version })
      || !['open', 'closed'].includes(issue.state)) {
      throw new Error(`Closed Codex CLI update pull request #${pullRequest.number} does not link to its matching release Task issue.`);
    }
    issues.set(issueNumber, { state: issue.state, version });
  }
  return issues;
}

export function selectPendingUpdatePullRequest(pulls, repository, candidateSlug, closedIssueStates = new Map()) {
  const updates = updaterPullRequests(pulls, repository);
  const closedWithoutMerge = updates.filter((pullRequest) => pullRequest.state === 'closed' && !pullRequest.merged_at);
  let rejectedCandidate;
  for (const pullRequest of closedWithoutMerge) {
    const match = UPDATE_BRANCH.exec(pullRequest.head.ref);
    const issueNumber = Number(match?.[1]);
    const version = match?.slice(2).join('.');
    const sourceIssue = closedIssueStates.get(issueNumber);
    if (!sourceIssue || sourceIssue.version !== version || !['open', 'closed'].includes(sourceIssue.state)) {
      throw new Error(`Closed Codex CLI update pull request #${pullRequest.number} has no verified release source issue; resolve it before opening another update.`);
    }
    if (sourceIssue.state !== 'closed') {
      throw new Error(`Codex CLI update pull request #${pullRequest.number} is closed without merging while its source issue #${issueNumber} remains open; close or merge that release decision before opening another update.`);
    }
    if (version.replaceAll('.', '-') === candidateSlug) rejectedCandidate = { version, issueNumber, pullRequest };
  }
  const pending = updates.filter((pullRequest) => pullRequest.state === 'open');
  if (pending.length > 1) throw new Error('More than one open Codex CLI update pull request exists; resolve the duplicates first.');
  if (pending.length) {
    const pullRequest = pending[0];
    const match = UPDATE_BRANCH.exec(pullRequest.head.ref);
    const branchVersion = match.slice(2).join('-');
    return {
      pullRequest,
      branch: pullRequest.head.ref,
      issueNumber: match[1],
      sameCandidate: branchVersion === candidateSlug,
    };
  }
  if (rejectedCandidate) return { rejectedCandidate: true, ...rejectedCandidate };
  return null;
}

function sourceIssueTitle(version) {
  return `Task: Update pinned Codex CLI to ${version}`;
}

function sourceIssueMarker(version) {
  return `<!-- codex-cli-release-update:v1:${version} -->`;
}

function checkedStoredCandidate(candidate) {
  if (!candidate || typeof candidate !== 'object'
    || !/^[a-f0-9]{64}$/.test(candidate.packageTreeSha256 ?? '')) return null;
  const verified = checkedRelease({
    draft: false,
    prerelease: false,
    tag_name: candidate.tag,
    assets: [{
      name: candidate.assetName,
      browser_download_url: candidate.url,
      digest: `sha256:${candidate.sha256}`,
      size: candidate.assetSize,
    }],
  }, RELEASE.version);
  if (!verified || ['version', 'tag', 'url', 'sha256', 'releaseUrl', 'assetName', 'assetSize']
    .some((key) => verified[key] !== candidate[key])) return null;
  return verified ? { ...verified, packageTreeSha256: candidate.packageTreeSha256 } : null;
}

function sourceIssueBody(candidate, repository) {
  const repositoryUrl = `${String(process.env.GITHUB_SERVER_URL ?? 'https://github.com').replace(/\/+$/, '')}/${repository}`;
  return [
    sourceIssueMarker(candidate.version),
    '',
    '## Requested outcome',
    '',
    `Promote Codex CLI ${candidate.version} to the central Actions runner pin after the exact candidate passes the no-generation runner checks and review.`,
    '',
    '## Context',
    '',
    `This release-specific task follows the ongoing runner maintenance policy in issue #70. The weekly updater verified the official release metadata, Linux x64 asset digest, and extracted package-tree digest before opening this issue.`,
    '',
    '## Acceptance criteria',
    '',
    '- The pull request updates the central CLI version, official asset URL and archive SHA-256, and extracted package-tree SHA-256.',
    '- The exact candidate passes ChatGPT authentication, Plan mode, sandbox isolation, quota, and configured model-effort checks without a model turn before semantic review.',
    '- Delivery-quality, ADR-quality, pull-request body, and Harness review checks are recorded on the exact pull-request head.',
    '- The pull request remains open for human review and closes this release-specific issue only when merged.',
    '',
    '## Related work',
    '',
    `- Ongoing runner maintenance and model-profile policy: [issue #70](${repositoryUrl}/issues/70).`,
    `- Official Codex release: [${candidate.version}](${candidate.releaseUrl}).`,
    `- Verified Linux x64 asset SHA-256: \`${candidate.sha256}\`.`,
    `- Verified Linux x64 package-tree SHA-256: \`${candidate.packageTreeSha256}\`.`,
  ].join('\n');
}

export async function resolveSourceIssue({
  candidate,
  repository,
  token,
  fetchImpl = globalThis.fetch,
  createIssue,
} = {}) {
  if (!candidate || !/^[\w.-]+\/[\w.-]+$/.test(repository ?? '') || !token) {
    throw new Error('A verified candidate, repository, and GH_TOKEN are required to resolve the update source issue.');
  }
  const verified = checkedStoredCandidate(candidate);
  if (!verified) {
    throw new Error('The source issue candidate does not match a newer verified Codex release.');
  }
  candidate = verified;
  const title = sourceIssueTitle(candidate.version);
  const marker = sourceIssueMarker(candidate.version);
  const query = `repo:${repository} is:issue is:open in:title "Update pinned Codex CLI to"`;
  const searchIssues = await listSearchIssues(query, token, fetchImpl);
  const matches = searchIssues.filter((issue) => (
    !issue.pull_request
      && issue.state === 'open'
      && /^Task: Update pinned Codex CLI to \d+\.\d+\.\d+$/.test(String(issue.title ?? ''))
      && /<!-- codex-cli-release-update:v1:\d+\.\d+\.\d+ -->/.test(String(issue.body ?? ''))
  ));
  if (matches.length > 1) throw new Error('More than one open Codex CLI release source issue exists; resolve the duplicate or older task before starting another.');
  if (matches.length === 1) {
    const issue = matches[0];
    const issueVersion = String(issue.body ?? '').match(/<!-- codex-cli-release-update:v1:(\d+\.\d+\.\d+) -->/)?.[1];
    if (issueVersion !== candidate.version || issue.title !== title) {
      throw new Error(`Open Codex CLI source issue #${issue.number} is for release ${issueVersion ?? 'unknown'}; resolve it before starting ${candidate.version}.`);
    }
    if (!Number.isSafeInteger(issue.number) || issue.number < 1
      || issue.html_url !== `https://github.com/${repository}/issues/${issue.number}`) {
      throw new Error('The matching Codex CLI update source issue has an invalid repository URL or number.');
    }
    const nativeIssueType = await getNativeIssueType({ repository, issueNumber: issue.number, token, fetchImpl });
    if (nativeIssueType !== 'Task') {
      throw new Error(`The matching Codex CLI update source issue #${issue.number} has native issue type ${nativeIssueType ?? 'none'}; expected Task.`);
    }
    if (!releaseTaskMatches({
      issue,
      nativeIssueType,
      issueNumber: issue.number,
      repository,
      version: candidate.version,
      releaseUrl: candidate.releaseUrl,
      sha256: candidate.sha256,
      packageTreeSha256: candidate.packageTreeSha256,
    })) {
      throw new Error(`Open Codex CLI source Task #${issue.number} does not record the verified release URL, SHA-256, and package-tree digest for ${candidate.version}.`);
    }
    return { number: issue.number, url: issue.html_url, title, created: false };
  }

  const body = sourceIssueBody(candidate, repository);
  const create = createIssue ?? (async ({ issueTitle, issueBody }) => {
    const temporaryDirectory = process.env.RUNNER_TEMP;
    if (!temporaryDirectory) throw new Error('RUNNER_TEMP is required to create the Codex CLI update source issue.');
    const bodyPath = path.join(temporaryDirectory, `codex-cli-update-issue-${candidate.version}.md`);
    await writeFile(bodyPath, `${issueBody}\n`, { mode: 0o600 });
    try {
      const { stdout } = await execFileAsync('gh', [
        'issue', 'create', '--repo', repository, '--title', issueTitle,
        '--body-file', bodyPath, '--type', 'Task',
      ], {
        encoding: 'utf8',
        windowsHide: true,
        maxBuffer: 1_000_000,
        env: { ...process.env, GH_TOKEN: token, GH_REPO: repository },
      });
      const url = stdout.trim().split(/\r?\n/).at(-1);
      const prefix = `https://github.com/${repository}/issues/`;
      const issueNumber = url?.startsWith(prefix) ? url.slice(prefix.length) : '';
      if (!/^[1-9][0-9]*$/.test(issueNumber)) throw new Error('GitHub CLI did not return the created source issue URL.');
      return { number: Number(issueNumber), url };
    } catch {
      throw new Error(`Could not create the Codex CLI ${candidate.version} source issue as a Task.`);
    } finally {
      await unlink(bodyPath).catch(() => {});
    }
  });
  const created = await create({ repository, issueTitle: title, issueBody: body, token });
  if (!Number.isSafeInteger(created?.number) || created.number < 1
    || created.url !== `https://github.com/${repository}/issues/${created.number}`) {
    throw new Error('The newly created Codex CLI update source issue has an invalid repository URL or number.');
  }
  const nativeIssueType = await getNativeIssueType({ repository, issueNumber: created.number, token, fetchImpl });
  if (nativeIssueType !== 'Task') {
    throw new Error(`The newly created Codex CLI update source issue #${created.number} has native issue type ${nativeIssueType ?? 'none'}; expected Task.`);
  }
  return { number: created.number, url: created.url, title, created: true };
}

export async function verifyReusableUpdatePullRequest({
  pending,
  candidate,
  repository,
  token,
  fetchImpl = globalThis.fetch,
} = {}) {
  if (!pending?.sameCandidate || !Number.isSafeInteger(pending.pullRequest?.number)
    || !/^[0-9a-f]{40}$/.test(pending.pullRequest?.head?.sha ?? '')
    || !/^[\w.-]+\/[\w.-]+$/.test(repository ?? '') || !token
    || !checkedStoredCandidate(candidate)) {
    throw new Error('A candidate release, exact same-release pull request, repository, and GH_TOKEN are required to reuse an updater pull request.');
  }

  const pullRequest = await fetchJson(
    `https://api.github.com/repos/${repository}/pulls/${pending.pullRequest.number}`,
    token,
    fetchImpl,
  );
  if (pullRequest.number !== pending.pullRequest.number
    || pullRequest.state !== 'open'
    || pullRequest.head?.sha !== pending.pullRequest.head.sha
    || pullRequest.head?.ref !== pending.branch) {
    throw new Error(`Open Codex CLI update pull request #${pending.pullRequest.number} changed after discovery; no runner smoke will be dispatched.`);
  }

  const releaseIdentity = updaterReviewCandidate({
    event: {
      action: 'opened',
      repository: { full_name: repository },
      pull_request: pullRequest,
    },
    repository,
  });
  if (!releaseIdentity
    || releaseIdentity.issueNumber !== Number(pending.issueNumber)
    || releaseIdentity.version !== candidate.version
    || releaseIdentity.releaseUrl !== candidate.releaseUrl
    || releaseIdentity.sha256 !== candidate.sha256
    || releaseIdentity.packageTreeSha256 !== candidate.packageTreeSha256) {
    throw new Error(`Open Codex CLI update pull request #${pending.pullRequest.number} does not match the registered updater, candidate release, or source issue; no runner smoke will be dispatched.`);
  }

  const issue = await fetchJson(
    `https://api.github.com/repos/${repository}/issues/${releaseIdentity.issueNumber}`,
    token,
    fetchImpl,
  );
  const nativeIssueType = await getNativeIssueType({
    repository,
    issueNumber: releaseIdentity.issueNumber,
    token,
    fetchImpl,
  });
  if (!releaseTaskMatches({
    issue,
    nativeIssueType,
    ...releaseIdentity,
    repository,
  })) {
    throw new Error(`Open Codex CLI update pull request #${pullRequest.number} does not link to its verified release Task; no runner smoke will be dispatched.`);
  }

  return { pullRequest, issueNumber: releaseIdentity.issueNumber };
}

export async function reverifyReleasePullRequest({
  pullRequestNumber,
  branch,
  expectedSha,
  issueNumber,
  candidate,
  repository,
  token,
  fetchImpl = globalThis.fetch,
} = {}) {
  if (!Number.isSafeInteger(pullRequestNumber) || pullRequestNumber < 1
    || !Number.isSafeInteger(Number(issueNumber)) || Number(issueNumber) < 1
    || !/^[0-9a-f]{40}$/.test(expectedSha ?? '')
    || typeof branch !== 'string') {
    throw new Error('An exact updater PR number, branch, head SHA, and source Task issue are required for release re-verification.');
  }
  return verifyReusableUpdatePullRequest({
    pending: {
      sameCandidate: true,
      pullRequest: { number: pullRequestNumber, head: { sha: expectedSha } },
      branch,
      issueNumber: String(issueNumber),
    },
    candidate,
    repository,
    token,
    fetchImpl,
  });
}

async function checkRelease() {
  const token = process.env.GH_TOKEN;
  const candidatePath = process.env.CODEX_RELEASE_CANDIDATE_PATH;
  if (!token || !candidatePath) throw new Error('GH_TOKEN and CODEX_RELEASE_CANDIDATE_PATH are required.');
  const release = await fetchJson(API_URL, token, globalThis.fetch);
  const candidate = checkedRelease(release, RELEASE.version);
  if (!candidate) {
    await appendOutput('update', 'false');
    process.stdout.write(`Pinned Codex CLI ${RELEASE.version} is current; no model turn was started.\n`);
    return;
  }
  const packageTreeSha256 = await verifyDownload(candidate, globalThis.fetch);
  const verifiedCandidate = { ...candidate, packageTreeSha256 };
  await writeFile(candidatePath, `${JSON.stringify(verifiedCandidate, null, 2)}\n`, { mode: 0o600 });
  await appendOutput('update', 'true');
  await appendOutput('version', candidate.version);
  await appendOutput('slug', candidate.version.replaceAll('.', '-'));
  await appendOutput('sha256', candidate.sha256);
  await appendOutput('package_tree_sha256', packageTreeSha256);
  process.stdout.write(`Verified official Codex ${candidate.version} Linux x64 release asset; no model turn was started.\n`);
}

async function findPendingPullRequest() {
  const token = process.env.GH_TOKEN;
  const repository = process.env.GITHUB_REPOSITORY;
  const candidateSlug = process.env.CODEX_RELEASE_SLUG;
  const candidatePath = process.env.CODEX_RELEASE_CANDIDATE_PATH;
  if (!token || !repository || !candidateSlug || !candidatePath) {
    throw new Error('GH_TOKEN, GITHUB_REPOSITORY, CODEX_RELEASE_SLUG, and CODEX_RELEASE_CANDIDATE_PATH are required.');
  }
  const candidate = checkedStoredCandidate(JSON.parse(await readFile(candidatePath, 'utf8')));
  if (!candidate || candidate.version.replaceAll('.', '-') !== candidateSlug) {
    throw new Error('The pending-PR candidate does not match the verified release metadata.');
  }
  const pulls = await listPullRequests(repository, token, globalThis.fetch);
  const closedIssueStates = await resolveClosedUpdateIssueStates(pulls, repository, token, globalThis.fetch);
  const pending = selectPendingUpdatePullRequest(pulls, repository, candidateSlug, closedIssueStates);
  if (pending?.rejectedCandidate) {
    await appendOutput('pending', 'false');
    await appendOutput('rejected', 'true');
    await appendOutput('rejected_version', pending.version);
    await appendOutput('rejected_issue_number', String(pending.issueNumber));
    process.stdout.write(`Codex CLI ${pending.version} was explicitly resolved by closing source issue #${pending.issueNumber}; the updater will not recreate that rejected candidate. A later release can be evaluated normally.\n`);
    return;
  }
  if (!pending) {
    await appendOutput('pending', 'false');
    await appendOutput('rejected', 'false');
    process.stdout.write('No open Codex CLI update pull request exists.\n');
    return;
  }

  if (pending.sameCandidate) {
    const verified = await verifyReusableUpdatePullRequest({ pending, candidate, repository, token });
    pending.pullRequest = verified.pullRequest;
    pending.issueNumber = String(verified.issueNumber);
  }

  await appendOutput('pending', 'true');
  await appendOutput('reuse', String(pending.sameCandidate));
  await appendOutput('branch', pending.branch);
  await appendOutput('number', String(pending.pullRequest.number));
  await appendOutput('issue_number', pending.issueNumber);
  await appendOutput('head_sha', pending.pullRequest.head.sha);
  process.stdout.write(pending.sameCandidate
    ? `Codex CLI update pull request #${pending.pullRequest.number} is already open; no duplicate was created.\n`
    : `Codex CLI update pull request #${pending.pullRequest.number} for an earlier release is still open; resolve it before opening another.\n`);
}

async function waitForPullRequestChecks() {
  const token = process.env.GH_TOKEN;
  const repository = process.env.GITHUB_REPOSITORY;
  const number = Number(process.env.PR_NUMBER);
  const expectedSha = process.env.EXPECTED_SHA;
  if (!token || !repository || !Number.isSafeInteger(number) || number < 1 || !/^[0-9a-f]{40}$/.test(expectedSha ?? '')) {
    throw new Error('GH_TOKEN, GITHUB_REPOSITORY, PR_NUMBER, and EXPECTED_SHA are required to wait for candidate checks.');
  }
  const pullUrl = `https://api.github.com/repos/${repository}/pulls/${number}`;
  const pullRequest = await fetchJson(pullUrl, token, globalThis.fetch);
  if (pullRequest.state !== 'open' || pullRequest.head?.sha !== expectedSha) {
    throw new Error('The release pull request closed or changed head before its exact-head checks were ready.');
  }
  const files = [];
  for (let page = 1; page <= 30; page += 1) {
    const batch = await fetchJson(`${pullUrl}/files?per_page=100&page=${page}`, token, globalThis.fetch);
    if (!Array.isArray(batch)) throw new Error('The release pull request changed-file list is invalid.');
    files.push(...batch);
    if (batch.length < 100) break;
    if (page === 30) throw new Error('The release pull request changed-file list exceeds the supported review bound.');
  }
  const requireAdrValidation = adrQualityWorkflowAppliesToFiles(files.map((file) => file.filename));
  const checkUrl = `https://api.github.com/repos/${repository}/commits/${expectedSha}/check-runs?filter=latest&per_page=100`;
  for (let attempt = 0; attempt < 120; attempt += 1) {
    const currentPullRequest = await fetchJson(pullUrl, token, globalThis.fetch);
    if (currentPullRequest.state !== 'open' || currentPullRequest.head?.sha !== expectedSha) {
      throw new Error('The release pull request changed head while the updater waited for exact-head checks.');
    }
    const checkEvidence = await listCheckRuns(checkUrl, token, globalThis.fetch);
    if (!checkEvidence.complete) {
      await new Promise((resolve) => setTimeout(resolve, 15_000));
      continue;
    }
    const preliminary = reviewCheckReadiness(checkEvidence.checkRuns, expectedSha, requireAdrValidation, false);
    const verifiedRuns = preliminary.requiredReady
      ? await verifyReviewCheckRunProducers(checkEvidence.checkRuns, {
        repository,
        expectedSha,
        token,
        fetchImpl: globalThis.fetch,
      })
      : checkEvidence.checkRuns;
    const readiness = reviewCheckReadiness(verifiedRuns, expectedSha, requireAdrValidation);
    if (readiness.ready) {
      await appendOutput('checks_ready', 'true');
      process.stdout.write(`Exact-head body, delivery-quality, portability${requireAdrValidation ? ', and ADR-quality' : ''} checks passed for pull request #${number} at ${expectedSha}.\n`);
      return;
    }
    if (readiness.failed.length) {
      await appendOutput('checks_ready', 'false');
      await appendOutput('failed_checks', readiness.failed.join(','));
      process.stdout.write(`Deterministic checks failed for pull request #${number}: ${readiness.failed.join(', ')}. Runner smoke and semantic review will not be dispatched.\n`);
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 15_000));
  }
  throw new Error(`Timed out waiting for exact-head pull-request checks on #${number}; no runner smoke or semantic review was dispatched.`);
}

async function runCodexSmokePreflight() {
  await dispatchAndWaitForCodexSmoke({
    repository: process.env.GITHUB_REPOSITORY,
    ref: process.env.PR_BRANCH,
    expectedSha: process.env.EXPECTED_SHA,
    token: process.env.GH_TOKEN,
  });
}

async function reverifyWorkflowPullRequest() {
  const token = process.env.GH_TOKEN;
  const repository = process.env.GITHUB_REPOSITORY;
  const candidatePath = process.env.CODEX_RELEASE_CANDIDATE_PATH;
  const candidate = candidatePath
    ? checkedStoredCandidate(JSON.parse(await readFile(candidatePath, 'utf8')))
    : null;
  if (!token || !repository || !candidate) {
    throw new Error('GH_TOKEN, GITHUB_REPOSITORY, and a verified release candidate are required before dispatch.');
  }
  const result = await reverifyReleasePullRequest({
    pullRequestNumber: Number(process.env.PR_NUMBER),
    branch: process.env.PR_BRANCH,
    expectedSha: process.env.EXPECTED_SHA,
    issueNumber: Number(process.env.SOURCE_ISSUE_NUMBER),
    candidate,
    repository,
    token,
  });
  await appendOutput('verified', 'true');
  process.stdout.write(`Re-verified pull request #${result.pullRequest.number} and release Task #${result.issueNumber} against Codex CLI ${candidate.version} immediately before dispatch.\n`);
}

async function ensureSourceIssue(candidatePath) {
  const token = process.env.GH_TOKEN;
  const repository = process.env.GITHUB_REPOSITORY;
  const candidate = JSON.parse(await readFile(candidatePath, 'utf8'));
  const issue = await resolveSourceIssue({ candidate, repository, token });
  await appendOutput('issue_number', String(issue.number));
  await appendOutput('issue_url', issue.url);
  process.stdout.write(issue.created
    ? `Created Task source issue #${issue.number} for Codex CLI ${candidate.version}.\n`
    : `Reusing open Task source issue #${issue.number} for Codex CLI ${candidate.version}.\n`);
}

async function applyRelease(candidatePath) {
  const candidate = JSON.parse(await readFile(candidatePath, 'utf8'));
  const verified = checkedStoredCandidate(candidate);
  if (!verified) {
    throw new Error('The verified Codex release candidate changed before the pin update.');
  }

  const setupPath = path.resolve('scripts/setup-runner-codex.mjs');
  const current = await readFile(setupPath, 'utf8');
  const versionLine = `version: '${RELEASE.version}'`;
  const urlLine = `url: '${RELEASE.url}'`;
  const digestLine = `sha256: '${RELEASE.sha256}'`;
  const packageTreeDigestLine = `packageTreeSha256: '${RELEASE.packageTreeSha256}'`;
  if ([versionLine, urlLine, digestLine, packageTreeDigestLine].some((line) => current.split(line).length !== 2)) {
    throw new Error('The central Codex pin does not match the release expected by the update workflow.');
  }
  const updated = current
    .replace(versionLine, `version: '${verified.version}'`)
    .replace(urlLine, `url: '${verified.url}'`)
    .replace(digestLine, `sha256: '${verified.sha256}'`)
    .replace(packageTreeDigestLine, `packageTreeSha256: '${verified.packageTreeSha256}'`);
  await writeFile(setupPath, updated);

  const changelogPath = path.resolve('CHANGELOG.md');
  const changelog = await readFile(changelogPath, 'utf8');
  const changedHeading = '### Changed\n';
  if (!changelog.includes(changedHeading)) throw new Error('CHANGELOG.md has no Unreleased Changed section.');
  const entry = `\n- Update the pinned Codex CLI from ${RELEASE.version} to ${verified.version} after verifying the official release asset digest; the pull request waits for no-generation runner capability checks before semantic review.\n`;
  if (!changelog.includes(entry.trim())) {
    await writeFile(changelogPath, changelog.replace(changedHeading, `${changedHeading}${entry}`));
  }
  process.stdout.write(`Updated the central Codex CLI pin from ${RELEASE.version} to ${verified.version}.\n`);
}

const isMainModule = process.argv[1]
  && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMainModule) {
  try {
    if (process.argv[2] === '--check' && process.argv.length === 3) await checkRelease();
    else if (process.argv[2] === '--pending-pr' && process.argv.length === 3) await findPendingPullRequest();
    else if (process.argv[2] === '--wait-checks' && process.argv.length === 3) await waitForPullRequestChecks();
    else if (process.argv[2] === '--smoke-preflight' && process.argv.length === 3) await runCodexSmokePreflight();
    else if (process.argv[2] === '--reverify-release-pr' && process.argv.length === 3) await reverifyWorkflowPullRequest();
    else if (process.argv[2] === '--ensure-source-issue' && process.argv[3]) await ensureSourceIssue(process.argv[3]);
    else if (process.argv[2] === '--apply' && process.argv[3]) await applyRelease(process.argv[3]);
    else throw new Error('Usage: codex-cli-release-update.mjs --check | --pending-pr | --wait-checks | --smoke-preflight | --reverify-release-pr | --ensure-source-issue <candidate-json> | --apply <candidate-json>');
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}
