import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { test } from 'node:test';

import { githubAppTokenPermissions, GithubAppTokenProvider } from '../../scripts/lib/github-app.mjs';

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
  assert.equal(await provider.token({ allowInstallationWide: true }), 'installation-1');
  assert.equal(await provider.token({ allowInstallationWide: true }), 'installation-1');
  now += 3_550_000;
  assert.equal(await provider.token({ allowInstallationWide: true }), 'installation-2');
  assert.equal(requests, 2);
});

test('GitHub App provider rejects an unscoped token unless a test opts in explicitly', async () => {
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const provider = new GithubAppTokenProvider({
    repository: 'owner/repo', appId: '123', privateKey: privateKey.export({ type: 'pkcs8', format: 'pem' }),
    installationId: '456', fetchImpl: async () => { throw new Error('unscoped token must fail before API access'); },
  });
  await assert.rejects(provider.token(), /repository-scoped installation token/);
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

test('GitHub App provider applies the active intake profile with the origin repository restriction', async () => {
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const permissions = githubAppTokenPermissions('activeIntake');
  let requestBody;
  const provider = new GithubAppTokenProvider({
    repository: 'agentic-delivery-lab/agentic-delivery',
    appId: '123',
    privateKey: privateKey.export({ type: 'pkcs8', format: 'pem' }),
    installationId: '456',
    permissions,
    fetchImpl: async (url, options) => {
      requestBody = JSON.parse(options.body);
      return new Response(JSON.stringify({ token: 'origin-scoped', expires_at: '2026-09-10T13:00:00Z' }), { status: 201 });
    },
    now: () => Date.parse('2026-09-10T12:00:00Z'),
  });

  assert.equal(await provider.token({ repositoryIds: ['777777777'] }), 'origin-scoped');
  assert.deepEqual(requestBody, { permissions, repository_ids: ['777777777'] });
});

test('revocation reports partial failure while still attempting every issued token', async () => {
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const attempted = [];
  const provider = new GithubAppTokenProvider({ repository: 'owner/repo', appId: '123', privateKey: privateKey.export({ type: 'pkcs8', format: 'pem' }),
    fetchImpl: async (_url, options) => {
      attempted.push(options.headers.Authorization);
      return new Response(null, { status: attempted.length === 1 ? 503 : 204 });
    },
  });
  provider.cachedTokens.set('first', { value: 'first-token' });
  provider.cachedTokens.set('second', { value: 'second-token' });
  assert.equal(await provider.revoke(), false);
  assert.equal(attempted.length, 2);
  assert.equal(provider.cachedTokens.size, 0);
  assert.equal(await provider.revoke(), false, 'a later empty call cannot erase an unconfirmed revocation');
});


test('revocation includes a near-expiry token replaced by refresh', async () => {
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  let now = 100000; let minted = 0; const revoked = [];
  const provider = new GithubAppTokenProvider({ repository: 'owner/repo', appId: '123', installationId: '456',
    privateKey: privateKey.export({ type: 'pkcs8', format: 'pem' }), now: () => now,
    fetchImpl: async (url, options) => {
      if (url.endsWith('/access_tokens')) return new Response(JSON.stringify({ token: `token-${++minted}`, expires_at: new Date(now + 120000).toISOString() }), { status: 201 });
      revoked.push(options.headers.Authorization); return new Response(null, { status: 204 });
    },
  });
  await provider.token({ repositoryIds: ['101'] }); now += 70000;
  await provider.token({ repositoryIds: ['101'] });
  assert.equal(await provider.revoke(), true);
  assert.deepEqual(revoked, ['Bearer token-1', 'Bearer token-2']);
});
