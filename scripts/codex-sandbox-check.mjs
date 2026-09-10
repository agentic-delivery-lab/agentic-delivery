import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createServer } from 'node:http';
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
let hostRequests = 0;
const hostServer = createServer((request, response) => { hostRequests++; response.end('host must remain unreachable'); });
await new Promise((resolve) => hostServer.listen(0, '127.0.0.1', resolve));
const hostUrl = `http://127.0.0.1:${hostServer.address().port}`;
try {
  await client.initialize();
  for (const profile of ['delivery-plan', 'delivery-edit', 'delivery-verify']) {
    const program = `
      const assert = require('node:assert/strict');
      const fs = require('node:fs');
      assert.equal(process.cwd(), ${JSON.stringify(workspace)});
      assert.equal(process.env.CODEX_HOME, undefined);
      assert.equal(process.env.GH_TOKEN, undefined);
      assert.equal(process.env.PUBLISH_TOKEN, undefined);
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
      // Try to bypass the proxy completely: the namespace must still prevent
      // direct external access. The test wrapper uses only loopback, not '*'.
      process.env.NO_PROXY = '*';
      process.env.no_proxy = '*';
      for (const key of ['HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'http_proxy', 'https_proxy', 'all_proxy']) delete process.env[key];
      (async () => {
        for (const url of ['https://example.com', ${JSON.stringify(hostUrl)}]) {
          await assert.rejects(fetch(url, {signal:AbortSignal.timeout(2000)}));
        }
        console.log('filesystem, environment, IPC and network boundary passed');
        process.exit(0);
      })().catch((error) => {console.error(error.message);process.exit(1);});
    `;
    const result = await client.exec(['node', '-e', program], workspace, 10_000, profile);
    assert.match(result, /boundary passed/);
    console.log(`${profile}: ${result.trim()}`);
  }
  assert.equal(hostRequests, 0);
} finally {
  await new Promise((resolve) => hostServer.close(resolve));
  await client.close();
  console.log(`Inspection fixture retained at ${root}.`);
}
