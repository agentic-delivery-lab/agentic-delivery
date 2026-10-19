// agentic-primitive: {"id":"github-app-token-provider","kind":"script","enforcement":"deterministic","adrs":["ADR-0018"],"domains":["agentic-delivery-control-plane"]}
import { createPrivateKey, createSign } from 'node:crypto';

const ORGANIZATION_ISSUE_METADATA_READ_PERMISSIONS = Object.freeze({
  issue_fields: 'read',
  issue_types: 'read',
});

export const GITHUB_APP_TOKEN_PERMISSION_PROFILES = Object.freeze({
  invocationPreflight: Object.freeze({
    repositoryPermissions: Object.freeze({
      contents: 'read',
      issues: 'read',
      pull_requests: 'read',
      metadata: 'read',
    }),
    organizationPermissions: Object.freeze({}),
  }),
  readOnlyIntake: Object.freeze({
    repositoryPermissions: Object.freeze({
      contents: 'read',
      issues: 'read',
      pull_requests: 'read',
      metadata: 'read',
    }),
    organizationPermissions: ORGANIZATION_ISSUE_METADATA_READ_PERMISSIONS,
  }),
  activeIntake: Object.freeze({
    repositoryPermissions: Object.freeze({
      contents: 'read',
      issues: 'write',
      pull_requests: 'read',
      metadata: 'read',
    }),
    organizationPermissions: ORGANIZATION_ISSUE_METADATA_READ_PERMISSIONS,
  }),
  delivery: Object.freeze({
    repositoryPermissions: Object.freeze({
      contents: 'write',
      issues: 'write',
      pull_requests: 'write',
    }),
    organizationPermissions: ORGANIZATION_ISSUE_METADATA_READ_PERMISSIONS,
  }),
});

export function githubAppTokenPermissions(profileName) {
  const profile = GITHUB_APP_TOKEN_PERMISSION_PROFILES[profileName];
  if (!profile) throw new Error(`Unknown GitHub App token permission profile: ${profileName}`);
  return { ...profile.repositoryPermissions, ...profile.organizationPermissions };
}

function base64url(value) {
  return Buffer.from(value).toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

export function createGithubAppJwt({ appId, privateKey, now = Date.now() }) {
  const issuedAt = Math.floor(now / 1000) - 30;
  const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const payload = base64url(JSON.stringify({ iat: issuedAt, exp: issuedAt + 540, iss: String(appId) }));
  const signer = createSign('RSA-SHA256');
  signer.update(`${header}.${payload}`);
  signer.end();
  return `${header}.${payload}.${base64url(signer.sign(createPrivateKey(privateKey)))}`;
}

function appError(route, response) {
  const error = new Error(`GitHub App request ${route} failed (${response.status}).`);
  error.status = response.status;
  return error;
}

export class GithubAppTokenProvider {
  constructor({ repository, appId, privateKey, installationId, permissions = {}, fetchImpl = fetch, now = () => Date.now(), requestTimeoutMs = () => 30_000 } = {}) {
    if (!repository || !/^\d+$/.test(String(appId ?? '')) || !privateKey) throw new Error('GitHub App repository, numeric app ID, and private key are required.');
    this.repository = repository;
    this.appId = appId;
    this.privateKey = privateKey;
    this.installationId = installationId;
    this.permissions = permissions;
    this.fetchImpl = fetchImpl;
    this.now = now;
    this.requestTimeoutMs = requestTimeoutMs;
    this.pendingIssuance = new Set();
    this.cachedTokens = new Map();
    this.revocationUnconfirmed = false;
    this.issuedTokens = new Set();
  }

  async request(route, method, token, body) {
    // Revocation is cleanup: it remains possible after execution time expires.
    const remainingMs = method === 'DELETE' ? 30_000 : this.requestTimeoutMs();
    if (!Number.isSafeInteger(remainingMs) || remainingMs < 1) throw new Error('GitHub App request has no admitted execution time remaining.');
    const mint = method === 'POST' && /^\/app\/installations\/[1-9][0-9]*\/access_tokens$/.test(route);
    const pending = mint ? Symbol('installation-token-request') : null;
    if (pending) this.pendingIssuance.add(pending);
    const response = await this.fetchImpl(`https://api.github.com${route}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2026-03-10',
        'Content-Type': 'application/json',
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(Math.min(30_000, remainingMs)),
    });
    if (!response.ok) throw appError(route, response);
    const result = response.status === 204 ? null : await response.json();
    // Register a returned token before validating its other metadata, so a
    // malformed success response still permits revocation of the known token.
    if (pending && typeof result?.token === 'string' && result.token) {
      this.issuedTokens.add(result.token);
      this.pendingIssuance.delete(pending);
    }
    return result;
  }

  async token({ repositoryIds = [], permissions = this.permissions, allowInstallationWide = false } = {}) {
    if (this.pendingIssuance.size > 0 || this.revocationUnconfirmed) throw new Error('Prior GitHub App issuance or revocation is uncertain; reconcile before minting another token.');
    const narrowedIds = [...new Set((Array.isArray(repositoryIds) ? repositoryIds : [repositoryIds])
      .map((value) => String(value))
      .filter((value) => /^[1-9][0-9]*$/.test(value)))].sort();
    if (narrowedIds.length === 0 && allowInstallationWide !== true) {
      throw new Error('A repository-scoped installation token is required; an installation-wide token needs an explicit non-production test opt-in.');
    }
    const requestedPermissions = permissions && typeof permissions === 'object' ? permissions : this.permissions;
    const cacheKey = `${narrowedIds.join(',')}|${JSON.stringify(requestedPermissions ?? {})}`;
    const cached = this.cachedTokens.get(cacheKey);
    if (cached && cached.expiresAt - this.now() > 90_000) return cached.value;
    const appJwt = createGithubAppJwt({ appId: this.appId, privateKey: this.privateKey, now: this.now() });
    let installationId = this.installationId;
    if (!installationId) {
      const installation = await this.request(`/repos/${this.repository}/installation`, 'GET', appJwt);
      installationId = installation?.id;
    }
    if (!/^[1-9][0-9]*$/.test(String(installationId ?? ''))) throw new Error('GitHub App installation ID is invalid or unavailable.');
    const body = { permissions: requestedPermissions ?? {} };
    if (narrowedIds.length > 0) body.repository_ids = narrowedIds;
    const result = await this.request(`/app/installations/${installationId}/access_tokens`, 'POST', appJwt, body);
    if (typeof result?.token !== 'string' || !result.token || !Number.isFinite(Date.parse(result.expires_at))) throw new Error('GitHub App did not return a valid installation token and expiry.');
    this.issuedTokens.add(result.token);
    this.cachedTokens.set(cacheKey, { value: result.token, expiresAt: Date.parse(result.expires_at) });
    return result.token;
  }

  async revoke() {
    const tokens = new Set([...this.issuedTokens, ...[...this.cachedTokens.values()].map(({ value }) => value)]);
    this.cachedTokens.clear();
    this.issuedTokens.clear();
    for (const value of tokens) {
      try { await this.request('/installation/token', 'DELETE', value); } catch { this.revocationUnconfirmed = true; }
    }
    return !this.revocationUnconfirmed && this.pendingIssuance.size === 0;
  }
}

export function appConfiguration(env = process.env) {
  return {
    appId: env.CODEX_DELIVERY_APP_ID,
    privateKey: env.CODEX_DELIVERY_APP_PRIVATE_KEY,
    installationId: env.CODEX_DELIVERY_APP_INSTALLATION_ID,
  };
}
