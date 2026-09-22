import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  invocationEventSupported,
  observationEventSupported,
  validateDispatchEnvelopeSignature,
} from './lib/agent-invocation.mjs';
import { validateEventEnvelope } from './lib/control-plane-contracts.mjs';
import { loadParticipantRegistry, participantForRepository } from './lib/participant-registry.mjs';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export class ObservationValidationError extends Error {
  constructor(message, exitCode = 1) {
    super(message);
    this.name = 'ObservationValidationError';
    this.exitCode = exitCode;
  }
}

async function readJson(file) {
  try {
    return JSON.parse(await readFile(file, 'utf8'));
  } catch (error) {
    throw new ObservationValidationError(`observation event cannot be read: ${error.message}`, 2);
  }
}

/**
 * Validate a central pull-request observation without calling GitHub or
 * changing durable work state. The dispatch workflow is intentionally
 * separate from agent-invocation so an observation cannot accidentally start
 * a model run.
 */
export async function validateObservationEvent({
  eventPath,
  repositoryRoot: root = repositoryRoot,
  participantRegistry,
  controllerRepository,
  dispatchSecret = process.env.AGENTIC_DELIVERY_DISPATCH_SECRET || process.env.CODEX_DELIVERY_DISPATCH_SECRET,
  now = () => Date.now(),
} = {}) {
  if (!eventPath) throw new ObservationValidationError('GITHUB_EVENT_PATH is required', 2);
  const event = await readJson(eventPath);
  const envelope = event?.client_payload;
  const configuredController = controllerRepository
    ?? (await readJson(path.join(root, 'config/github-app-contract.json'))).controller?.repository;
  const errors = [];
  const envelopeResult = validateEventEnvelope(envelope);
  if (!envelopeResult.valid) errors.push(...envelopeResult.errors);
  if (dispatchSecret || envelope?.dispatch_signature !== undefined || envelope?.dispatch_timestamp !== undefined) {
    const signature = validateDispatchEnvelopeSignature({ secret: dispatchSecret, envelope, now: now() });
    if (!signature.valid) errors.push(`dispatch signature: ${signature.reason}`);
  }
  if (event?.repository?.full_name !== configuredController) errors.push('dispatch repository is not the configured Control Plane repository');
  if (envelope?.event !== 'pull_request') errors.push('observation dispatch must carry a pull_request event');
  if (!observationEventSupported(envelope?.event, envelope?.action)) errors.push('observation action is not in the observation catalog');
  if (invocationEventSupported(envelope?.event, envelope?.action)) errors.push('observation event must not be an invocation event');
  if (envelope?.source?.kind !== 'pull_request') errors.push('observation source kind must be pull_request');

  const registry = participantRegistry ?? await loadParticipantRegistry(root);
  if (!registry.valid) errors.push(...registry.errors.map((error) => `registry: ${error}`));
  const participant = registry.valid ? participantForRepository(registry, envelope?.repository_id) : null;
  if (!participant) errors.push('observation repository is not enrolled');
  else {
    if (participant.mode === 'disabled') errors.push('observation participant is disabled');
    if (!participant.events.includes('pull_request')) errors.push('observation event is not enrolled for the participant');
    if (participant.expectedFullName !== envelope.repository_full_name) errors.push('observation repository name does not match its numeric registry identity');
    if (!envelope.controller
      || envelope.controller.version !== participant.controller.version
      || String(envelope.controller.commit).toLowerCase() !== String(participant.controller.commit).toLowerCase()) {
      errors.push('observation controller pin does not match the participant registry');
    }
  }
  if (errors.length > 0) throw new ObservationValidationError(`observation validation failed:\n${errors.join('\n')}`);
  return {
    status: 'passed',
    deliveryId: envelope.delivery_id,
    repositoryId: envelope.repository_id,
    repository: envelope.repository_full_name,
    action: envelope.action,
    controller: envelope.controller,
  };
}

const isMainModule = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMainModule) {
  try {
    const result = await validateObservationEvent({
      eventPath: process.env.GITHUB_EVENT_PATH,
      repositoryRoot: process.argv[2] ?? repositoryRoot,
      controllerRepository: process.env.GITHUB_REPOSITORY,
    });
    process.stdout.write(`Observation ${result.status}: ${result.repository}#${result.repositoryId} ${result.action}.\n`);
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = error.exitCode ?? 1;
  }
}
