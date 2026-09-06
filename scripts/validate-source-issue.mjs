import { execFile } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export class SourceIssueValidationError extends Error {
  constructor(message, exitCode = 1) {
    super(message);
    this.name = 'SourceIssueValidationError';
    this.exitCode = exitCode;
  }
}

function fail(message) {
  return new SourceIssueValidationError(`Source issue check failed: ${message}`);
}

function validIssueNumber(value) {
  return /^[1-9][0-9]*$/.test(value ?? '');
}

function validRepository(repository) {
  return /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository);
}

async function localRepository(execFileImpl, env) {
  if (env.GITHUB_REPOSITORY) return env.GITHUB_REPOSITORY;
  try {
    const { stdout } = await execFileImpl(
      'gh',
      ['repo', 'view', '--json', 'nameWithOwner', '--jq', '.nameWithOwner'],
      { env, encoding: 'utf8', windowsHide: true },
    );
    return stdout.trim();
  } catch {
    throw fail('unable to determine the current GitHub repository.');
  }
}

async function readLocalIssue(execFileImpl, env, issueNumber, repository) {
  try {
    const { stdout } = await execFileImpl(
      'gh',
      [
        'issue', 'view', issueNumber,
        '--repo', repository,
        '--json', 'state,url',
        '--jq', '[.state, .url] | @tsv',
      ],
      { env, encoding: 'utf8', windowsHide: true },
    );
    const [state, url] = stdout.trim().split(/\r?\n/, 1)[0].split('\t');
    return { state, url };
  } catch {
    throw fail(`issue #${issueNumber} could not be read in ${repository}.`);
  }
}

async function readApiIssue(fetchImpl, env, issueNumber, repository) {
  if (!env.GH_TOKEN) {
    throw fail('GitHub Actions did not provide an issue-read token.');
  }
  const endpoint = `https://api.github.com/repos/${repository}/issues/${issueNumber}`;
  let response;
  try {
    response = await fetchImpl(endpoint, {
      headers: {
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        Authorization: `Bearer ${env.GH_TOKEN}`,
      },
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const payload = await response.json();
    return { state: String(payload.state ?? '').toUpperCase(), url: payload.html_url };
  } catch {
    throw fail(`issue #${issueNumber} could not be read in ${repository}.`);
  }
}

export async function validateSourceIssue(
  issueNumber,
  {
    env = process.env,
    execFileImpl = execFileAsync,
    fetchImpl = globalThis.fetch,
  } = {},
) {
  if (!validIssueNumber(issueNumber)) {
    throw new SourceIssueValidationError('Usage: validate-source-issue.mjs <open-issue-number>', 2);
  }

  const repository = await localRepository(execFileImpl, env);
  if (!validRepository(repository)) throw fail('invalid repository identifier.');

  const issue = env.GITHUB_ACTIONS === 'true'
    ? await readApiIssue(fetchImpl, env, issueNumber, repository)
    : await readLocalIssue(execFileImpl, env, issueNumber, repository);

  if (issue.state !== 'OPEN') throw fail(`issue #${issueNumber} is not open.`);
  if (typeof issue.url !== 'string' || !issue.url.endsWith(`/issues/${issueNumber}`)) {
    throw fail(`#${issueNumber} is not a GitHub Issue in ${repository}.`);
  }
  return { issueNumber, repository, url: issue.url };
}

const isMainModule = process.argv[1]
  && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMainModule) {
  if (process.argv.length !== 3) {
    process.stderr.write(`Usage: ${path.basename(process.argv[1])} <open-issue-number>\n`);
    process.exitCode = 2;
  } else {
    try {
      const result = await validateSourceIssue(process.argv[2]);
      process.stdout.write(`Source issue #${result.issueNumber} is open in ${result.repository}.\n`);
    } catch (error) {
      process.stderr.write(`${error.message}\n`);
      process.exitCode = error.exitCode ?? 1;
    }
  }
}
