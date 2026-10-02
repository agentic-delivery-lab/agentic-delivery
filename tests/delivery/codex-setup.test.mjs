import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHash } from 'node:crypto';
import { chmod, mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { packageTreeSha256, verifyArchive, setupTarget, RELEASE } from '../../scripts/setup-runner-codex.mjs';

test('runner setup is pinned and fails closed on a changed download', () => {
  assert.match(RELEASE.version, /^\d+\.\d+\.\d+$/);
  assert.equal(RELEASE.url, `https://github.com/openai/codex/releases/download/rust-v${RELEASE.version}/codex-package-x86_64-unknown-linux-musl.tar.gz`);
  assert.match(RELEASE.sha256, /^[a-f0-9]{64}$/);
  assert.match(RELEASE.packageTreeSha256, /^[a-f0-9]{64}$/);
  const bytes = Buffer.from('fixture');
  const digest = createHash('sha256').update(bytes).digest('hex');
  verifyArchive(bytes, digest);
  assert.throws(() => verifyArchive(bytes, RELEASE.sha256), /checksum/);
});

test('runner setup can verify installed package contents independently of the archive marker', async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), 'codex-package-digest-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, 'bin'));
  await writeFile(path.join(root, 'bin', 'codex'), 'verified executable');
  const verified = await packageTreeSha256(root);
  await writeFile(path.join(root, '.release-sha256'), RELEASE.sha256);
  assert.equal(await packageTreeSha256(root), verified);
  if (process.platform !== 'win32') {
    await chmod(path.join(root, 'bin', 'codex'), 0o755);
    assert.notEqual(await packageTreeSha256(root), verified);
    await chmod(path.join(root, 'bin', 'codex'), 0o644);
  }
  await writeFile(path.join(root, 'bin', 'codex'), 'modified executable');
  assert.notEqual(await packageTreeSha256(root), verified);
});

test('runner setup only selects a dedicated Linux x64 cache directory', () => {
  assert.equal(setupTarget('/runner/cache', 'linux', 'x64'), `/runner/cache/codex-delivery/${RELEASE.version}`);
  assert.throws(() => setupTarget('/cache', 'win32', 'x64'), /Linux x64/);
  assert.throws(() => setupTarget('/cache', 'linux', 'arm64'), /Linux x64/);
  assert.throws(() => setupTarget('relative', 'linux', 'x64'), /absolute/);
  assert.throws(() => setupTarget('/', 'linux', 'x64'), /dedicated/);
});
