import assert from 'node:assert/strict';
import path from 'node:path';
import { test } from 'node:test';

import { validateSourceIssue } from '../../scripts/validate-source-issue.mjs';
import { runNodeScript } from '../helpers/process.mjs';

const repositoryRoot = path.resolve(import.meta.dirname, '../..');
const validator = path.join(repositoryRoot, 'scripts/validate-source-issue.mjs');
const repository = 'sjefsharp/agentic-delivery';

function localGh(stdout, { fail = false } = {}) {
  return async (_command, args) => {
    if (fail) throw new Error('gh failed');
    if (args[0] === 'repo') return { stdout: `${repository}\n` };
    const issueNumber = args[2];
    const issues = {
      11: `OPEN\thttps://github.com/${repository}/issues/11\n`,
      12: `OPEN\thttps://github.com/${repository}/issues/12\n`,
      13: `CLOSED\thttps://github.com/${repository}/issues/13\n`,
      14: `OPEN\thttps://github.com/${repository}/pull/14\n`,
    };
    if (stdout !== undefined) return { stdout };
    if (!issues[issueNumber]) throw new Error('not found');
    return { stdout: issues[issueNumber] };
  };
}

test('accepts an open issue and an open sub-issue through local gh', async () => {
  for (const issueNumber of ['11', '12']) {
    const result = await validateSourceIssue(issueNumber, {
      env: {},
      execFileImpl: localGh(),
    });
    assert.equal(result.repository, repository);
  }
});

test('rejects closed, pull-request, missing and unreadable local issues with exit code 1', async () => {
  for (const issueNumber of ['13', '14', '99']) {
    await assert.rejects(
      validateSourceIssue(issueNumber, { env: {}, execFileImpl: localGh() }),
      (error) => error.exitCode === 1,
    );
  }
  await assert.rejects(
    validateSourceIssue('11', { env: {}, execFileImpl: localGh(undefined, { fail: true }) }),
    /unable to determine the current GitHub repository/,
  );
});

test('uses the GitHub REST API in Actions and requires the issue-read token', async () => {
  const payloads = new Map([
    ['15', { state: 'open', html_url: `https://github.com/${repository}/issues/15` }],
    ['16', { state: 'closed', html_url: `https://github.com/${repository}/issues/16` }],
    ['17', { state: 'open', html_url: `https://github.com/${repository}/pull/17` }],
  ]);
  const fetchImpl = async (url, options) => {
    assert.equal(options.headers.Authorization, 'Bearer test-token');
    const issueNumber = url.split('/').at(-1);
    const payload = payloads.get(issueNumber);
    if (!payload) return { ok: false, status: 503 };
    return { ok: true, status: 200, json: async () => payload };
  };
  const env = { GITHUB_ACTIONS: 'true', GH_TOKEN: 'test-token', GITHUB_REPOSITORY: repository };

  assert.equal((await validateSourceIssue('15', { env, fetchImpl })).url.endsWith('/issues/15'), true);
  for (const issueNumber of ['16', '17', '99']) {
    await assert.rejects(validateSourceIssue(issueNumber, { env, fetchImpl }), (error) => error.exitCode === 1);
  }
  await assert.rejects(
    validateSourceIssue('15', { env: { ...env, GH_TOKEN: '' }, fetchImpl }),
    /did not provide an issue-read token/,
  );
});

test('rejects an invalid repository identifier before reading the issue', async () => {
  await assert.rejects(
    validateSourceIssue('11', {
      env: { GITHUB_REPOSITORY: 'not-a-repository' },
      execFileImpl: localGh(),
    }),
    /invalid repository identifier/,
  );
});

test('returns exit code 2 for invalid source-issue usage', async () => {
  const result = await runNodeScript(validator, ['0'], { cwd: repositoryRoot });
  assert.equal(result.status, 2);
  assert.match(result.stderr, /Usage:/);
});
