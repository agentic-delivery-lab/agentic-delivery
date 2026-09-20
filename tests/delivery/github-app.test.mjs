import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { test } from 'node:test';

import { GithubAppTokenProvider } from '../../scripts/lib/github-app.mjs';

test('GitHub App provider mints scoped installation tokens and refreshes near expiry', async () => {
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  let requests = 0;
  let now = Date.parse('2026-09-10T12:00:00Z');
  const fetchImpl = async (url, options) => {
    requests += 1;
    assert.match(options.headers.Authorization, /^Bearer /);
    if (url.endsWith('/access_tokens')) {
      const body = JSON.parse(options.body);
      assert.deepEqual(body.permissions, { contents: 'write', issues: 'write' });
      return new Response(JSON.stringify({ token: `installation-${requests}`, expires_at: new Date(now + 3_600_000).toISOString() }), { status: 201 });
    }
    throw new Error(`unexpected App route: ${url}`);
  };
  const provider = new GithubAppTokenProvider({
    repository: 'owner/repo', appId: '123', privateKey: privateKey.export({ type: 'pkcs8', format: 'pem' }), installationId: '456',
    permissions: { contents: 'write', issues: 'write' }, fetchImpl, now: () => now,
  });
  assert.equal(await provider.token(), 'installation-1');
  assert.equal(await provider.token(), 'installation-1');
  now += 3_550_000;
  assert.equal(await provider.token(), 'installation-2');
  assert.equal(requests, 2);
});

test('GitHub App provider can narrow an installation token to repository IDs', async () => {
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  let requestBody;
  const provider = new GithubAppTokenProvider({
    repository: 'agentic-delivery-lab/agentic-delivery',
    appId: '123',
    privateKey: privateKey.export({ type: 'pkcs8', format: 'pem' }),
    installationId: '456',
    permissions: { metadata: 'read' },
    fetchImpl: async (url, options) => {
      requestBody = JSON.parse(options.body);
      return new Response(JSON.stringify({ token: 'scoped', expires_at: '2026-09-10T13:00:00Z' }), { status: 201 });
    },
    now: () => Date.parse('2026-09-10T12:00:00Z'),
  });

  assert.equal(await provider.token({ repositoryIds: ['777777777'] }), 'scoped');
  assert.deepEqual(requestBody.repository_ids, ['777777777']);
});
