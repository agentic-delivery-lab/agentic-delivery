// agentic-primitive: {"id":"codex-cli-updater-review-classifier","kind":"validator","enforcement":"deterministic","adrs":["ADR-0009","ADR-0011"],"domains":["agentic-delivery-governance"]}
import { appendFile, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const UPDATER_BOT = 'agentic-delivery-lab-invoker-7f3a[bot]';
const SUPPORTED_ACTIONS = new Set(['opened', 'synchronize', 'reopened', 'ready_for_review']);
const UPDATE_BRANCH = /^chore\/issue-([1-9][0-9]*)-update-codex-cli-(0|[1-9][0-9]*)-(0|[1-9][0-9]*)-(0|[1-9][0-9]*)$/;

function markerCount(body) {
  return String(body ?? '').split('<!-- codex-cli-release-update:v1:').length - 1;
}

export function updaterReviewCandidate({ event, repository }) {
  if (!/^[\w.-]+\/[\w.-]+$/.test(repository ?? '')) return null;
  if (!SUPPORTED_ACTIONS.has(event?.action)) return null;
  const pullRequest = event?.pull_request;
  if (!pullRequest || event?.repository?.full_name !== repository) return null;
  if (pullRequest.state !== 'open' || pullRequest.merged_at) return null;
  if (pullRequest.user?.login !== UPDATER_BOT) return null;
  if (pullRequest.base?.ref !== 'main'
    || pullRequest.base?.repo?.full_name !== repository
    || pullRequest.head?.repo?.full_name !== repository) return null;

  const branch = String(pullRequest.head?.ref ?? '');
  const branchMatch = UPDATE_BRANCH.exec(branch);
  if (!branchMatch) return null;
  const issueNumber = Number(branchMatch[1]);
  const version = branchMatch.slice(2).join('.');
  const expectedTitle = `chore(delivery): 🔧 update pinned Codex CLI to ${version}`;
  if (pullRequest.title !== expectedTitle) return null;

  const body = String(pullRequest.body ?? '');
  const expectedMarker = `<!-- codex-cli-release-update:v1:${version} -->`;
  if (markerCount(body) !== 1 || !body.includes(expectedMarker)) return null;

  const expectedSourceLine = `- Source issue: Closes #${issueNumber} — [Task: Update pinned Codex CLI to ${version}](https://github.com/${repository}/issues/${issueNumber})`;
  const sourceLines = body.split(/\r?\n/).filter((line) => line.startsWith('- Source issue:'));
  if (sourceLines.length !== 1 || sourceLines[0] !== expectedSourceLine) return null;

  return { issueNumber, version };
}

export function releaseTaskMatches({ issue, issueNumber, repository, version }) {
  if (!issue || issue.number !== issueNumber || issue.pull_request
    || issue.html_url !== `https://github.com/${repository}/issues/${issueNumber}`
    || issue.state !== 'open'
    || issue.title !== `Task: Update pinned Codex CLI to ${version}`) return false;

  const body = String(issue.body ?? '');
  const expectedMarker = `<!-- codex-cli-release-update:v1:${version} -->`;
  const releaseLine = `- Official Codex release: [${version}](https://github.com/openai/codex/releases/tag/rust-v${version}).`;
  return markerCount(body) === 1 && body.includes(expectedMarker) && body.includes(releaseLine);
}

export async function classifyUpdaterReview({ event, repository, token, fetchImpl = globalThis.fetch } = {}) {
  const candidate = updaterReviewCandidate({ event, repository });
  if (!candidate) return { suppressReview: false, reason: 'The pull request does not exactly match the registered Codex CLI updater.' };
  if (!token) return { suppressReview: false, reason: 'The source Task could not be verified because GH_TOKEN is unavailable.' };

  try {
    const response = await fetchImpl(`https://api.github.com/repos/${repository}/issues/${candidate.issueNumber}`, {
      headers: {
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2026-03-10',
        Authorization: `Bearer ${token}`,
      },
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) {
      return { suppressReview: false, reason: `The release Task lookup returned HTTP ${response.status}.` };
    }
    const issue = await response.json();
    if (!releaseTaskMatches({ issue, ...candidate, repository })) {
      return { suppressReview: false, reason: 'The linked source issue does not match the release Task, version, and repository.' };
    }
    return { suppressReview: true, reason: 'The registered updater PR and its linked release Task match the same version.' };
  } catch {
    return { suppressReview: false, reason: 'The release Task could not be verified; normal Harness review will run.' };
  }
}

async function main() {
  const outputPath = process.env.GITHUB_OUTPUT;
  if (!outputPath) throw new Error('GITHUB_OUTPUT is required.');

  let result;
  try {
    const eventPath = process.env.EVENT_PATH;
    const repository = process.env.GITHUB_REPOSITORY;
    if (!eventPath || !repository) throw new Error('EVENT_PATH and GITHUB_REPOSITORY are required.');
    const event = JSON.parse(await readFile(eventPath, 'utf8'));
    result = await classifyUpdaterReview({
      event,
      repository,
      token: process.env.GH_TOKEN,
    });
  } catch {
    result = { suppressReview: false, reason: 'Updater classification evidence was unavailable; normal Harness review will run.' };
  }

  await appendFile(outputPath, `suppress_review=${result.suppressReview}\n`);
  process.stdout.write(`${result.reason}\n`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
