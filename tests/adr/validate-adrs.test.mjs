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

test('accepts the selected Authority references, including historical number gaps', async () => {
  assert.equal(await validateAdrs(repositoryRoot), 22);
});

test('rejects unindexed formal records from any decision family', async (t) => {
  for (const name of ['ADR-0025-local-policy.md', 'ADP-0002-local-policy.md', 'ADD-0002-local-policy.md']) {
    const fixture = await newFixture(t);
    await writeFile(path.join(fixture, 'docs/decisions', name), '# Unapproved local decision\n');
    await assert.rejects(validateAdrs(fixture), /unindexed decision-directory entry/);
  }
});

test('rejects added local decision prose in a consumer reference', async (t) => {
  const fixture = await newFixture(t);
  const record = path.join(fixture, 'docs/decisions/0001-use-madr-for-architecture-decisions.md');
  const source = await readFile(record, 'utf8');
  await writeFile(record, `${source}\n## Decision Outcome\nThis consumer's main branch owns the decision.\n`);

  await assert.rejects(validateAdrs(fixture), /must remain a reference only/);
});

test('rejects a missing indexed consumer reference rather than deleting a canonical decision', async (t) => {
  const fixture = await newFixture(t);
  await unlink(path.join(fixture, 'docs/decisions/0008-use-pnpm-with-delayed-dependency-adoption.md'));

  await assert.rejects(validateAdrs(fixture), /missing indexed reference/);
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

test('rejects a same-ID reference with a different repository, moving source or changed file hash', async (t) => {
  for (const change of [
    source => source.replace('"repositoryId":1380894616', '"repositoryId":1380894656'),
    source => source.replace('"commit":"0423533176ad6239fe5d828736605b5a6360293c"', '"commit":"main"'),
    source => source.replace(/"sha256":"[0-9a-f]{64}"/, `"sha256":"${'0'.repeat(64)}"`),
  ]) {
    const fixture = await newFixture(t);
    const record = path.join(fixture, 'docs/decisions/0001-use-madr-for-architecture-decisions.md');
    const source = await readFile(record, 'utf8');
    const changed = change(source);
    assert.notEqual(changed, source);
    await writeFile(record, changed);
    await assert.rejects(validateAdrs(fixture), /must remain a reference only/);
  }
});

test('rejects a changed source-index selection or an injected approval flag', async (t) => {
  for (const change of [
    (index) => { index.architecture.sourceCommit = 'f'.repeat(40); },
    (index) => { index.approved = true; },
  ]) {
    const fixture = await newFixture(t);
    const file = path.join(fixture, 'docs/decisions/authority-reference-index.json');
    const index = JSON.parse(await readFile(file, 'utf8'));
    change(index);
    await writeFile(file, `${JSON.stringify(index, null, 2)}\n`);
    await assert.rejects(validateAdrs(fixture), /reference index does not match/);
  }
});

test('rejects a local formal template substituted for the pinned template reference', async (t) => {
  const fixture = await newFixture(t);
  await writeFile(path.join(fixture, 'docs/decisions/adr-template.md'), '# New local ADR\n\n## Decision Outcome\n');
  await assert.rejects(validateAdrs(fixture), /must remain a reference to the selected Authority template/);
});

test('rejects missing canonical links, duplicate numbers, reserved numbers and invalid source links', async (t) => {
  const cases = [
    async (fixture) => {
      const record = path.join(fixture, 'docs/decisions/0001-use-madr-for-architecture-decisions.md');
      const source = await readFile(record, 'utf8');
      const windowsSource = source.replace(/\r?\n/g, '\r\n');
      await writeFile(record, windowsSource.replace(/^Canonical decision:.*\r?\n/m, ''));
      return /must remain a reference only/;
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
