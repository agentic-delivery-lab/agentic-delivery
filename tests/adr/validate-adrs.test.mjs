import assert from 'node:assert/strict';
import { cp, mkdtemp, readFile, rm, unlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import { validateAdrs } from '../../scripts/validate-adrs.mjs';
import { runNodeScript } from '../helpers/process.mjs';

const repositoryRoot = path.resolve(import.meta.dirname, '../..');
const sourceDecisions = path.join(repositoryRoot, 'docs', 'decisions');
const validator = path.join(repositoryRoot, 'scripts', 'validate-adrs.mjs');

async function newFixture(t) {
  const fixture = await mkdtemp(path.join(os.tmpdir(), 'agentic-delivery-adr-'));
  await cp(sourceDecisions, path.join(fixture, 'docs', 'decisions'), { recursive: true });
  t.after(() => rm(fixture, { recursive: true, force: true }));
  return fixture;
}

test('accepts the repository ADR set', async () => {
  assert.equal(await validateAdrs(repositoryRoot), 15);
});

test('accepts historical ADR number gaps after a record is removed', async (t) => {
  const fixture = await newFixture(t);
  await unlink(path.join(fixture, 'docs/decisions/0008-use-pnpm-with-delayed-dependency-adoption.md'));

  assert.equal(await validateAdrs(fixture), 14);
});

test('rejects ADRs that define status in frontmatter', async (t) => {
  const fixture = await newFixture(t);
  const record = path.join(fixture, 'docs/decisions/0001-use-madr-for-architecture-decisions.md');
  const source = await readFile(record, 'utf8');
  await writeFile(record, source.replace(/^date:/m, 'status: proposed\ndate:'));

  await assert.rejects(validateAdrs(fixture), (error) => {
    assert.equal(error.exitCode, 1);
    assert.match(error.message, /must not define status/);
    return true;
  });
});

test('rejects missing required headings, duplicate record numbers, zero record numbers and invalid source links', async (t) => {
  const cases = [
    async (fixture) => {
      const record = path.join(fixture, 'docs/decisions/0001-use-madr-for-architecture-decisions.md');
      const source = await readFile(record, 'utf8');
      const windowsSource = source.replace(/\r?\n/g, '\r\n');
      await writeFile(record, windowsSource.replace(/^### Confirmation\r?\n/m, ''));
      return /missing required heading: ### Confirmation/;
    },
    async (fixture) => {
      await cp(
        path.join(sourceDecisions, '0001-use-madr-for-architecture-decisions.md'),
        path.join(fixture, 'docs/decisions/0001-duplicate.md'),
      );
      return /reuses ADR number 0001/;
    },
    async (fixture) => {
      await renameRecord(fixture, '0001-use-madr-for-architecture-decisions.md', '0000-use-madr-for-architecture-decisions.md');
      return /uses reserved ADR number 0000/;
    },
    async (fixture) => {
      const record = path.join(fixture, 'docs/decisions/0001-use-madr-for-architecture-decisions.md');
      const source = await readFile(record, 'utf8');
      await writeFile(record, source.replace(/^source-issue:.*$/m, 'source-issue: not-a-github-issue'));
      return /has no valid GitHub source-issue URL/;
    },
  ];

  for (const arrange of cases) {
    const fixture = await newFixture(t);
    const expected = await arrange(fixture);
    await assert.rejects(validateAdrs(fixture), expected);
  }
});

test('returns usage and missing-root failures with exit code 2', async () => {
  const usage = await runNodeScript(validator, ['one', 'two'], { cwd: repositoryRoot });
  assert.equal(usage.status, 2);
  assert.match(usage.stderr, /Usage:/);

  const missing = await runNodeScript(validator, ['/tmp/agentic-delivery-no-such-root'], { cwd: repositoryRoot });
  assert.equal(missing.status, 2);
  assert.match(missing.stderr, /repository root does not exist/);
});

async function renameRecord(fixture, from, to) {
  const { rename } = await import('node:fs/promises');
  await rename(path.join(fixture, 'docs/decisions', from), path.join(fixture, 'docs/decisions', to));
}
