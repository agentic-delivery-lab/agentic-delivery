import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';

import { validateGithubAppContract } from '../../scripts/validate-github-app-contract.mjs';
import { GITHUB_APP_TOKEN_PERMISSION_PROFILES, githubAppTokenPermissions } from '../../scripts/lib/github-app.mjs';
import { parseRepositoryYaml } from '../../scripts/lib/yaml.mjs';
import { validateEventCatalog } from '../../scripts/lib/event-catalog.mjs';

const repositoryRoot = path.resolve(import.meta.dirname, '../..');

test('organization GitHub App contract includes lifecycle events and central credential boundaries', async () => {
  const contract = JSON.parse(await readFile(path.join(repositoryRoot, 'config/github-app-contract.json'), 'utf8'));
  const schemaV1 = JSON.parse(await readFile(path.join(repositoryRoot, 'schemas/github-app-contract.v1.schema.json'), 'utf8'));
  const schemaV2 = JSON.parse(await readFile(path.join(repositoryRoot, 'schemas/github-app-contract.v2.schema.json'), 'utf8'));
  const release = JSON.parse(await readFile(path.join(repositoryRoot, 'config/controller-release.json'), 'utf8'));
  const eventCatalog = parseRepositoryYaml(await readFile(path.join(repositoryRoot, 'config/event-catalog.yml'), 'utf8'), 'event catalog');
  const deliverySource = await readFile(path.join(repositoryRoot, 'scripts/codex-delivery.mjs'), 'utf8');
  assert.deepEqual(validateEventCatalog(eventCatalog), { valid: true, errors: [] });
  assert.deepEqual(validateGithubAppContract(contract, undefined, eventCatalog), { valid: true, errors: [] });
  assert.equal(contract.schemaVersion, 2);
  assert.equal(contract.contractVersion, '2.0.0');
  assert.equal(contract.$schema, '../schemas/github-app-contract.v2.schema.json');
  assert.equal(release.githubAppContractVersion, contract.contractVersion);
  assert.equal(schemaV1.properties.schemaVersion.const, 1);
  assert.equal(schemaV1.properties.contractVersion, undefined);
  assert.equal(schemaV2.properties.schemaVersion.const, 2);
  assert.deepEqual(schemaV2.properties.contractVersion, { const: '2.0.0' });
  assert.equal(contract.installation.access, 'selected-repositories');
  assert.equal(contract.credentials.privateKey, 'central-deployment-only');
  assert.equal(contract.credentials.dispatchSecret, 'central-gateway-and-controller-only');
  assert.equal(contract.permissions.issue_fields, 'read');
  assert.equal(contract.permissions.issue_types, 'read');
  assert.equal(contract.tokenScopes.origin.repositoryIds, 'origin-event-repository');
  assert.deepEqual(contract.tokenScopes.origin.profiles, GITHUB_APP_TOKEN_PERMISSION_PROFILES);
  assert.deepEqual(githubAppTokenPermissions('invocationPreflight'), {
    contents: 'read', issues: 'read', pull_requests: 'read', metadata: 'read',
  });
  assert.deepEqual(githubAppTokenPermissions('readOnlyIntake'), {
    contents: 'read', issues: 'read', pull_requests: 'read', metadata: 'read',
    issue_fields: 'read', issue_types: 'read',
  });
  assert.deepEqual(githubAppTokenPermissions('activeIntake'), {
    contents: 'read', issues: 'write', pull_requests: 'read', metadata: 'read',
    issue_fields: 'read', issue_types: 'read',
  });
  assert.deepEqual(githubAppTokenPermissions('delivery'), {
    contents: 'write', issues: 'write', pull_requests: 'write',
    issue_fields: 'read', issue_types: 'read',
  });
  assert.equal(contract.tokenScopes.controller.repositoryIds, 'controller-repository');
  assert.equal(contract.tokenScopes.controller.organizationPermissions, undefined);
  assert.equal(contract.permissions.workflows, 'none');
  assert.doesNotMatch(deliverySource, /workflows\s*:\s*['"]write['"]/);
});

test('the expanded GitHub App contract cannot retain a version-1 identity', async () => {
  const contract = JSON.parse(await readFile(path.join(repositoryRoot, 'config/github-app-contract.json'), 'utf8'));
  const invalid = structuredClone(contract);
  invalid.schemaVersion = 1;
  invalid.contractVersion = '1.0.0';
  const result = validateGithubAppContract(invalid);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((error) => error.includes('schemaVersion must be 2')));
  assert.ok(result.errors.some((error) => error.includes('contractVersion must be 2.0.0')));
});

test('runtime token requests use declared least-privilege profiles and origin repository narrowing', async () => {
  const intakeSource = await readFile(path.join(repositoryRoot, 'scripts/issue-intake.mjs'), 'utf8');
  const deliverySource = await readFile(path.join(repositoryRoot, 'scripts/codex-delivery.mjs'), 'utf8');
  const preflightSource = await readFile(path.join(repositoryRoot, 'scripts/prepare-agent-invocation.mjs'), 'utf8');
  assert.match(intakeSource, /githubAppTokenPermissions\(readOnlyRun \? 'readOnlyIntake' : 'activeIntake'\)/);
  assert.match(deliverySource, /githubAppTokenPermissions\('delivery'\)/);
  assert.match(preflightSource, /githubAppTokenPermissions\('invocationPreflight'\)/);
  assert.match(intakeSource, /repositoryIds:\s*\[env\.ORIGIN_REPOSITORY_ID\]/);
  assert.match(deliverySource, /repositoryIds:\s*\[originRepositoryId\]/);
  assert.match(preflightSource, /repositoryIds:\s*\[String\(envelope\.repository_id\)\]/);
});

test('GitHub App contract rejects a missing issue subscription or broad workflow permission', async () => {
  const contract = JSON.parse(await readFile(path.join(repositoryRoot, 'config/github-app-contract.json'), 'utf8'));
  const invalid = structuredClone(contract);
  delete invalid.events.issues;
  invalid.permissions.workflows = 'write';
  invalid.permissions.issue_fields = 'write';
  invalid.tokenScopes.origin.profiles.delivery.organizationPermissions.issue_types = 'write';
  invalid.tokenScopes.controller.organizationPermissions = { issue_fields: 'read' };
  const result = validateGithubAppContract(invalid);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((error) => error.includes('events.issues')));
  assert.ok(result.errors.some((error) => error.includes('permissions.workflows')));
  assert.ok(result.errors.some((error) => error.includes('permissions.issue_fields')));
  assert.ok(result.errors.some((error) => error.includes('origin token profile delivery must exactly match its runtime permission map')));
  assert.ok(result.errors.some((error) => error.includes('controller token must not request organization permissions')));
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

test('event route roles are validated from the canonical catalog', async () => {
  const source = await readFile(path.join(repositoryRoot, 'config/event-catalog.yml'), 'utf8');
  const catalog = parseRepositoryYaml(source, 'event catalog');
  const invalid = structuredClone(catalog);
  invalid.events.pull_request.routes = ['invocation'];
  const result = validateEventCatalog(invalid);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((error) => error.includes('events.pull_request.routes must be ["observation"]')));
});
