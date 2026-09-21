import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseRepositoryYaml } from './lib/yaml.mjs';
import { parseParticipantRegistry } from './lib/participant-registry.mjs';
import { invocationEnvelope } from './lib/agent-invocation.mjs';
import { controllerPinMatchesRelease, validateControllerRelease, validateEventEnvelope } from './lib/control-plane-contracts.mjs';
import { intakeEvent, normalizeOriginEvent } from './codex-delivery.mjs';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SECOND_REPOSITORY_ID = '900000001';
const SECOND_REPOSITORY = 'agentic-delivery-lab/acceptance-service';
const ISSUE_NUMBER = 17;

function assertCondition(condition, message) {
  if (!condition) throw new Error(message);
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, 'utf8'));
}

function secondParticipant(registry, first) {
  const source = registry.repositories[first.repositoryId];
  return {
    ...structuredClone(source),
    expectedFullName: SECOND_REPOSITORY,
    mode: 'active',
    events: ['issues', 'issue_comment'],
    localIntegration: { workflowBundle: 'none', managedByApp: false },
  };
}

function acceptanceEnvelope({ repositoryId, repository, delivery }) {
  return invocationEnvelope({
    deliveryId: delivery,
    eventName: 'issues',
    action: 'opened',
    repositoryId,
    source: {
      kind: 'issue',
      issue_number: ISSUE_NUMBER,
      pull_request_number: null,
      comment_id: null,
      review_id: null,
    },
    actor: { login: 'acceptance-owner', type: 'User' },
    body: 'A repository-local acceptance fixture.',
    organizationId: '327861320',
    installationId: '163255060',
    repositoryFullName: repository,
    receivedAt: '2026-09-21T12:00:00.000Z',
  });
}

/**
 * Run the organization-wide acceptance matrix without GitHub writes.
 *
 * This is intentionally an offline fixture check. It proves the generic
 * identity and compatibility contracts in the checked-out Control Plane; the
 * report never claims that the live App installation, repository selection,
 * webhook delivery, or organization fields have been verified.
 */
export async function validateMultiRepositoryAcceptance({ root = repositoryRoot } = {}) {
  const release = await readJson(path.join(root, 'config/controller-release.json'));
  const releaseResult = validateControllerRelease(release);
  assertCondition(releaseResult.valid, `controller release is invalid: ${releaseResult.errors.join('; ')}`);

  const registrySource = await readFile(path.join(root, 'config/participants.yml'), 'utf8');
  const registryValue = parseRepositoryYaml(registrySource, 'participant registry');
  const firstRegistry = parseParticipantRegistry(registryValue);
  assertCondition(firstRegistry.valid, `participant registry is invalid: ${firstRegistry.errors.join('; ')}`);
  const first = firstRegistry.participants.values().next().value;
  assertCondition(first, 'the acceptance matrix requires one enrolled source participant');

  const fixtureRegistryValue = structuredClone(registryValue);
  fixtureRegistryValue.repositories[SECOND_REPOSITORY_ID] = secondParticipant(registryValue, first);
  const fixtureRegistry = parseParticipantRegistry(fixtureRegistryValue);
  assertCondition(fixtureRegistry.valid, `two-repository fixture registry is invalid: ${fixtureRegistry.errors.join('; ')}`);

  const participants = [first, fixtureRegistry.participants.get(SECOND_REPOSITORY_ID)];
  const identityRows = participants.map((participant, index) => {
    const repositoryId = participant.repositoryId;
    const repository = participant.expectedFullName;
    const envelope = acceptanceEnvelope({
      repositoryId,
      repository,
      delivery: `9000000${index + 1}-1234-4234-8234-123456789012`,
    });
    const envelopeResult = validateEventEnvelope(envelope);
    assertCondition(envelopeResult.valid, `${repository} envelope is invalid: ${envelopeResult.errors.join('; ')}`);
    const normalized = normalizeOriginEvent({
      repository: { id: 1358455028, full_name: 'agentic-delivery-lab/agentic-delivery' },
      client_payload: envelope,
    }, { ORIGIN_REPOSITORY: repository, ORIGIN_REPOSITORY_ID: repositoryId });
    const context = intakeEvent(normalized, {
      SOURCE_ISSUE: String(ISSUE_NUMBER),
      GITHUB_REPOSITORY: 'agentic-delivery-lab/agentic-delivery',
      ORIGIN_REPOSITORY: repository,
      ORIGIN_REPOSITORY_ID: repositoryId,
      GITHUB_EVENT_NAME: 'issues',
      GITHUB_ACTOR: 'acceptance-owner',
    });
    assertCondition(context.repository === repository, `${repository} lost origin repository identity during intake`);
    assertCondition(context.issue === String(ISSUE_NUMBER), `${repository} changed the source issue number`);
    return {
      repositoryId,
      repository,
      issue: ISSUE_NUMBER,
      envelopeRepositoryId: envelope.repository_id,
      normalizedRepositoryId: String(normalized.repository.id),
      normalizedRepository: normalized.repository.full_name,
      stateNamespace: `${repositoryId}/${ISSUE_NUMBER}`,
      evidenceIssueUrl: `https://github.com/${repository}/issues/${ISSUE_NUMBER}`,
    };
  });

  assertCondition(new Set(identityRows.map((row) => row.repositoryId)).size === 2, 'fixture repositories must have distinct IDs');
  assertCondition(new Set(identityRows.map((row) => row.stateNamespace)).size === 2, 'same issue number must use isolated state namespaces');
  assertCondition(identityRows.every((row) => row.normalizedRepositoryId === row.repositoryId), 'normalized repository IDs must remain authoritative');
  assertCondition(identityRows.every((row) => row.normalizedRepository === row.repository), 'normalized repository names must remain aligned with IDs');

  const currentPin = {
    controller: { version: release.version, commit: release.commit },
    contracts: release.contracts,
    dependencies: release.dependencies,
  };
  assertCondition(controllerPinMatchesRelease(release, currentPin), 'current participant pin must match the release catalog');
  const compatiblePins = release.compatibility.controllers.filter((pin) => pin.commit !== release.commit);
  assertCondition(compatiblePins.length > 0, 'release catalog must retain an older compatible controller for rollback');
  const rollbackPin = compatiblePins[0];
  assertCondition(controllerPinMatchesRelease({ ...release, compatibility: { ...release.compatibility, controllers: [rollbackPin] } }, {
    controller: { version: rollbackPin.version, commit: rollbackPin.commit },
    contracts: rollbackPin.contracts,
    dependencies: rollbackPin.dependencies,
  }), 'the retained rollback pin must validate as a compatible controller');

  const appContract = await readJson(path.join(root, 'config/github-app-contract.json'));
  assertCondition(appContract.credentials?.privateKey === 'central-deployment-only', 'App private key must remain central');
  assertCondition(appContract.credentials?.webhookSecret === 'central-gateway-only', 'webhook secret must remain central');
  assertCondition(appContract.tokenScopes?.origin?.repositoryIds === 'origin-event-repository', 'origin token must be repository-scoped');
  assertCondition(appContract.tokenScopes?.controller?.repositoryIds === 'controller-repository', 'controller token must be controller-scoped');
  assertCondition(appContract.permissions?.workflows === 'none', 'App workflow permission must remain disabled');

  const privateWorkflowPath = path.resolve(root, '../.github-private/.github/workflows/validate-published-agents.yml');
  let privateSurface = { status: 'unavailable', reason: 'local .github-private checkout is not present' };
  try {
    const privateWorkflow = await readFile(privateWorkflowPath, 'utf8');
    assertCondition(!privateWorkflow.includes('APP_PRIVATE_KEY'), 'private publication validation must not receive the App private key');
    assertCondition(!privateWorkflow.includes('AGENTIC_DELIVERY_WEBHOOK_SECRET'), 'private publication validation must not receive the webhook secret');
    privateSurface = { status: 'passed', workflow: '.github-private/.github/workflows/validate-published-agents.yml' };
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }

  return {
    schemaVersion: 1,
    status: 'passed',
    evidenceClass: 'offline-fixture',
    liveGitHubVerification: 'not-run',
    checks: {
      sharedController: 'passed',
      repositoryIdentity: 'passed',
      lifecycleIssueNamespace: 'passed',
      controllerUpgrade: 'passed',
      controllerRollback: 'passed',
      centralCredentialBoundary: 'passed',
      privatePublicationBoundary: privateSurface.status,
      repositoryLocalCi: 'not-run-by-this-check',
    },
    participants: identityRows,
    controller: { version: release.version, commit: release.commit, rollback: { version: rollbackPin.version, commit: rollbackPin.commit } },
    privateSurface,
  };
}

const isMainModule = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMainModule) {
  try {
    const result = await validateMultiRepositoryAcceptance({ root: process.argv[2] ?? undefined });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}
