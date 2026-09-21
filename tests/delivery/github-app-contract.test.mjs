import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';

import { validateGithubAppContract } from '../../scripts/validate-github-app-contract.mjs';
import { parseRepositoryYaml } from '../../scripts/lib/yaml.mjs';
import { validateEventCatalog } from '../../scripts/lib/event-catalog.mjs';

const repositoryRoot = path.resolve(import.meta.dirname, '../..');

test('organization GitHub App contract includes lifecycle events and central credential boundaries', async () => {
  const contract = JSON.parse(await readFile(path.join(repositoryRoot, 'config/github-app-contract.json'), 'utf8'));
  const eventCatalog = parseRepositoryYaml(await readFile(path.join(repositoryRoot, 'config/event-catalog.yml'), 'utf8'), 'event catalog');
  const deliverySource = await readFile(path.join(repositoryRoot, 'scripts/codex-delivery.mjs'), 'utf8');
  assert.deepEqual(validateEventCatalog(eventCatalog), { valid: true, errors: [] });
  assert.deepEqual(validateGithubAppContract(contract, undefined, eventCatalog), { valid: true, errors: [] });
  assert.equal(contract.installation.access, 'selected-repositories');
  assert.equal(contract.credentials.privateKey, 'central-deployment-only');
  assert.equal(contract.tokenScopes.origin.repositoryIds, 'origin-event-repository');
  assert.equal(contract.tokenScopes.controller.repositoryIds, 'controller-repository');
  assert.equal(contract.permissions.workflows, 'none');
  assert.doesNotMatch(deliverySource, /workflows\s*:\s*['"]write['"]/);
});

test('GitHub App contract rejects a missing issue subscription or broad workflow permission', async () => {
  const contract = JSON.parse(await readFile(path.join(repositoryRoot, 'config/github-app-contract.json'), 'utf8'));
  const invalid = structuredClone(contract);
  delete invalid.events.issues;
  invalid.permissions.workflows = 'write';
  const result = validateGithubAppContract(invalid);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((error) => error.includes('events.issues')));
  assert.ok(result.errors.some((error) => error.includes('permissions.workflows')));
});

test('the organization event catalog is the source projection for App actions', async () => {
  const contract = JSON.parse(await readFile(path.join(repositoryRoot, 'config/github-app-contract.json'), 'utf8'));
  const eventCatalog = parseRepositoryYaml(await readFile(path.join(repositoryRoot, 'config/event-catalog.yml'), 'utf8'), 'event catalog');
  const invalid = structuredClone(eventCatalog);
  invalid.events.pull_request.actions = [...invalid.events.pull_request.actions, 'converted_to_draft'];
  const result = validateGithubAppContract(contract, undefined, invalid);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((error) => error.includes('events.pull_request must match the organization event catalog')));
});
