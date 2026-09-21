import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import actorCatalog from '../config/agent-actors.json' with { type: 'json' };
import { invocationEventSupported } from './lib/agent-invocation.mjs';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const requiredEvents = ['issues', 'issue_comment', 'pull_request_review', 'pull_request_review_comment'];
const numericIdentity = /^[1-9][0-9]*$/;

export class GithubAppContractError extends Error {
  constructor(message, exitCode = 1) {
    super(message);
    this.name = 'GithubAppContractError';
    this.exitCode = exitCode;
  }
}

async function readContract(root) {
  try {
    return JSON.parse(await readFile(path.join(root, 'config/github-app-contract.json'), 'utf8'));
  } catch (error) {
    throw new GithubAppContractError(`GitHub App contract cannot be read: ${error.message}`, 2);
  }
}

export function validateGithubAppContract(contract, catalog = actorCatalog) {
  const errors = [];
  if (!contract || typeof contract !== 'object' || Array.isArray(contract)) return { valid: false, errors: ['contract must be an object'] };
  if (contract.schemaVersion !== 1) errors.push('schemaVersion must be 1');
  if (contract.organization?.login !== 'agentic-delivery-lab') errors.push('organization.login must be agentic-delivery-lab');
  if (!numericIdentity.test(String(contract.organization?.id ?? ''))) errors.push('organization.id must be a positive numeric identity');
  if (contract.installation?.access !== 'selected-repositories') errors.push('installation.access must be selected-repositories');
  if (contract.installation?.idEnv !== 'AGENTIC_DELIVERY_APP_INSTALLATION_ID') errors.push('installation.idEnv must name the central installation variable');
  if (!/^agentic-delivery-lab\/[A-Za-z0-9_.-]+$/.test(String(contract.controller?.repository ?? ''))) errors.push('controller.repository must be an organization repository');
  if (contract.controller?.idEnv !== 'AGENTIC_DELIVERY_CONTROLLER_REPOSITORY_ID') errors.push('controller.idEnv must name the central controller ID variable');
  for (const event of requiredEvents) {
    const actions = contract.events?.[event];
    if (!Array.isArray(actions) || actions.length === 0) errors.push(`events.${event} must contain at least one action`);
    else {
      for (const action of actions) if (!invocationEventSupported(event, action)) errors.push(`events.${event} contains unsupported action ${action}`);
    }
    if (JSON.stringify(actions) !== JSON.stringify(catalog?.events?.[event])) errors.push(`events.${event} must match the actor event catalog`);
  }
  const permissions = contract.permissions ?? {};
  if (permissions.metadata !== 'read') errors.push('permissions.metadata must be read');
  if (permissions.contents !== 'write') errors.push('permissions.contents must be write');
  if (permissions.issues !== 'write') errors.push('permissions.issues must be write');
  if (permissions.pull_requests !== 'write') errors.push('permissions.pull_requests must be write');
  if (permissions.workflows !== 'none') errors.push('permissions.workflows must be none');
  if (contract.credentials?.privateKey !== 'central-deployment-only') errors.push('credentials.privateKey must remain central-deployment-only');
  if (contract.credentials?.webhookSecret !== 'central-gateway-only') errors.push('credentials.webhookSecret must remain central-gateway-only');
  if (contract.credentials?.storage !== 'central-secret-store') errors.push('credentials.storage must be central-secret-store');
  if (contract.tokenScopes?.origin?.repositoryIds !== 'origin-event-repository') errors.push('origin token must be origin-event-repository scoped');
  if (contract.tokenScopes?.origin?.permissions !== 'read-minimum') errors.push('origin token must use read-minimum permissions');
  if (contract.tokenScopes?.controller?.repositoryIds !== 'controller-repository') errors.push('controller token must be controller-repository scoped');
  if (contract.tokenScopes?.controller?.permissions !== 'contents-write-dispatch-only') errors.push('controller token must be contents-write-dispatch-only');
  return { valid: errors.length === 0, errors };
}

export async function validateGithubAppContractFile({ root = repositoryRoot } = {}) {
  const result = validateGithubAppContract(await readContract(root));
  if (!result.valid) throw new GithubAppContractError(`${result.errors.map((error) => `GitHub App contract: ${error}`).join('\n')}\nGitHub App contract check failed with ${result.errors.length} error(s).`);
  return { valid: true };
}

const isMainModule = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMainModule) {
  try {
    await validateGithubAppContractFile({ root: process.argv[2] ?? repositoryRoot });
    process.stdout.write('GitHub App contract check passed.\n');
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = error.exitCode ?? 1;
  }
}
