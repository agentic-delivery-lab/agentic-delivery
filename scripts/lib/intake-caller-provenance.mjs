// agentic-primitive: {"id":"intake-caller-provenance-guard","kind":"validator","enforcement":"deterministic","adrs":["ADR-0018"],"domains":["agentic-delivery-control-plane"]}
const FULL_NAME = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const REPOSITORY_ID = /^[1-9][0-9]*$/;

function asString(value) {
  return value === undefined || value === null ? '' : String(value);
}

function workflowRef(controllerRepository, workflow) {
  return `${controllerRepository}/.github/workflows/${workflow}.yml@refs/heads/main`;
}

export function controllerIdentityFromContract(appContract, registry) {
  const controllerRepository = asString(appContract?.controller?.repository);
  if (!FULL_NAME.test(controllerRepository)) {
    throw new Error('The trusted App contract has no valid controller repository.');
  }
  if (!registry?.valid || !(registry.participants instanceof Map)) {
    throw new Error(`The trusted participant registry is invalid: ${(registry?.errors ?? []).join(' ')}`);
  }

  const enrolledControllers = [...registry.participants.entries()]
    .filter(([, participant]) => participant?.expectedFullName === controllerRepository);
  if (enrolledControllers.length !== 1) {
    throw new Error('The controller repository must have exactly one participant registry entry.');
  }

  const [controllerRepositoryId] = enrolledControllers[0];
  if (!REPOSITORY_ID.test(asString(controllerRepositoryId))) {
    throw new Error('The controller repository ID in the participant registry is invalid.');
  }

  return { controllerRepository, controllerRepositoryId };
}

export function validateIntakeCallerProvenance({
  controllerRepository,
  controllerRepositoryId,
  eventName,
  gitRef,
  callerWorkflowRef,
  agentInvocation = false,
  currentRepository,
  currentRepositoryId,
} = {}) {
  const repository = asString(controllerRepository);
  const repositoryId = asString(controllerRepositoryId);
  if (!FULL_NAME.test(repository) || !REPOSITORY_ID.test(repositoryId)) {
    throw new Error('The trusted controller repository identity is missing or invalid.');
  }
  if (asString(currentRepository) !== repository || asString(currentRepositoryId) !== repositoryId) {
    throw new Error('Issue intake is only authorized from the registered controller repository.');
  }
  if (gitRef !== 'refs/heads/main') {
    throw new Error('Issue intake is only authorized from refs/heads/main.');
  }

  const isAgentInvocation = agentInvocation === true || agentInvocation === 'true';
  const issueIntakeWorkflow = workflowRef(repository, 'issue-intake');
  const agentInvocationWorkflow = workflowRef(repository, 'agent-invocation');
  if (isAgentInvocation) {
    if (callerWorkflowRef !== agentInvocationWorkflow || eventName !== 'repository_dispatch') {
      throw new Error('Agent invocation must come from the central agent-invocation workflow on main for repository_dispatch.');
    }
  } else if (callerWorkflowRef !== issueIntakeWorkflow || !['issues', 'workflow_dispatch'].includes(eventName)) {
    throw new Error('Issue intake must come from the central issue-intake workflow on main for issues or workflow_dispatch.');
  }

  return { authorized: true, controllerRepository: repository, controllerRepositoryId: repositoryId };
}
