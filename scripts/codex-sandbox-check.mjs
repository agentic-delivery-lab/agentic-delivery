import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { CodexClient } from './lib/codex-client.mjs';

// Opt-in, zero-generation runtime check; no real credential contents are read.
const root = await mkdtemp(path.join(tmpdir(), 'codex-delivery-boundary-'));
const workspace = path.join(root, 'workspace');
const sentinel = path.join(root, 'outside-sentinel');
await mkdir(workspace);
await promisify(execFile)('git', ['init', '--initial-branch=main', workspace]);
await mkdir(path.join(workspace, '.codex'));
await writeFile(path.join(workspace, '.codex', 'marker'), 'protected');
await writeFile(path.join(workspace, 'probe.txt'), 'workspace');
await writeFile(sentinel, 'must stay outside the model boundary');
const client = new CodexClient({cwd:workspace});
try {
  await client.initialize();
  for (const profile of ['delivery-plan', 'delivery-edit', 'delivery-verify']) {
    const program = `
      const assert = require('node:assert/strict');
      const fs = require('node:fs');
      assert.equal(process.cwd(), ${JSON.stringify(workspace)});
      assert.equal(process.env.CODEX_HOME, undefined);
      assert.equal(process.env.GH_TOKEN, undefined);
      assert.equal(process.env.OPENAI_API_KEY, undefined);
      assert.ok(fs.readFileSync('probe.txt', 'utf8'));
      assert.throws(() => fs.readFileSync(${JSON.stringify(sentinel)}));
      for (const file of ['.git/config', '.codex/marker']) {
        assert.throws(() => fs.appendFileSync(file, 'tamper'));
      }
      if (${JSON.stringify(profile)} === 'delivery-edit') fs.writeFileSync('probe.txt', 'edited');
      else assert.throws(() => fs.writeFileSync('probe.txt', 'tamper'));
      const child = require('node:child_process').spawnSync(process.execPath,
        ['-e', 'console.error("captured");'], {encoding:'utf8'});
      assert.equal(child.status, 0);
      assert.equal(child.error, undefined);
      assert.equal(child.stderr.trim(), 'captured');
      fetch('https://example.com', {signal:AbortSignal.timeout(2000)})
        .then(() => {console.error('Unexpected external network access');process.exit(1);},
          () => {console.log('filesystem, environment, IPC and network boundary passed');process.exit(0);});
    `;
    const result = await client.exec(['node', '-e', program], workspace, 10_000, profile);
    assert.match(result, /boundary passed/);
    console.log(`${profile}: ${result.trim()}`);
  }
} finally {
  await client.close();
  console.log(`Inspection fixture retained at ${root}.`);
}
