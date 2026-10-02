import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';

import { parseRepositoryYaml } from '../../scripts/lib/yaml.mjs';
import { parseParticipantRegistry } from '../../scripts/lib/participant-registry.mjs';
import {
  controllerIdentityFromContract,
  validateIntakeCallerProvenance,
} from '../../scripts/lib/intake-caller-provenance.mjs';

const repositoryRoot = path.resolve(import.meta.dirname, '../..');
const controllerRepository = 'example-org/delivery-controller';
const controllerRepositoryId = '12345';

function context(overrides = {}) {
  return {
    controllerRepository,
    controllerRepositoryId,
    eventName: 'issues',
    gitRef: 'refs/heads/main',
    callerWorkflowRef: `${controllerRepository}/.github/workflows/issue-intake.yml@refs/heads/main`,
    agentInvocation: false,
    currentRepository: controllerRepository,
    currentRepositoryId: controllerRepositoryId,
    ...overrides,
  };
}

test('controller identity comes from the trusted App contract and participant registry', async () => {
  const contract = JSON.parse(await readFile(path.join(repositoryRoot, 'config/github-app-contract.json'), 'utf8'));
  const registrySource = await readFile(path.join(repositoryRoot, 'config/participants.yml'), 'utf8');
  const registry = parseParticipantRegistry(parseRepositoryYaml(registrySource, 'participant registry'));

  assert.deepEqual(controllerIdentityFromContract(contract, registry), {
    controllerRepository: contract.controller.repository,
    controllerRepositoryId: '1358455028',
  });
});

test('intake accepts issue and manual events from the registered controller workflow on main', () => {
  for (const eventName of ['issues', 'workflow_dispatch']) {
    assert.equal(validateIntakeCallerProvenance(context({ eventName })).authorized, true);
  }
});

test('intake accepts repository dispatch only from the registered agent-invocation workflow on main', () => {
  assert.equal(validateIntakeCallerProvenance(context({
    eventName: 'repository_dispatch',
    callerWorkflowRef: `${controllerRepository}/.github/workflows/agent-invocation.yml@refs/heads/main`,
    agentInvocation: true,
  })).authorized, true);
});

test('intake rejects a controller repository name or ID mismatch', () => {
  assert.throws(
    () => validateIntakeCallerProvenance(context({ currentRepository: 'example-org/other-repository' })),
    /registered controller repository/,
  );
  assert.throws(
    () => validateIntakeCallerProvenance(context({ currentRepositoryId: '54321' })),
    /registered controller repository/,
  );
});

test('intake rejects non-main refs and unregistered caller workflows', () => {
  assert.throws(
    () => validateIntakeCallerProvenance(context({ gitRef: 'refs/heads/feature' })),
    /refs\/heads\/main/,
  );
  assert.throws(
    () => validateIntakeCallerProvenance(context({
      callerWorkflowRef: 'attacker/repository/.github/workflows/issue-intake.yml@refs/heads/main',
    })),
    /central issue-intake workflow/,
  );
});

test('intake rejects mismatched event and invocation-workflow combinations', () => {
  assert.throws(
    () => validateIntakeCallerProvenance(context({
      eventName: 'issues',
      callerWorkflowRef: `${controllerRepository}/.github/workflows/agent-invocation.yml@refs/heads/main`,
      agentInvocation: true,
    })),
    /repository_dispatch/,
  );
  assert.throws(
    () => validateIntakeCallerProvenance(context({ eventName: 'repository_dispatch' })),
    /issues or workflow_dispatch/,
  );
});

test('caller guard fails closed when trusted controller identity is invalid or ambiguous', () => {
  assert.throws(
    () => controllerIdentityFromContract({ controller: { repository: 'invalid' } }, { valid: true, participants: new Map() }),
    /no valid controller repository/,
  );
  assert.throws(
    () => controllerIdentityFromContract({ controller: { repository: controllerRepository } }, { valid: false, errors: ['bad registry'] }),
    /participant registry is invalid/,
  );
  assert.throws(
    () => controllerIdentityFromContract({ controller: { repository: controllerRepository } }, {
      valid: true,
      participants: new Map([['12345', { expectedFullName: controllerRepository }], ['54321', { expectedFullName: controllerRepository }]]),
    }),
    /exactly one participant registry entry/,
  );
});
