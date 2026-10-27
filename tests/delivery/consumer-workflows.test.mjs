import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { promisify } from 'node:util';

import { parseRepositoryYaml } from '../../scripts/lib/yaml.mjs';

const repositoryRoot = path.resolve(import.meta.dirname, '../..');
const execFileAsync = promisify(execFile);

test('the reusable Architecture workflow writes a readable conformance request', async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'consumer-conformance-request-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const workflow = parseRepositoryYaml(await readFile(path.join(repositoryRoot,
    '.github/workflows/agentic-delivery-architecture-review.yml'), 'utf8'));
  const step = workflow.jobs['architecture-contract'].steps.find((entry) => (
    entry.name === 'Create the immutable conformance request'
  ));
  const inline = step.run.match(/node --input-type=module -e '([\s\S]+)'\s*$/);
  assert.ok(inline, 'The producer must expose its complete inline Node program.');
  const requestPath = path.join(directory, 'request.json');
  const identifiers = ['urn:agentic-delivery:architecture:authority'];
  await execFileAsync(process.execPath, ['--input-type=module', '-e', inline[1]], {
    cwd: directory,
    env: { ...process.env, REQUEST_PATH: requestPath, ARCHITECTURE_COMMIT: 'a'.repeat(40),
      ARCHITECTURE_DIGEST: 'b'.repeat(64), IMPLEMENTATION_COMMIT: 'c'.repeat(40),
      AFFECTED_IDENTIFIERS: JSON.stringify(identifiers) },
    timeout: 10_000,
  });
  assert.deepEqual(JSON.parse(await readFile(requestPath, 'utf8')), {
    schemaVersion: 1, architectureCommit: 'a'.repeat(40), architectureDigest: 'b'.repeat(64),
    implementationCommit: 'c'.repeat(40), affectedIdentifiers: identifiers,
  });
});
