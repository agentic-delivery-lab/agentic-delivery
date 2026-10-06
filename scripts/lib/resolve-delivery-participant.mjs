// agentic-primitive: {"id":"delivery-participant-policy-resolver","kind":"validator","enforcement":"deterministic","adrs":["ADR-0018"],"domains":["agentic-delivery-control-plane"]}
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { unwrapRepositoryDispatchClientPayload } from './agent-invocation.mjs';
import { loadParticipantRegistry, participantForRepository } from './participant-registry.mjs';

const ALLOWED_ROUTES = new Set([
  'plan', 'implement', 'resume', 'refine', 'research', 'requirements',
  'architecture', 'validate', 'coordinate',
]);
const SHA = /^[0-9a-f]{40}$/i;

function asString(value) {
  return value === undefined || value === null ? '' : String(value);
}

function readOnlyInput(value) {
  if (value === true || value === 'true') return true;
  if (value === false || value === 'false') return false;
  return null;
}

function rejectCallerPolicyFields(context) {
  for (const field of ['participantMode', 'participant_mode', 'controllerCommit', 'controller_commit', 'readOnlyRun', 'read_only_run']) {
    if (Object.hasOwn(context, field)) {
      throw new Error(`Caller-supplied ${field} is not an accepted delivery input.`);
    }
  }
}

function workflowRef(controllerRepository, workflow) {
  return `${controllerRepository}/.github/workflows/${workflow}.yml@refs/heads/main`;
}

function validateCaller(context) {
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(asString(context.controllerRepository))) {
    throw new Error('The trusted controller repository is missing or invalid.');
  }
  if (context.githubRef !== 'refs/heads/main') {
    throw new Error('Delivery may run only from refs/heads/main.');
  }
  if (context.route === '') {
    if (context.eventName !== 'workflow_dispatch'
      || context.callerWorkflowRef !== workflowRef(context.controllerRepository, 'codex-delivery')) {
      throw new Error('Direct delivery recovery must use codex-delivery.yml on main.');
    }
    return;
  }
  if (!ALLOWED_ROUTES.has(context.route)) throw new Error(`The delivery route is unsupported: ${context.route}`);
  const intakeWorkflow = workflowRef(context.controllerRepository, 'issue-intake');
  const invocationWorkflow = workflowRef(context.controllerRepository, 'agent-invocation');
  if (context.callerWorkflowRef !== intakeWorkflow && context.callerWorkflowRef !== invocationWorkflow) {
    throw new Error('Reusable delivery may be called only by the central issue-intake or agent-invocation workflow on main.');
  }
  if (context.callerWorkflowRef === invocationWorkflow && context.eventName !== 'repository_dispatch') {
    throw new Error('The agent-invocation workflow may call delivery only for repository_dispatch events.');
  }
}

function validateOrigin(context, event) {
  const repositoryId = asString(context.originRepositoryId);
  const repository = asString(context.originRepository);
  if (!/^[1-9][0-9]*$/.test(repositoryId)) throw new Error('The origin repository ID is missing or invalid.');
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)) throw new Error('The origin repository name is missing or invalid.');

  if (context.eventName === 'repository_dispatch') {
    if (asString(event.repository?.full_name) !== context.controllerRepository) {
      throw new Error('The repository-dispatch event did not target the central controller.');
    }
    const envelope = unwrapRepositoryDispatchClientPayload(event.client_payload);
    if (!envelope || asString(envelope.repository_id) !== repositoryId) {
      throw new Error('The origin repository ID does not match the dispatch envelope.');
    }
    if (envelope.repository_full_name !== undefined && envelope.repository_full_name !== repository) {
      throw new Error('The origin repository name does not match the dispatch envelope.');
    }
    return envelope;
  }

  if (asString(context.eventRepositoryId) !== repositoryId
    || asString(context.eventRepository) !== repository) {
    throw new Error('The origin repository identity does not match the triggering event.');
  }
  return null;
}

export function resolveDeliveryParticipant(context, registry, event) {
  rejectCallerPolicyFields(context);
  validateCaller(context);
  const dispatchEnvelope = validateOrigin(context, event);
  if (!registry?.valid) throw new Error(`The participant registry is invalid: ${(registry?.errors ?? []).join(' ')}`);

  const participant = participantForRepository(registry, context.originRepositoryId);
  if (!participant) throw new Error('The origin repository is not enrolled in the participant registry.');
  if (participant.expectedFullName !== context.originRepository) {
    throw new Error('The origin repository name does not match the participant registry.');
  }
  if (!['active', 'shadow'].includes(participant.mode)) {
    throw new Error('The participant registry mode is disabled or invalid.');
  }
  if (!SHA.test(asString(participant.controller?.commit))) {
    throw new Error('The participant registry controller pin is invalid.');
  }
  if (dispatchEnvelope?.controller && (dispatchEnvelope.controller.version !== participant.controller.version
    || asString(dispatchEnvelope.controller.commit).toLowerCase() !== participant.controller.commit.toLowerCase())) {
    throw new Error('The dispatch controller pin does not match the participant registry.');
  }

  let forceReadOnly = false;
  if (context.eventName === 'workflow_dispatch') {
    forceReadOnly = readOnlyInput(context.forceReadOnly);
    if (forceReadOnly === null) throw new Error('The manual force_read_only input must be true or false.');
  }
  return {
    participantMode: participant.mode,
    controllerCommit: participant.controller.commit,
    readOnlyRun: participant.mode === 'shadow' || forceReadOnly,
  };
}

export async function resolveDeliveryParticipantFromEnvironment(env = process.env) {
  if (!env.EVENT_PAYLOAD_PATH) throw new Error('Delivery policy requires the GitHub event payload.');
  const event = JSON.parse(await readFile(env.EVENT_PAYLOAD_PATH, 'utf8'));
  const appContract = JSON.parse(await readFile(path.join(process.cwd(), 'config', 'github-app-contract.json'), 'utf8'));
  const registry = await loadParticipantRegistry();
  return resolveDeliveryParticipant({
    controllerRepository: appContract.controller?.repository,
    eventName: env.EVENT_NAME,
    githubRef: env.GIT_REF,
    callerWorkflowRef: env.CALLER_WORKFLOW_REF,
    route: env.ROUTE ?? '',
    originRepository: env.ORIGIN_REPOSITORY,
    originRepositoryId: env.ORIGIN_REPOSITORY_ID,
    eventRepository: event.repository?.full_name,
    eventRepositoryId: event.repository?.id,
    forceReadOnly: env.FORCE_READ_ONLY === 'unset' ? undefined : env.FORCE_READ_ONLY,
  }, registry, event);
}

const isMainModule = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMainModule) {
  try {
    const resolved = await resolveDeliveryParticipantFromEnvironment();
    process.stdout.write(`participant_mode=${resolved.participantMode}\n`);
    process.stdout.write(`controller_commit=${resolved.controllerCommit}\n`);
    process.stdout.write(`read_only_run=${resolved.readOnlyRun}\n`);
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}
