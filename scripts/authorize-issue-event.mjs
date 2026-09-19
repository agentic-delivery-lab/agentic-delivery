// agentic-primitive: {"id":"issue-event-authorization","kind":"validator","enforcement":"deterministic","adrs":["ADR-0017"],"domains":["agentic-delivery-governance"]}
import { appendFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { AGENT_BOT_LOGIN } from './lib/agent-invocation.mjs';

const API_VERSION = '2026-03-10';
const WRITER_PERMISSIONS = new Set(['write', 'maintain', 'admin']);
const INTERNAL_BOTS = new Set(['github-actions[bot]', AGENT_BOT_LOGIN]);

async function output(name, value, env = process.env) {
  if (!env.GITHUB_OUTPUT) return;
  await appendFile(env.GITHUB_OUTPUT, `${name}=${String(value)}\n`);
}

export async function authorizeIssueEvent({ env = process.env, fetchImpl = fetch } = {}) {
  const eventName = String(env.GITHUB_EVENT_NAME ?? '');
  if (eventName !== 'issues') {
    await output('authorized', 'true', env);
    return { authorized: true, actor: null, reason: 'The event is already behind a downstream invocation boundary.' };
  }
  const repository = String(env.GITHUB_REPOSITORY ?? '');
  const actor = String(env.GITHUB_ACTOR ?? '');
  if (!/^[\w.-]+\/[\w.-]+$/.test(repository) || !/^[A-Za-z0-9_.\[\]-]+$/.test(actor)) {
    throw new Error('The issue event repository or actor is invalid.');
  }
  if (INTERNAL_BOTS.has(actor)) {
    await output('authorized', 'true', env);
    return { authorized: true, actor, reason: 'The actor is an exact internal automation identity.' };
  }
  if (!env.GH_TOKEN) throw new Error('GH_TOKEN is required for issue-event authorization.');
  const response = await fetchImpl(`https://api.github.com/repos/${repository}/collaborators/${encodeURIComponent(actor)}/permission`, {
    headers: {
      Authorization: `Bearer ${env.GH_TOKEN}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': API_VERSION,
    },
    signal: AbortSignal.timeout(10_000),
  });
  if (response.status === 404) {
    await output('authorized', 'false', env);
    return { authorized: false, actor, reason: 'The actor is not a repository collaborator.' };
  }
  if (!response.ok) throw new Error(`GitHub collaborator permission lookup failed (${response.status}).`);
  const permission = (await response.json())?.permission;
  const authorized = WRITER_PERMISSIONS.has(permission);
  await output('authorized', authorized ? 'true' : 'false', env);
  return { authorized, actor, permission, reason: authorized ? 'The actor has repository write permission.' : 'The actor lacks repository write permission.' };
}

const isMainModule = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMainModule) {
  try {
    const result = await authorizeIssueEvent();
    process.stdout.write(`${result.authorized ? 'Authorized' : 'Ignored'} issue event actor ${result.actor ?? 'downstream'}: ${result.reason}\n`);
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}
