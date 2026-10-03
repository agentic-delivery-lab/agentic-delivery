// agentic-primitive: {"id":"intake-participation-policy","kind":"validator","enforcement":"deterministic","adrs":["ADR-0018"],"domains":["agentic-delivery-control-plane"]}
import { appendFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PARTICIPANT_MODES = new Set(['active', 'shadow']);

function booleanInput(value, name, fallback = false) {
  if (typeof value === 'boolean') return value;
  if (value === undefined || value === null || value === '') return fallback;
  if (value === 'true') return true;
  if (value === 'false') return false;
  throw new Error(`${name} must be true or false.`);
}

export function resolveIntakePolicy({
  eventName,
  agentInvocation,
  registryParticipantMode,
  invocationParticipantMode,
  forceReadOnly,
} = {}) {
  if (typeof eventName !== 'string' || eventName.length === 0) {
    throw new Error('The GitHub event name is required to resolve intake policy.');
  }
  const isAgentInvocation = booleanInput(agentInvocation, 'agent_invocation');
  const participantMode = isAgentInvocation ? invocationParticipantMode : registryParticipantMode;
  const policy = resolveReadOnlyRun({ eventName, participantMode, forceReadOnly });
  return { participantMode, readOnlyRun: policy.readOnlyRun };
}

export function resolveReadOnlyRun({ eventName, participantMode, forceReadOnly } = {}) {
  if (typeof eventName !== 'string' || eventName.length === 0) {
    throw new Error('The GitHub event name is required to resolve intake policy.');
  }
  if (!PARTICIPANT_MODES.has(participantMode)) {
    throw new Error('The validated participant mode must be active or shadow.');
  }
  const requestedReadOnly = booleanInput(forceReadOnly, 'force_read_only');
  const readOnlyRun = participantMode === 'shadow'
    || (eventName === 'workflow_dispatch' && requestedReadOnly);
  return { participantMode, readOnlyRun };
}

export async function writeIntakePolicyOutputs(policy, outputFile = process.env.GITHUB_OUTPUT) {
  if (!outputFile) throw new Error('GITHUB_OUTPUT is required to publish intake policy.');
  await appendFile(outputFile, [
    `participant_mode=${policy.participantMode}`,
    `read_only_run=${policy.readOnlyRun ? 'true' : 'false'}`,
  ].join('\n') + '\n');
}

const isMainModule = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMainModule) {
  try {
    const policy = resolveIntakePolicy({
      eventName: process.env.EVENT_NAME,
      agentInvocation: process.env.AGENT_INVOCATION,
      registryParticipantMode: process.env.REGISTRY_PARTICIPANT_MODE,
      invocationParticipantMode: process.env.INVOCATION_PARTICIPANT_MODE,
      forceReadOnly: process.env.FORCE_READ_ONLY,
    });
    await writeIntakePolicyOutputs(policy);
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}
