import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { loadParticipantRegistry } from './lib/participant-registry.mjs';
import {
  controllerIdentityFromContract,
  validateIntakeCallerProvenance,
} from './lib/intake-caller-provenance.mjs';

const repositoryRoot = process.cwd();
const appContract = JSON.parse(await readFile(path.join(repositoryRoot, 'config/github-app-contract.json'), 'utf8'));
const registry = await loadParticipantRegistry(repositoryRoot);
const controller = controllerIdentityFromContract(appContract, registry);

validateIntakeCallerProvenance({
  ...controller,
  eventName: process.env.EVENT_NAME,
  gitRef: process.env.GIT_REF,
  callerWorkflowRef: process.env.CALLER_WORKFLOW_REF,
  agentInvocation: process.env.AGENT_INVOCATION === 'true',
  currentRepository: process.env.CURRENT_REPOSITORY,
  currentRepositoryId: process.env.CURRENT_REPOSITORY_ID,
});

process.stdout.write('Intake caller provenance validated.\n');
