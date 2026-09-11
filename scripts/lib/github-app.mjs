// agentic-primitive: {"id":"github-app-token-provider","kind":"script","enforcement":"deterministic","adrs":["ADR-0014"],"domains":["agentic-delivery-governance"]}
import { createPrivateKey, createSign } from 'node:crypto';

function base64url(value) {
  return Buffer.from(value).toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

function jwt({ appId, privateKey, now = Date.now() }) {
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
  constructor({ repository, appId, privateKey, installationId, permissions = {}, fetchImpl = fetch, now = () => Date.now() } = {}) {
    if (!repository || !/^\d+$/.test(String(appId ?? '')) || !privateKey) throw new Error('GitHub App repository, numeric app ID, and private key are required.');
    this.repository = repository;
    this.appId = appId;
    this.privateKey = privateKey;
    this.installationId = installationId;
    this.permissions = permissions;
    this.fetchImpl = fetchImpl;
    this.now = now;
    this.cached = null;
  }

  async request(route, method, token, body) {
    const response = await this.fetchImpl(`https://api.github.com${route}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'Content-Type': 'application/json',
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) throw appError(route, response);
    return response.status === 204 ? null : response.json();
  }

  async token() {
    if (this.cached && this.cached.expiresAt - this.now() > 90_000) return this.cached.value;
    const appJwt = jwt({ appId: this.appId, privateKey: this.privateKey, now: this.now() });
    let installationId = this.installationId;
    if (!installationId) {
      const installation = await this.request(`/repos/${this.repository}/installation`, 'GET', appJwt);
      installationId = installation?.id;
    }
    if (!/^[1-9][0-9]*$/.test(String(installationId ?? ''))) throw new Error('GitHub App installation ID is invalid or unavailable.');
    const result = await this.request(`/app/installations/${installationId}/access_tokens`, 'POST', appJwt, { permissions: this.permissions });
    if (!result?.token || !result.expires_at) throw new Error('GitHub App did not return an installation token.');
    this.cached = { value: result.token, expiresAt: Date.parse(result.expires_at) };
    return result.token;
  }

  async revoke() {
    if (!this.cached) return;
    const token = this.cached.value;
    this.cached = null;
    try { await this.request('/installation/token', 'DELETE', token); } catch { /* best effort; never hide delivery result */ }
  }
}

export function appConfiguration(env = process.env) {
  return {
    appId: env.CODEX_DELIVERY_APP_ID,
    privateKey: env.CODEX_DELIVERY_APP_PRIVATE_KEY,
    installationId: env.CODEX_DELIVERY_APP_INSTALLATION_ID,
  };
}
