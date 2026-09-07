import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHash } from 'node:crypto';
import { verifyArchive, setupTarget, RELEASE } from '../../scripts/setup-runner-codex.mjs';

test('runner setup is pinned and fails closed on a changed download', () => {
  assert.equal(RELEASE.version, '0.153.4');
  const bytes = Buffer.from('fixture');
  const digest = createHash('sha256').update(bytes).digest('hex');
  verifyArchive(bytes, digest);
  assert.throws(() => verifyArchive(bytes, RELEASE.sha256), /checksum/);
});

test('runner setup only selects a dedicated Linux x64 cache directory', () => {
  assert.equal(setupTarget('/runner/cache', 'linux', 'x64'), '/runner/cache/codex-delivery/0.153.4');
  assert.throws(() => setupTarget('/cache', 'win32', 'x64'), /Linux x64/);
  assert.throws(() => setupTarget('/cache', 'linux', 'arm64'), /Linux x64/);
  assert.throws(() => setupTarget('relative', 'linux', 'x64'), /absolute/);
  assert.throws(() => setupTarget('/', 'linux', 'x64'), /dedicated/);
});
