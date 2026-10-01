// agentic-primitive: {"id":"codex-cli-release-updater","kind":"script","enforcement":"deterministic","adrs":["ADR-0009"],"domains":["agentic-delivery-governance"]}
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { appendFile, readFile, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { reviewCheckReadiness } from './lib/pull-request-check-readiness.mjs';
import { RELEASE } from './setup-runner-codex.mjs';

export { reviewCheckReadiness } from './lib/pull-request-check-readiness.mjs';

const execFileAsync = promisify(execFile);
const API_URL = 'https://api.github.com/repos/openai/codex/releases/latest';
const ASSET_NAME = 'codex-package-x86_64-unknown-linux-musl.tar.gz';
const MAX_ASSET_BYTES = 256 * 1024 * 1024;
const UPDATE_BRANCH = /^chore\/issue-([1-9][0-9]*)-update-codex-cli-(0|[1-9][0-9]*)-(0|[1-9][0-9]*)-(0|[1-9][0-9]*)$/;

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

export async function verifyDownload(candidate, fetchImpl = globalThis.fetch) {
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
    const marker = `<!-- codex-cli-release-update:v1:${version} -->`;
    if (issue.number !== issueNumber || issue.pull_request
      || issue.html_url !== `https://github.com/${repository}/issues/${issueNumber}`
      || issue.title !== sourceIssueTitle(version)
      || !String(issue.body ?? '').includes(marker)
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
    `This release-specific task follows the ongoing runner maintenance policy in issue #70. The weekly updater verified the official release metadata and Linux x64 asset digest before opening this issue.`,
    '',
    '## Acceptance criteria',
    '',
    '- The pull request updates the single central CLI version, official asset URL, and SHA-256 digest.',
    '- The exact candidate passes ChatGPT authentication, Plan mode, sandbox isolation, quota, and configured model-effort checks without a model turn before semantic review.',
    '- Delivery-quality, ADR-quality, pull-request body, and Harness review checks are recorded on the exact pull-request head.',
    '- The pull request remains open for human review and closes this release-specific issue only when merged.',
    '',
    '## Related work',
    '',
    `- Ongoing runner maintenance and model-profile policy: [issue #70](${repositoryUrl}/issues/70).`,
    `- Official Codex release: [${candidate.version}](${candidate.releaseUrl}).`,
    `- Verified Linux x64 asset SHA-256: \`${candidate.sha256}\`.`,
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
  if (!verified || verified.version !== candidate.version || verified.releaseUrl !== candidate.releaseUrl) {
    throw new Error('The source issue candidate does not match a newer verified Codex release.');
  }
  candidate = verified;
  const title = sourceIssueTitle(candidate.version);
  const marker = sourceIssueMarker(candidate.version);
  const query = new URLSearchParams({
    q: `repo:${repository} is:issue is:open in:title "Update pinned Codex CLI to"`,
    per_page: '100',
  });
  const search = await fetchJson(`https://api.github.com/search/issues?${query}`, token, fetchImpl);
  const matches = (Array.isArray(search.items) ? search.items : []).filter((issue) => (
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
  return { number: created.number, url: created.url, title, created: true };
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
  await verifyDownload(candidate, globalThis.fetch);
  await writeFile(candidatePath, `${JSON.stringify(candidate, null, 2)}\n`, { mode: 0o600 });
  await appendOutput('update', 'true');
  await appendOutput('version', candidate.version);
  await appendOutput('slug', candidate.version.replaceAll('.', '-'));
  await appendOutput('sha256', candidate.sha256);
  process.stdout.write(`Verified official Codex ${candidate.version} Linux x64 release asset; no model turn was started.\n`);
}

async function findPendingPullRequest() {
  const token = process.env.GH_TOKEN;
  const repository = process.env.GITHUB_REPOSITORY;
  const candidateSlug = process.env.CODEX_RELEASE_SLUG;
  if (!token || !repository || !candidateSlug) throw new Error('GH_TOKEN, GITHUB_REPOSITORY, and CODEX_RELEASE_SLUG are required.');
  const pulls = await fetchJson(`https://api.github.com/repos/${repository}/pulls?state=all&per_page=100`, token, globalThis.fetch);
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
  const requireAdrValidation = files.some((file) => String(file.filename ?? '').startsWith('docs/decisions/'));
  const checkUrl = `https://api.github.com/repos/${repository}/commits/${expectedSha}/check-runs?filter=latest&per_page=100`;
  for (let attempt = 0; attempt < 120; attempt += 1) {
    const currentPullRequest = await fetchJson(pullUrl, token, globalThis.fetch);
    if (currentPullRequest.state !== 'open' || currentPullRequest.head?.sha !== expectedSha) {
      throw new Error('The release pull request changed head while the updater waited for exact-head checks.');
    }
    const response = await fetchJson(checkUrl, token, globalThis.fetch);
    const readiness = reviewCheckReadiness(response.check_runs, expectedSha, requireAdrValidation);
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
  if (!verified || verified.version !== candidate.version || verified.releaseUrl !== candidate.releaseUrl) {
    throw new Error('The verified Codex release candidate changed before the pin update.');
  }

  const setupPath = path.resolve('scripts/setup-runner-codex.mjs');
  const current = await readFile(setupPath, 'utf8');
  const versionLine = `version: '${RELEASE.version}'`;
  const urlLine = `url: '${RELEASE.url}'`;
  const digestLine = `sha256: '${RELEASE.sha256}'`;
  if ([versionLine, urlLine, digestLine].some((line) => current.split(line).length !== 2)) {
    throw new Error('The central Codex pin does not match the release expected by the update workflow.');
  }
  const updated = current
    .replace(versionLine, `version: '${verified.version}'`)
    .replace(urlLine, `url: '${verified.url}'`)
    .replace(digestLine, `sha256: '${verified.sha256}'`);
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
    else if (process.argv[2] === '--ensure-source-issue' && process.argv[3]) await ensureSourceIssue(process.argv[3]);
    else if (process.argv[2] === '--apply' && process.argv[3]) await applyRelease(process.argv[3]);
    else throw new Error('Usage: codex-cli-release-update.mjs --check | --pending-pr | --wait-checks | --ensure-source-issue <candidate-json> | --apply <candidate-json>');
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}
