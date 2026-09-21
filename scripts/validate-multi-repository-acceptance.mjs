import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseRepositoryYaml } from './lib/yaml.mjs';
import { authorizeParticipation, parseParticipantRegistry } from './lib/participant-registry.mjs';
import { invocationEnvelope } from './lib/agent-invocation.mjs';
import { controllerPinMatchesRelease, validateControllerRelease, validateEventEnvelope } from './lib/control-plane-contracts.mjs';
import { intakeEvent, normalizeOriginEvent } from './codex-delivery.mjs';
import { reconcileFields } from './issue-intake.mjs';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SECOND_REPOSITORY_ID = '900000001';
const SECOND_REPOSITORY = 'agentic-delivery-lab/acceptance-service';
const PRIVATE_REPOSITORY_ID = '900000002';
const PRIVATE_REPOSITORY = 'agentic-delivery-lab/.github-private';
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
  const appContract = await readJson(path.join(root, 'config/github-app-contract.json'));
  const controllerRepository = appContract.controller?.repository;
  assertCondition(typeof controllerRepository === 'string' && controllerRepository.length > 0, 'App contract must identify the controller repository');

  const fixtureRegistryValue = structuredClone(registryValue);
  fixtureRegistryValue.repositories[SECOND_REPOSITORY_ID] = secondParticipant(registryValue, first);
  const fixtureRegistry = parseParticipantRegistry(fixtureRegistryValue);
  assertCondition(fixtureRegistry.valid, `two-repository fixture registry is invalid: ${fixtureRegistry.errors.join('; ')}`);

  const participants = [first, fixtureRegistry.participants.get(SECOND_REPOSITORY_ID)];
  const metadataSource = await readFile(path.join(root, 'config/issue-metadata.yml'), 'utf8');
  const metadataConfig = parseRepositoryYaml(metadataSource, 'issue metadata configuration');
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
      repository: { id: Number(first.repositoryId), full_name: controllerRepository },
      client_payload: envelope,
    }, { ORIGIN_REPOSITORY: repository, ORIGIN_REPOSITORY_ID: repositoryId });
    const context = intakeEvent(normalized, {
      SOURCE_ISSUE: String(ISSUE_NUMBER),
      GITHUB_REPOSITORY: controllerRepository,
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
      apiRepository: repository,
      gitRemote: `https://github.com/${repository}.git`,
      pullRequestRepository: repository,
      evidenceRepository: repository,
      evidenceIssueUrl: `https://github.com/${repository}/issues/${ISSUE_NUMBER}`,
    };
  });

  assertCondition(new Set(identityRows.map((row) => row.repositoryId)).size === 2, 'fixture repositories must have distinct IDs');
  assertCondition(new Set(identityRows.map((row) => row.stateNamespace)).size === 2, 'same issue number must use isolated state namespaces');
  assertCondition(identityRows.every((row) => row.normalizedRepositoryId === row.repositoryId), 'normalized repository IDs must remain authoritative');
  assertCondition(identityRows.every((row) => row.normalizedRepository === row.repository), 'normalized repository names must remain aligned with IDs');
  assertCondition(identityRows.every((row) => row.apiRepository === row.repository), 'API calls must retain the originating repository');
  assertCondition(identityRows.every((row) => row.pullRequestRepository === row.repository), 'pull-request evidence must retain the originating repository');
  assertCondition(identityRows.every((row) => row.evidenceRepository === row.repository), 'delivery evidence must retain the originating repository');
  assertCondition(identityRows.every((row) => row.gitRemote === `https://github.com/${row.repository}.git`), 'git remotes must retain the originating repository');

  // Enrollment is deliberately two-part: App repository access and a matching
  // central registry record. Removing either condition must fail closed before
  // any lifecycle or repository mutation is attempted.
  const appRepositoryIds = new Set([first.repositoryId, SECOND_REPOSITORY_ID]);
  assertCondition(authorizeParticipation({
    registry: firstRegistry,
    repositoryId: first.repositoryId,
    repositoryFullName: first.expectedFullName,
    appRepositoryIds,
  }).allowed === true, 'the first participant requires both App access and registry enrollment');
  assertCondition(authorizeParticipation({
    registry: fixtureRegistry,
    repositoryId: SECOND_REPOSITORY_ID,
    repositoryFullName: SECOND_REPOSITORY,
    appRepositoryIds,
  }).allowed === true, 'the second participant requires both App access and registry enrollment');
  const appAccessRemoved = authorizeParticipation({
    registry: firstRegistry,
    repositoryId: first.repositoryId,
    repositoryFullName: first.expectedFullName,
    appRepositoryIds: [],
  });
  assertCondition(appAccessRemoved.allowed === false && /App installation access/.test(appAccessRemoved.reason), 'removing App access must fail closed');
  const registryRemoved = authorizeParticipation({
    registry: firstRegistry,
    repositoryId: '900000003',
    repositoryFullName: 'agentic-delivery-lab/unregistered-service',
    appRepositoryIds: ['900000003'],
  });
  assertCondition(registryRemoved.allowed === false && /participant registry/.test(registryRemoved.reason), 'removing registry enrollment must fail closed');

  // Exercise the same deterministic field mutation used by live intake, but
  // keep the GraphQL adapter in-memory. The mutation log is scoped by the
  // originating repository so an identical issue number cannot write through
  // the controller repository or collide with another participant.
  const lifecycleWritebacks = [];
  for (const participant of participants) {
    const repository = participant.expectedFullName;
    const repositoryId = participant.repositoryId;
    const mutation = await reconcileFields({
      graphql: async (_query, variables) => {
        lifecycleWritebacks.push({ repositoryId, repository, variables });
        return { setIssueFieldValue: { issue: { id: `ISSUE_${repositoryId}` } } };
      },
      issue: {
        id: `ISSUE_${repositoryId}`,
        number: ISSUE_NUMBER,
        state: 'open',
        fields: { 'Lifecycle Stage': 'Intake', 'Delivery Readiness': 'Not ready' },
      },
      config: metadataConfig,
      classification: {
        workType: 'task',
        governance: [],
        targetFields: { lifecycle_stage: 'planning', readiness: 'ready' },
      },
    });
    assertCondition(mutation.changed === true, `${repository} did not authorize its lifecycle write-back`);
    assertCondition(mutation.fields.values.lifecycle_stage.optionId === 'planning', `${repository} selected the wrong lifecycle option`);
    assertCondition(mutation.fields.values.readiness.optionId === 'ready', `${repository} selected the wrong delivery-state option`);
  }
  assertCondition(lifecycleWritebacks.length === 2, 'each participating repository must receive one lifecycle write-back');
  assertCondition(new Set(lifecycleWritebacks.map((row) => row.repositoryId)).size === 2, 'lifecycle write-backs must preserve distinct repository identity');
  assertCondition(lifecycleWritebacks.every((row) => row.variables.input.issueId === `ISSUE_${row.repositoryId}`), 'lifecycle writes must target the originating repository issue node');

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

  assertCondition(appContract.credentials?.privateKey === 'central-deployment-only', 'App private key must remain central');
  assertCondition(appContract.credentials?.webhookSecret === 'central-gateway-only', 'webhook secret must remain central');
  assertCondition(appContract.tokenScopes?.origin?.repositoryIds === 'origin-event-repository', 'origin token must be repository-scoped');
  assertCondition(appContract.tokenScopes?.controller?.repositoryIds === 'controller-repository', 'controller token must be controller-scoped');
  assertCondition(appContract.permissions?.workflows === 'none', 'App workflow permission must remain disabled');

  // Exercise the private special-repository boundary as an ordinary
  // origin-event participant without supplying its workflow with central App
  // credentials. This is an offline fixture only; the real repository ID and
  // App installation access still require operator verification.
  const privateEnvelope = acceptanceEnvelope({
    repositoryId: PRIVATE_REPOSITORY_ID,
    repository: PRIVATE_REPOSITORY,
    delivery: '90000003-1234-4234-8234-123456789012',
  });
  const privateEnvelopeResult = validateEventEnvelope(privateEnvelope);
  assertCondition(privateEnvelopeResult.valid, `private surface envelope is invalid: ${privateEnvelopeResult.errors.join('; ')}`);
  const privateNormalized = normalizeOriginEvent({
    repository: { id: Number(first.repositoryId), full_name: controllerRepository },
    client_payload: privateEnvelope,
  }, { ORIGIN_REPOSITORY: PRIVATE_REPOSITORY, ORIGIN_REPOSITORY_ID: PRIVATE_REPOSITORY_ID });
  const privateContext = intakeEvent(privateNormalized, {
    SOURCE_ISSUE: String(ISSUE_NUMBER),
    GITHUB_REPOSITORY: controllerRepository,
    ORIGIN_REPOSITORY: PRIVATE_REPOSITORY,
    ORIGIN_REPOSITORY_ID: PRIVATE_REPOSITORY_ID,
    GITHUB_EVENT_NAME: 'issues',
    GITHUB_ACTOR: 'acceptance-owner',
  });
  assertCondition(privateContext.repository === PRIVATE_REPOSITORY, 'private surface lost origin repository identity during intake');
  assertCondition(privateContext.issue === String(ISSUE_NUMBER), 'private surface changed the source issue number');

  const privateWorkflowPath = path.resolve(root, '../.github-private/.github/workflows/validate-published-agents.yml');
  let privateSurface = { status: 'unavailable', reason: 'local .github-private checkout is not present' };
  try {
    const privateWorkflow = await readFile(privateWorkflowPath, 'utf8');
    assertCondition(!privateWorkflow.includes('APP_PRIVATE_KEY'), 'private publication validation must not receive the App private key');
    assertCondition(!privateWorkflow.includes('AGENTIC_DELIVERY_WEBHOOK_SECRET'), 'private publication validation must not receive the webhook secret');
    assertCondition(/repository:\s*agentic-delivery-lab\/agentic-delivery\s*$/m.test(privateWorkflow), 'private publication validator must use the central Control Plane repository');
    assertCondition(/ref:\s*[0-9a-f]{40}\s*$/m.test(privateWorkflow), 'private publication validator must pin an immutable Control Plane commit');
    assertCondition((privateWorkflow.match(/persist-credentials:\s*false/g) ?? []).length >= 2, 'private publication checkouts must not retain credentials');
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
      downstreamIdentity: 'passed',
      lifecycleIssueNamespace: 'passed',
      participationContract: 'passed',
      lifecycleWriteback: 'passed',
      controllerUpgrade: 'passed',
      controllerRollback: 'passed',
      centralCredentialBoundary: 'passed',
      privatePublicationBoundary: privateSurface.status,
      privateIssueParticipation: privateSurface.status === 'passed' ? 'passed' : 'not-run',
      repositoryLocalCi: 'not-run-by-this-check',
    },
    participants: identityRows,
    controller: { version: release.version, commit: release.commit, rollback: { version: rollbackPin.version, commit: rollbackPin.commit } },
    privateSurface: { ...privateSurface, participant: { repositoryId: PRIVATE_REPOSITORY_ID, repository: PRIVATE_REPOSITORY, stateNamespace: `${PRIVATE_REPOSITORY_ID}/${ISSUE_NUMBER}` } },
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
