// agentic-primitive: {"id":"pull-request-dispatch-context-resolver","kind":"validator","enforcement":"deterministic","adrs":["ADR-0009","ADR-0016"],"domains":["agentic-delivery-governance"]}
import { randomUUID } from 'node:crypto';
import { appendFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

function requireValue(value, name) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${name} is required.`);
  return value.trim();
}

async function writeOutput(name, value) {
  const outputPath = requireValue(process.env.GITHUB_OUTPUT, 'GITHUB_OUTPUT');
  const delimiter = `ghadelimiter_${randomUUID()}`;
  await appendFile(outputPath, `${name}<<${delimiter}\n${String(value ?? '')}\n${delimiter}\n`);
}

export async function resolvePullRequestContext({
  number = process.env.PULL_REQUEST_NUMBER,
  env = process.env,
  fetchImpl = globalThis.fetch,
} = {}) {
  if (!/^[1-9]\d*$/.test(String(number ?? ''))) throw new Error('A positive pull request number is required.');
  const repository = requireValue(env.GITHUB_REPOSITORY, 'GITHUB_REPOSITORY');
  const token = requireValue(env.GH_TOKEN, 'GH_TOKEN');
  const endpoint = `https://api.github.com/repos/${repository}/pulls/${number}`;
  let response;
  try {
    response = await fetchImpl(endpoint, {
      headers: {
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2026-03-10',
        Authorization: `Bearer ${token}`,
      },
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    throw new Error('The pull request context could not be read from GitHub.');
  }
  if (!response.ok) throw new Error(`The pull request context could not be read from GitHub (HTTP ${response.status}).`);
  const pullRequest = await response.json();
  if (pullRequest.state !== 'open'
    || pullRequest.base?.ref !== 'main'
    || pullRequest.base?.repo?.full_name !== repository
    || pullRequest.head?.repo?.full_name !== repository
    || !/^[0-9a-f]{40}$/.test(pullRequest.base?.sha ?? '')
    || !/^[0-9a-f]{40}$/.test(pullRequest.head?.sha ?? '')) {
    throw new Error('The target must be an open, same-repository pull request against main.');
  }

  if (env.PULL_REQUEST_REQUIRE_CHECKOUT_MATCH !== 'false'
    && (pullRequest.head.sha !== env.GITHUB_SHA || pullRequest.head.ref !== env.GITHUB_REF_NAME)) {
    throw new Error('The checked-out revision does not match the pull request head.');
  }

  const eventPath = path.join(requireValue(env.RUNNER_TEMP, 'RUNNER_TEMP'), `pull-request-event-${number}.json`);
  await mkdir(path.dirname(eventPath), { recursive: true });
  await writeFile(eventPath, `${JSON.stringify({ repository: { full_name: repository }, pull_request: pullRequest }, null, 2)}\n`, { mode: 0o600 });

  for (const [name, value] of [
    ['number', String(pullRequest.number)],
    ['base_sha', pullRequest.base.sha],
    ['head_sha', pullRequest.head.sha],
    ['head_ref', pullRequest.head.ref],
    ['title', pullRequest.title ?? ''],
    ['author', pullRequest.user?.login ?? ''],
    ['body', pullRequest.body ?? ''],
    ['event_path', eventPath],
  ]) await writeOutput(name, value);

  return { number: pullRequest.number, baseSha: pullRequest.base.sha, headSha: pullRequest.head.sha, headRef: pullRequest.head.ref, eventPath };
}

const isMainModule = process.argv[1]
  && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMainModule) {
  try {
    const result = await resolvePullRequestContext({ number: process.argv[2] });
    process.stdout.write(`Resolved open pull request #${result.number} at ${result.headSha}.\n`);
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}
