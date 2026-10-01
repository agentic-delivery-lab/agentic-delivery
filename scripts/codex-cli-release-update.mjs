// agentic-primitive: {"id":"codex-cli-release-updater","kind":"script","enforcement":"deterministic","adrs":["ADR-0009"],"domains":["agentic-delivery-governance"]}
import { createHash } from 'node:crypto';
import { appendFile, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { RELEASE } from './setup-runner-codex.mjs';

const API_URL = 'https://api.github.com/repos/openai/codex/releases/latest';
const ASSET_NAME = 'codex-package-x86_64-unknown-linux-musl.tar.gz';
const MAX_ASSET_BYTES = 256 * 1024 * 1024;

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

function checkedRelease(release, currentVersion) {
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

async function verifyDownload(candidate, fetchImpl) {
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
  const pulls = await fetchJson(`https://api.github.com/repos/${repository}/pulls?state=open&per_page=100`, token, globalThis.fetch);
  const prefix = 'chore/issue-70-update-codex-cli-';
  const pending = (Array.isArray(pulls) ? pulls : []).filter((pullRequest) => (
    pullRequest.base?.ref === 'main'
      && pullRequest.base?.repo?.full_name === repository
      && pullRequest.head?.repo?.full_name === repository
      && String(pullRequest.head?.ref ?? '').startsWith(prefix)
  ));
  if (pending.length > 1) throw new Error('More than one open Codex CLI update pull request exists; resolve the duplicates first.');
  if (!pending.length) {
    await appendOutput('pending', 'false');
    process.stdout.write('No open Codex CLI update pull request exists.\n');
    return;
  }

  const pullRequest = pending[0];
  const branch = pullRequest.head.ref;
  const sameCandidate = branch === `${prefix}${candidateSlug}`;
  await appendOutput('pending', 'true');
  await appendOutput('reuse', String(sameCandidate));
  await appendOutput('branch', branch);
  await appendOutput('number', String(pullRequest.number));
  await appendOutput('head_sha', pullRequest.head.sha);
  process.stdout.write(sameCandidate
    ? `Codex CLI update pull request #${pullRequest.number} is already open; no duplicate was created.\n`
    : `Codex CLI update pull request #${pullRequest.number} for an earlier release is still open; resolve it before opening another.\n`);
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
    else if (process.argv[2] === '--apply' && process.argv[3]) await applyRelease(process.argv[3]);
    else throw new Error('Usage: codex-cli-release-update.mjs --check | --pending-pr | --apply <candidate-json>');
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}
