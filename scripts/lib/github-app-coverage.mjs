// agentic-primitive: {"id":"github-app-coverage-observation","kind":"script","enforcement":"deterministic","adrs":["ADR-0018"],"domains":["agentic-delivery-control-plane"]}
import { execFile } from 'node:child_process';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { promisify } from 'node:util';

import appContract from '../../config/github-app-contract.json' with { type: 'json' };
import actorCatalog from '../../config/agent-actors.json' with { type: 'json' };
import { createGithubAppJwt, GithubAppTokenProvider } from './github-app.mjs';

const execFileAsync = promisify(execFile);
const root = path.resolve(import.meta.dirname, '../..');
const organization = 'agentic-delivery-lab';
const organizationId = 327861320;
const appId = 5011055;
const installationId = 163255060;
const appSlug = actorCatalog.bot_login.replace(/\[bot\]$/, '');
const allowanceMs = 180_000;
const metadataPermissions = Object.freeze({ metadata: 'read' });
// Bounded administrative read scope, not a second enrollment or identity registry.
// Each expected identity is checked against native token-scoped repository metadata.
const targets = Object.freeze([
  [1358455028, 'agentic-delivery'], [1380894616, 'agentic-delivery-architecture'],
  [1380894656, 'agentic-delivery-agent-customizations'], [1380894705, 'agentic-delivery-distribution'],
  [1368850419, '.github'], [1380894756, '.github-private'], [1416207421, 'agentic-delivery-requirements'],
].map(([repositoryId, name]) => Object.freeze({ repositoryId, fullName: `${organization}/${name}` })));

class CoverageHold extends Error {
  constructor(code) { super(code); this.code = code; }
}

async function currentSourceCommit() {
  const { stdout } = await execFileAsync('git', ['--no-lazy-fetch', '--no-replace-objects', '-c', 'core.fsmonitor=false', '-C', root, 'rev-parse', 'HEAD'], {
    encoding: 'utf8', timeout: 5_000, maxBuffer: 1024, windowsHide: true,
  });
  return stdout.trim();
}

function validateOwnerEnvironment(env) {
  if (env.GITHUB_ACTIONS !== 'true' || env.GITHUB_EVENT_NAME !== 'workflow_dispatch'
      || env.GITHUB_ACTOR_ID !== '14937399' || env.GITHUB_REPOSITORY_ID !== '1358455028'
      || typeof env.GITHUB_ACTOR !== 'string' || !env.GITHUB_ACTOR || env.GITHUB_TRIGGERING_ACTOR !== env.GITHUB_ACTOR
      || env.GITHUB_REPOSITORY !== appContract.controller?.repository || env.GITHUB_REF !== 'refs/heads/main'
      || !/^[0-9a-f]{40}$/.test(env.GITHUB_SHA ?? '')
      || !/^[1-9][0-9]*$/.test(env.GITHUB_RUN_ID ?? '') || !/^[1-9][0-9]*$/.test(env.GITHUB_RUN_ATTEMPT ?? '')) {
    throw new Error('App coverage requires the owner-only trusted main workflow.');
  }
}

function observedInstallation(value) {
  if (value?.id !== installationId || value.app_id !== appId || value.app_slug !== appSlug
      || value.account?.id !== organizationId || value.account.login?.toLowerCase() !== organization
      || value.account.type !== 'Organization' || value.target_id !== organizationId || value.target_type !== 'Organization'
      || !['all', 'selected'].includes(value.repository_selection) || value.suspended_at !== null
      || !value.permissions || typeof value.permissions !== 'object' || Array.isArray(value.permissions)
      || value.permissions.metadata !== 'read'
      || Object.keys(value.permissions).length > 64
      || Object.entries(value.permissions).some(([key, level]) => !/^[a-z_]{1,64}$/.test(key) || !['read', 'write', 'admin'].includes(level))) {
    throw new CoverageHold('unexpected-installation-metadata');
  }
  return { id: value.id, appId: value.app_id, organizationId: value.account.id, repositorySelection: value.repository_selection, permissions: { ...value.permissions } };
}

function assertRepository(value, target) {
  if (value?.id !== target.repositoryId || typeof value.full_name !== 'string'
      || value.full_name.toLowerCase() !== target.fullName || value.owner?.id !== organizationId
      || value.owner.login?.toLowerCase() !== organization) throw new CoverageHold('repository-identity-or-scope-mismatch');
}

function assertToken(value, target, now) {
  const expiry = Date.parse(value?.expires_at);
  if (typeof value?.token !== 'string' || !value.token || !Number.isFinite(expiry) || expiry <= now()
      || !value.permissions || Object.keys(value.permissions).length !== 1 || value.permissions.metadata !== 'read') {
    throw new CoverageHold('unexpected-token-metadata');
  }
  if (value.repositories !== undefined) {
    if (!Array.isArray(value.repositories) || value.repositories.length !== 1) throw new CoverageHold('unexpected-token-repository-scope');
    assertRepository(value.repositories[0], target);
  }
}

function safeReason(error) {
  if (error instanceof CoverageHold) return error.code;
  if (Number.isInteger(error?.status) && error.status >= 100 && error.status <= 599) return `github-http-${error.status}`;
  return 'audit-request-unavailable';
}

async function boundedResponse(response) {
  if (!response.ok) await response.body?.cancel().catch(() => {});
  return {
    ok: response.ok, status: response.status,
    async json() {
      const chunks = []; let bytes = 0; let complete = false;
      const reader = response.body?.getReader();
      if (!reader) throw new CoverageHold('missing-response-body');
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) { complete = true; break; }
          bytes += value.byteLength;
          if (bytes > 1024 * 1024) throw new CoverageHold('oversized-response');
          chunks.push(value);
        }
        return JSON.parse(Buffer.concat(chunks).toString('utf8'));
      } finally {
        if (!complete) await reader.cancel().catch(() => {});
        reader.releaseLock();
      }
    },
  };
}

export async function collectGithubAppCoverage({ env = process.env, fetchImpl = fetch, now = () => Date.now(), monotonic = () => performance.now(), getSourceCommit = currentSourceCommit } = {}) {
  validateOwnerEnvironment(env); // Before reading the App key or starting any request.
  const started = monotonic();
  if (env.APP_COVERAGE_SOURCE_COMMIT !== env.GITHUB_SHA) throw new Error('App coverage source binding does not match the selected commit.');
  const sourceCommit = await getSourceCommit();
  if (sourceCommit !== env.GITHUB_SHA) throw new Error('App coverage source commit does not match the trusted workflow.');
  if (env.CODEX_DELIVERY_APP_ID !== String(appId) || env.CODEX_DELIVERY_APP_INSTALLATION_ID !== String(installationId)
      || appContract.controller?.repository !== targets[0].fullName
      || appContract.organization?.id !== String(organizationId) || appContract.organization?.login !== organization) {
    throw new Error('App configuration does not match the reviewed coverage scope.');
  }
  const privateKey = env.CODEX_DELIVERY_APP_PRIVATE_KEY;
  if (typeof privateKey !== 'string' || !privateKey) throw new Error('App configuration is unavailable for the coverage audit.');
  const remaining = () => Math.max(0, Math.floor(Math.min(15_000, allowanceMs - (monotonic() - started))));
  const guardedFetch = async (url, options) => boundedResponse(await fetchImpl(url, { ...options, redirect: 'error' }));
  const providerFor = repository => new GithubAppTokenProvider({ repository, appId, privateKey, installationId, fetchImpl: guardedFetch, now, requestTimeoutMs: remaining });
  const report = {
    schemaVersion: 1, evidenceClass: 'live-app-metadata', observedAt: new Date(now()).toISOString(),
    source: { issue: 60, repository: env.GITHUB_REPOSITORY, repositoryId: 1358455028, commit: sourceCommit, actorId: env.GITHUB_ACTOR_ID, triggeringActor: env.GITHUB_TRIGGERING_ACTOR, runId: env.GITHUB_RUN_ID, runAttempt: env.GITHUB_RUN_ATTEMPT },
    status: 'held', installation: null, allRepositoriesSelected: null, currentFactorySetCoverageVerified: false,
    installationTokenCleanupConfirmed: true, repositoryMutationsRequested: false, runtimeAdmissionAuthorized: false,
    repositories: targets.map(target => ({ repositoryId: target.repositoryId, expectedFullName: target.fullName, status: 'not-queried', installationTokenRevoked: null })),
  };
  let jwt;
  try {
    if (remaining() < 1) throw new CoverageHold('execution-time-expired');
    jwt = createGithubAppJwt({ appId, privateKey, now: now() });
    report.installation = observedInstallation(await providerFor(targets[0].fullName).request(`/app/installations/${installationId}`, 'GET', jwt));
    report.allRepositoriesSelected = report.installation.repositorySelection === 'all';
  } catch (error) { report.reason = safeReason(error); return report; }

  for (const [index, target] of targets.entries()) {
    const row = report.repositories[index];
    const provider = providerFor(target.fullName);
    let phase = 'lookup'; let fatal = false;
    try {
      const installation = observedInstallation(await provider.request(`/repos/${target.fullName}/installation`, 'GET', jwt));
      if (installation.repositorySelection !== report.installation.repositorySelection
          || JSON.stringify(Object.entries(installation.permissions).sort()) !== JSON.stringify(Object.entries(report.installation.permissions).sort())) throw new CoverageHold('installation-changed-during-audit');
      phase = 'mint';
      // Reuse existing issuance tracking/revocation, with the official integer-ID body.
      // No installation-wide opt-in or permission inheritance is available here.
      const token = await provider.request(`/app/installations/${installationId}/access_tokens`, 'POST', jwt, {
        repository_ids: [target.repositoryId], permissions: { ...metadataPermissions },
      });
      assertToken(token, target, now);
      phase = 'repository';
      const scope = await provider.request('/installation/repositories?per_page=2', 'GET', token.token);
      if (scope?.total_count !== 1 || !Array.isArray(scope.repositories) || scope.repositories.length !== 1) throw new CoverageHold('repository-identity-or-scope-mismatch');
      assertRepository(scope.repositories[0], target);
      row.observedFullName = scope.repositories[0].full_name;
      row.status = 'verified';
    } catch (error) {
      row.status = 'unverified'; row.reason = safeReason(error);
      fatal = phase !== 'lookup' || ![403, 404].includes(error?.status);
    } finally {
      const revoked = await provider.revoke();
      row.installationTokenRevoked = revoked;
      if (!revoked) {
        report.installationTokenCleanupConfirmed = false; row.status = 'unverified';
        row.cleanupReason = 'installation-token-cleanup-unconfirmed';
        row.reason ??= row.cleanupReason; fatal = true;
      }
    }
    if (fatal) break; // Never resume issuance after uncertainty or unexpected scope.
  }
  report.currentFactorySetCoverageVerified = report.repositories.every(row => row.status === 'verified') && report.installationTokenCleanupConfirmed;
  report.status = report.currentFactorySetCoverageVerified ? 'observed' : 'held';
  return report;
}
