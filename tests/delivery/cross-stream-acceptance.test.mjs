import assert from 'node:assert/strict';
import { createHash, createHmac } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';

import { authorizeParticipation, parseParticipantRegistry } from '../../scripts/lib/participant-registry.mjs';
import { resolveDeliveryParticipant } from '../../scripts/lib/resolve-delivery-participant.mjs';
import { invocationEventSupported, webhookEventSupported } from '../../scripts/lib/agent-invocation.mjs';
import { parseRepositoryYaml } from '../../scripts/lib/yaml.mjs';
import { classifyAndRoute, loadLifecycleConfig } from '../../scripts/issue-intake.mjs';
import { handleWebhook } from '../../api/github/webhook.mjs';
import { loadPinnedEvaluationReportSchema, routeEvaluationReports } from '../../scripts/lib/evaluation-finding-router.mjs';
import { selectProjectPlanningContext } from '../../scripts/lib/project-planning-selection.mjs';
import { normalizeProjectPlanningInput } from '../../scripts/lib/project-planning-context.mjs';
import { InMemoryReplayStore, replayKey } from '../../scripts/lib/replay-protection.mjs';

const repositoryRoot = path.resolve(import.meta.dirname, '../..');
const fixturePath = path.join(repositoryRoot, 'tests/fixtures/cross-stream-acceptance/scenarios.json');
const fixtures = JSON.parse(await readFile(fixturePath, 'utf8'));
const evaluationArchitectureRoot = process.env.EVALUATION_ARCHITECTURE_ROOT;
const evaluationSchemaContract = evaluationArchitectureRoot
  ? await loadPinnedEvaluationReportSchema(evaluationArchitectureRoot)
  : null;
const config = await loadLifecycleConfig(repositoryRoot);
const participantSource = parseRepositoryYaml(
  await readFile(path.join(repositoryRoot, 'config/participants.yml'), 'utf8'),
  'participant registry',
);

function fixtureRegistry(sourceIssue, additionalParticipants = []) {
  const existing = Object.values(participantSource.repositories)[0];
  const repositories = structuredClone(participantSource.repositories);
  for (const candidate of [sourceIssue, ...additionalParticipants]) {
    repositories[candidate.repositoryId] = {
      ...structuredClone(existing),
      expectedFullName: candidate.repositoryFullName,
      mode: 'active',
    };
  }
  const value = {
    ...structuredClone(participantSource),
    repositories,
  };
  return parseParticipantRegistry(value);
}

function controlPlaneCatalog() {
  const fields = ['lifecycle_stage', 'readiness'].map((key) => {
    const definition = config.fields[key];
    return {
      id: definition.id,
      name: definition.name,
      dataType: 'SINGLE_SELECT',
      options: definition.options.map(({ id, name }) => ({ id, name })),
    };
  });
  const types = config.issue_types.map((type) => ({
    id: `TYPE_${type.id}`,
    name: type.native_name,
    isEnabled: true,
    pinnedFields: fields,
  }));
  return { fields, types };
}

async function runIssueRoute(scenario, options = {}) {
  const { manualRecovery = false, eventAction = 'edited' } = options;
  const sourceIssue = scenario.sourceIssue;
  const eventRepositoryId = options.eventRepositoryId ?? sourceIssue.repositoryId;
  const eventRepository = options.eventRepository ?? sourceIssue.repositoryFullName;
  const { fields, types } = controlPlaneCatalog();
  const trace = {
    restReads: [],
    trustedIssueReads: [],
    actorPermissionReads: [],
    modelCalls: 0,
    protectedEffects: [],
    modelIssue: null,
    projectPlanningResult: null,
  };
  if (options.projectPlanningInput) {
    trace.projectPlanningResult = normalizeProjectPlanningInput(options.projectPlanningInput);
  }
  const registry = fixtureRegistry(sourceIssue, options.registryParticipants ?? []);
  assert.equal(registry.valid, true, registry.errors.join('; '));
  const participantAuthorization = authorizeParticipation({
    registry,
    repositoryId: eventRepositoryId,
    repositoryFullName: eventRepository,
    appRepositoryIds: options.appRepositoryIds ?? [sourceIssue.repositoryId],
  });
  if (!participantAuthorization.allowed) {
    return {
      result: null,
      trace,
      participantAuthorization,
      deliveryPolicy: null,
      deliveryAuthorizationError: new Error(participantAuthorization.reason),
    };
  }

  const basePath = `/repos/${sourceIssue.repositoryFullName}`;
  const fetchImpl = async (url, options = {}) => {
    const parsed = new URL(url);
    const method = options.method ?? 'GET';
    const route = `${parsed.pathname}${parsed.search}`;
    if (method !== 'GET') {
      trace.protectedEffects.push({ surface: 'repository-or-issue', method, route });
      return new Response(JSON.stringify({ message: 'Fixture writes are disabled.' }), { status: 403 });
    }
    assert.ok(parsed.pathname.startsWith(`${basePath}/`), `read escaped the originating repository: ${route}`);
    trace.restReads.push(route);
    if (route === `${basePath}/issues/${sourceIssue.issueNumber}`) {
      return new Response(JSON.stringify({
        number: sourceIssue.issueNumber,
        state: 'open',
        title: sourceIssue.title,
        body: sourceIssue.body,
        labels: [],
      }), { status: 200 });
    }
    if (route.startsWith(`${basePath}/issues/${sourceIssue.issueNumber}/comments?`)) {
      return new Response('[]', { status: 200 });
    }
    const permissionPath = `${basePath}/collaborators/fixture-writer/permission`;
    if (route === permissionPath) {
      trace.actorPermissionReads.push(route);
      return new Response(JSON.stringify({ permission: sourceIssue.actorPermission }), { status: 200 });
    }
    throw new Error(`Unexpected offline fixture read: ${route}`);
  };

  const nativeType = config.issue_types.find((type) => type.id === sourceIssue.issueType);
  assert.ok(nativeType, `fixture uses an unknown native Issue Type: ${sourceIssue.issueType}`);
  const lifecycle = config.fields.lifecycle_stage.options.find((option) => option.id === sourceIssue.lifecycleStage);
  const readiness = config.fields.readiness.options.find((option) => option.id === sourceIssue.deliveryState);
  assert.ok(lifecycle, `fixture uses an unknown Lifecycle Stage: ${sourceIssue.lifecycleStage}`);
  assert.ok(readiness, `fixture uses an unknown Delivery State: ${sourceIssue.deliveryState}`);

  const controlPlaneReader = async ({ repository, issueNumber }) => {
    trace.trustedIssueReads.push({ repository, issueNumber: Number(issueNumber) });
    assert.equal(repository, sourceIssue.repositoryFullName);
    assert.equal(Number(issueNumber), sourceIssue.issueNumber);
    return {
      id: sourceIssue.issueNodeId,
      number: sourceIssue.issueNumber,
      state: 'open',
      title: sourceIssue.title,
      body: sourceIssue.body,
      issueType: { id: `TYPE_${nativeType.id}`, name: nativeType.native_name },
      issueFieldValues: [
        { field: { id: config.fields.lifecycle_stage.id, name: config.fields.lifecycle_stage.name }, value: lifecycle.name },
        { field: { id: config.fields.readiness.id, name: config.fields.readiness.name }, value: readiness.name },
      ],
      organizationIssueTypes: types,
      organizationIssueFields: fields,
      organizationPinnedIssueFields: fields,
      plan: sourceIssue.plan ?? { exists: false, valid: false, digest: null },
      session: sourceIssue.session ?? { exists: false, resumable: false, id: null },
      execution: sourceIssue.execution ?? { status: 'idle', operation: null },
      labels: [],
    };
  };

  const reasonRoute = async ({ issue }) => {
    trace.modelCalls += 1;
    trace.modelIssue = issue;
    assert.equal(issue.id, sourceIssue.issueNodeId);
    assert.equal(issue.number, sourceIssue.issueNumber);
    assert.equal('project' in issue, false, 'Project context must not be passed as Issue authorization');
    return structuredClone(sourceIssue.routingProposal);
  };
  const graphqlImpl = async () => {
    trace.protectedEffects.push({ surface: 'issue-fields', method: 'graphql' });
    throw new Error('Unexpected offline fixture mutation.');
  };
  const env = {
    GITHUB_REPOSITORY: 'agentic-delivery-lab/agentic-delivery',
    ORIGIN_REPOSITORY: sourceIssue.repositoryFullName,
    SOURCE_ISSUE: String(sourceIssue.issueNumber),
    GH_TOKEN: 'offline-fixture-token',
    GITHUB_ACTOR: 'fixture-writer',
    GITHUB_TRIGGERING_ACTOR: 'fixture-writer',
    GITHUB_EVENT_NAME: manualRecovery ? 'workflow_dispatch' : 'issues',
    ...(manualRecovery ? { FORCE_ROUTE: 'true' } : {}),
  };
  const result = await classifyAndRoute({
    env,
    event: {
      action: manualRecovery ? 'requested' : eventAction,
      issue: { number: sourceIssue.issueNumber, ...(options.eventIssue ?? {}) },
      repository: { id: Number(eventRepositoryId), full_name: eventRepository },
    },
    fetchImpl,
    config,
    reasonRoute,
    graphqlImpl,
    controlPlaneReader,
  });

  // Mirror the production delivery policy boundary after route selection: the
  // trusted participant registry and triggering event identity must authorize
  // the selected route before a reusable delivery workflow can run.
  let deliveryPolicy = null;
  let deliveryAuthorizationError = null;
  try {
    deliveryPolicy = resolveDeliveryParticipant({
      controllerRepository: 'agentic-delivery-lab/agentic-delivery',
      eventName: manualRecovery ? 'workflow_dispatch' : 'issues',
      githubRef: 'refs/heads/main',
      callerWorkflowRef: 'agentic-delivery-lab/agentic-delivery/.github/workflows/issue-intake.yml@refs/heads/main',
      route: result.route,
      originRepository: sourceIssue.repositoryFullName,
      originRepositoryId: sourceIssue.repositoryId,
      eventRepository,
      eventRepositoryId: String(eventRepositoryId),
      ...(manualRecovery ? { forceReadOnly: false } : {}),
    }, registry, {
      repository: { id: Number(eventRepositoryId), full_name: eventRepository },
    });
  } catch (error) {
    deliveryAuthorizationError = error;
  }
  return { result, trace, participantAuthorization, deliveryPolicy, deliveryAuthorizationError };
}

async function planningInputForScenario(scenario, planningFields) {
  const fixture = JSON.parse(await readFile(
    path.join(repositoryRoot, 'tests/fixtures/project-planning-context/valid-offline-fixture.json'),
    'utf8',
  ));
  const input = structuredClone(fixture.input);
  const { sourceIssue } = scenario;
  const projectNodeId = scenario.planningContext.project.nodeId;
  const itemNodeId = scenario.planningContext.item.nodeId;
  const updatedAt = '2026-10-11T10:00:00Z';

  input.approvedProject.nodeId = projectNodeId;
  input.project.nodeId = projectNodeId;
  input.item.nodeId = itemNodeId;
  input.item.projectNodeId = projectNodeId;
  input.originRepository = {
    id: sourceIssue.repositoryId,
    fullName: sourceIssue.repositoryFullName,
  };
  input.sourceIssue = {
    repositoryId: sourceIssue.repositoryId,
    repositoryFullName: sourceIssue.repositoryFullName,
    number: sourceIssue.issueNumber,
    nodeId: sourceIssue.issueNodeId,
    updatedAt,
  };
  input.item.content = {
    ...input.item.content,
    repositoryId: sourceIssue.repositoryId,
    repositoryFullName: sourceIssue.repositoryFullName,
    issueNumber: sourceIssue.issueNumber,
    issueNodeId: sourceIssue.issueNodeId,
    updatedAt,
  };
  input.planningFields = structuredClone(planningFields);
  return input;
}

async function runIssueWebhook(scenario, { action, issue, deliveryId, replayStore, dispatches }) {
  const sourceIssue = scenario.sourceIssue;
  const registry = fixtureRegistry(sourceIssue);
  const payload = {
    organization: { login: 'agentic-delivery-lab', id: 327861320 },
    installation: { id: 163255060 },
    action,
    repository: { full_name: sourceIssue.repositoryFullName, id: Number(sourceIssue.repositoryId) },
    issue: { number: sourceIssue.issueNumber, ...issue },
    sender: { login: 'fixture-writer', type: 'User' },
  };
  const body = JSON.stringify(payload);
  const secret = 'offline-fixture-webhook-secret';
  const signature = `sha256=${createHmac('sha256', secret).update(body, 'utf8').digest('hex')}`;
  const output = {
    statusCode: null,
    headers: {},
    body: null,
    setHeader(name, value) { this.headers[name] = value; },
    end(value) { this.body = value ?? null; },
  };
  await handleWebhook({
    method: 'POST',
    headers: {
      'x-hub-signature-256': signature,
      'x-github-event': 'issues',
      'x-github-delivery': deliveryId,
    },
    body,
  }, output, {
    env: {
      AGENTIC_DELIVERY_CONTROLLER_REPOSITORY: 'agentic-delivery-lab/agentic-delivery',
      AGENTIC_DELIVERY_CONTROLLER_REPOSITORY_ID: '1358455028',
      AGENTIC_DELIVERY_APP_INSTALLATION_ID: '163255060',
      AGENTIC_DELIVERY_WEBHOOK_SECRET: secret,
      AGENTIC_DELIVERY_DISPATCH_SECRET: 'offline-fixture-dispatch-secret',
    },
    participantRegistry: registry,
    replayStore,
    tokenProvider: { token: async () => 'offline-fixture-token' },
    fetchImpl: async (url, options = {}) => {
      const pathname = new URL(url).pathname;
      if (pathname.endsWith('/collaborators/fixture-writer/permission')) {
        return new Response(JSON.stringify({ permission: 'write' }), { status: 200 });
      }
      if (pathname === '/repos/agentic-delivery-lab/agentic-delivery/dispatches' && options.method === 'POST') {
        dispatches.push(JSON.parse(options.body));
        return new Response(null, { status: 204 });
      }
      throw new Error('Unexpected offline webhook request: ' + pathname);
    },
  });
  return output;
}

test('factory capability work is routed only from its revalidated synthetic source Issue', async () => {
  assert.equal(fixtures.evidenceClass, 'offline-fixture');
  const scenario = fixtures.scenarios.factoryCapability;

  const { result, trace, participantAuthorization, deliveryPolicy, deliveryAuthorizationError } = await runIssueRoute(scenario, {
    projectPlanningInput: await planningInputForScenario(scenario, scenario.planningContext.planningFields),
  });
  assert.equal(participantAuthorization.allowed, true);
  assert.equal(trace.projectPlanningResult?.valid, true);
  const planning = trace.projectPlanningResult.value;
  assert.equal(planning.project.nodeId, scenario.planningContext.project.nodeId);
  assert.equal(planning.item.nodeId, scenario.planningContext.item.nodeId);
  assert.equal(planning.sourceIssue.repository.id, scenario.sourceIssue.repositoryId);
  assert.equal(planning.sourceIssue.repository.fullName, trace.trustedIssueReads[0].repository);
  assert.equal(planning.sourceIssue.number, trace.trustedIssueReads[0].issueNumber);
  assert.equal(planning.sourceIssue.nodeId, trace.modelIssue.id);
  assert.equal(planning.authority, 'planning-only');
  assert.equal(trace.modelIssue.projectPlanningContext, undefined);
  assert.equal(deliveryAuthorizationError, null);
  assert.equal(deliveryPolicy.participantMode, 'active');
  assert.equal(deliveryPolicy.readOnlyRun, false);
  assert.equal(result.route, 'implement');
  assert.equal(result.metadata.workType, 'implementation');
  assert.equal(result.metadata.lifecycleStage, 'execution');
  assert.equal(result.metadata.readiness, 'ready');
  assert.equal(result.metadata.orchestrationPattern, 'implementation-existing-plan');
  assert.deepEqual(trace.trustedIssueReads, [{ repository: scenario.sourceIssue.repositoryFullName, issueNumber: scenario.sourceIssue.issueNumber }]);
  assert.ok(trace.restReads.includes(`/repos/${scenario.sourceIssue.repositoryFullName}/issues/${scenario.sourceIssue.issueNumber}`));
  assert.deepEqual(trace.actorPermissionReads, [`/repos/${scenario.sourceIssue.repositoryFullName}/collaborators/fixture-writer/permission`]);
  assert.equal(trace.modelCalls, 1);
  assert.deepEqual(trace.protectedEffects, []);
});

test('synthetic product planning remains bound to its source Issue and does not claim a product owner', async () => {
  const scenario = fixtures.scenarios.productFeature;
  assert.equal(scenario.realProductRepository, null);
  assert.equal(scenario.productSteward, null);

  const { result, trace, participantAuthorization, deliveryPolicy, deliveryAuthorizationError } = await runIssueRoute(scenario, {
    projectPlanningInput: await planningInputForScenario(scenario, scenario.planningContext.planningFields),
  });
  assert.equal(participantAuthorization.allowed, true);
  assert.equal(trace.projectPlanningResult?.valid, true);
  const planning = trace.projectPlanningResult.value;
  assert.equal(planning.project.nodeId, scenario.planningContext.project.nodeId);
  assert.equal(planning.item.nodeId, scenario.planningContext.item.nodeId);
  assert.equal(planning.sourceIssue.repository.id, scenario.sourceIssue.repositoryId);
  assert.equal(planning.sourceIssue.repository.fullName, trace.trustedIssueReads[0].repository);
  assert.equal(planning.sourceIssue.number, trace.trustedIssueReads[0].issueNumber);
  assert.equal(planning.sourceIssue.nodeId, trace.modelIssue.id);
  assert.equal(planning.authority, 'planning-only');
  assert.equal(trace.modelIssue.projectPlanningContext, undefined);
  assert.equal(deliveryAuthorizationError, null);
  assert.equal(deliveryPolicy.participantMode, 'active');
  assert.equal(result.route, 'plan');
  assert.equal(result.metadata.workType, 'feature');
  assert.equal(result.metadata.lifecycleStage, 'planning');
  assert.equal(result.metadata.readiness, 'ready');
  assert.equal(result.metadata.orchestrationPattern, 'implementation-fresh');
  assert.equal(trace.trustedIssueReads[0].repository, scenario.sourceIssue.repositoryFullName);
  assert.equal(trace.modelIssue.id, scenario.sourceIssue.issueNodeId);
  assert.equal(trace.modelCalls, 1);
  assert.deepEqual(trace.protectedEffects, []);
});

test('Project priority and status remain planning context and do not change source-Issue routing', async () => {
  const scenario = fixtures.scenarios.productFeature;
  const originalPlanningFields = structuredClone(scenario.planningContext.planningFields);
  const alteredPlanningFields = [
    { key: 'portfolio-group', value: 'changed by synthetic Project event' },
    { key: 'portfolio-sequence', value: 1 },
  ];
  const baseline = await runIssueRoute(scenario, {
    projectPlanningInput: await planningInputForScenario(scenario, originalPlanningFields),
    eventIssue: { project: structuredClone(scenario.planningContext) },
  });
  const alteredProjectContext = structuredClone(scenario.planningContext);
  alteredProjectContext.project.priority = 'highest';
  alteredProjectContext.project.status = 'done';
  alteredProjectContext.planningFields = alteredPlanningFields;
  const altered = await runIssueRoute(scenario, {
    projectPlanningInput: await planningInputForScenario(scenario, alteredPlanningFields),
    eventIssue: { project: alteredProjectContext },
  });

  assert.equal(baseline.trace.projectPlanningResult.valid, true);
  assert.equal(altered.trace.projectPlanningResult.valid, true);
  assert.notDeepEqual(
    altered.trace.projectPlanningResult.value.planningFields,
    baseline.trace.projectPlanningResult.value.planningFields,
  );
  assert.equal(altered.result.route, baseline.result.route);
  assert.equal(altered.result.metadata.orchestrationPattern, baseline.result.metadata.orchestrationPattern);
  assert.equal(altered.trace.modelIssue.id, scenario.sourceIssue.issueNodeId);
  assert.equal(altered.trace.modelIssue.project, undefined);
  assert.equal(altered.trace.modelIssue.projectPlanningContext, undefined);
  assert.deepEqual(altered.trace.protectedEffects, []);
});

test('same-number Issues stay isolated when both source repositories are routed', async () => {
  const factory = fixtures.scenarios.factoryCapability.sourceIssue;
  const product = fixtures.scenarios.productFeature.sourceIssue;
  assert.equal(factory.issueNumber, product.issueNumber);
  assert.notEqual(factory.repositoryId, product.repositoryId);
  assert.notEqual(factory.issueNodeId, product.issueNodeId);
  assert.notEqual(`${factory.repositoryId}/${factory.issueNumber}`, `${product.repositoryId}/${product.issueNumber}`);
  for (const scenario of Object.values(fixtures.scenarios)) {
    assert.match(scenario.sourceIssue.repositoryId, /^900000108[1-4]$/);
    assert.match(scenario.sourceIssue.repositoryFullName, /\/fixture-/);
    assert.ok(Number.isSafeInteger(scenario.sourceIssue.issueNumber));
    assert.match(scenario.sourceIssue.issueNodeId, /^ISSUE_FIXTURE_/);
  }
  const factoryRoute = await runIssueRoute(fixtures.scenarios.factoryCapability);
  const productRoute = await runIssueRoute(fixtures.scenarios.productFeature);
  assert.equal(factoryRoute.result.route, 'implement');
  assert.equal(productRoute.result.route, 'plan');
  assert.deepEqual(factoryRoute.trace.trustedIssueReads, [{
    repository: factory.repositoryFullName,
    issueNumber: factory.issueNumber,
  }]);
  assert.deepEqual(productRoute.trace.trustedIssueReads, [{
    repository: product.repositoryFullName,
    issueNumber: product.issueNumber,
  }]);
  assert.equal(factoryRoute.trace.modelIssue.id, factory.issueNodeId);
  assert.equal(productRoute.trace.modelIssue.id, product.issueNodeId);
  assert.equal(factoryRoute.participantAuthorization.allowed, true);
  assert.equal(productRoute.participantAuthorization.allowed, true);
});

test('shared webhook replay state suppresses duplicate delivery and stale Issue payload cannot change the route', async () => {
  const scenario = fixtures.scenarios.factoryCapability;
  const replayStore = new InMemoryReplayStore();
  const dispatches = [];
  const laterDeliveryId = '9a1e4c20-8101-4e50-8f35-000000000001';
  const delayedDeliveryId = '9a1e4c20-8101-4e50-8f35-000000000002';
  const currentIssue = { state: 'open', title: scenario.sourceIssue.title, body: scenario.sourceIssue.body, updated_at: '2026-10-11T10:00:00Z' };
  const staleIssue = { state: 'closed', title: 'stale out-of-order title', body: 'stale out-of-order body', updated_at: '2026-10-11T09:00:00Z' };
  const laterWebhook = await runIssueWebhook(scenario, {
    action: 'edited', issue: currentIssue, deliveryId: laterDeliveryId, replayStore, dispatches,
  });
  const delayedWebhook = await runIssueWebhook(scenario, {
    action: 'opened', issue: staleIssue, deliveryId: delayedDeliveryId, replayStore, dispatches,
  });
  const duplicateWebhook = await runIssueWebhook(scenario, {
    action: 'edited', issue: currentIssue, deliveryId: laterDeliveryId, replayStore, dispatches,
  });
  assert.equal(laterWebhook.statusCode, 202);
  assert.equal(delayedWebhook.statusCode, 202);
  assert.equal(duplicateWebhook.statusCode, 503);
  assert.match(duplicateWebhook.body, /"retryable":true/);
  assert.equal(dispatches.length, 2, 'the duplicate delivery GUID must not create another repository dispatch');
  assert.equal(dispatches[0].event_type, 'agent_invocation');
  assert.equal(dispatches[1].event_type, 'agent_invocation');
  const laterEnvelope = JSON.parse(dispatches[0].client_payload.envelope.json);
  const delayedEnvelope = JSON.parse(dispatches[1].client_payload.envelope.json);
  assert.equal(laterEnvelope.delivery_id, laterDeliveryId);
  assert.equal(delayedEnvelope.delivery_id, delayedDeliveryId);
  assert.equal(laterEnvelope.repository_id, scenario.sourceIssue.repositoryId);
  assert.equal(delayedEnvelope.repository_id, scenario.sourceIssue.repositoryId);

  const later = await runIssueRoute(scenario, { eventAction: 'edited', eventIssue: currentIssue });
  const delayedEarlier = await runIssueRoute(scenario, { eventAction: 'opened', eventIssue: staleIssue });
  assert.equal(later.result.route, 'implement');
  assert.equal(delayedEarlier.result.route, later.result.route);
  for (const run of [later, delayedEarlier]) {
    assert.deepEqual(run.trace.trustedIssueReads, [{
      repository: scenario.sourceIssue.repositoryFullName,
      issueNumber: scenario.sourceIssue.issueNumber,
    }]);
    assert.deepEqual(run.trace.protectedEffects, []);
    assert.equal(run.trace.modelIssue.state, 'open');
    assert.equal(run.trace.modelIssue.title, scenario.sourceIssue.title);
  }
  assert.equal(delayedEarlier.trace.modelIssue.body, scenario.sourceIssue.body);

  const completedKey = replayKey({ installationId: '163255060', deliveryId: laterDeliveryId });
  assert.equal((await replayStore.claimController(completedKey)).status, 'claimed');
  await replayStore.completeController(completedKey);
  const completedDuplicate = await runIssueWebhook(scenario, {
    action: 'edited', issue: currentIssue, deliveryId: laterDeliveryId, replayStore, dispatches,
  });
  assert.equal(completedDuplicate.statusCode, 200);
  assert.match(completedDuplicate.body, /"completed":true/);
  assert.equal(dispatches.length, 2);
});

test('Project-only events cannot enter Issue routing even when the card references an Issue', async () => {
  assert.equal(invocationEventSupported('projects_v2_item', 'edited'), false);
  assert.equal(webhookEventSupported('projects_v2_item', 'edited'), false);
  const sourceIssue = fixtures.scenarios.factoryCapability.sourceIssue;
  const origin = sourceIssue.repositoryFullName;
  const payload = {
    action: 'edited',
    organization: { login: 'agentic-delivery-lab', id: 327861320 },
    installation: { id: 163255060 },
    repository: { id: Number(sourceIssue.repositoryId), full_name: origin },
    projects_v2_item: {
      content_node_id: sourceIssue.issueNodeId,
      content_type: 'Issue',
    },
    sender: { login: 'fixture-writer', type: 'User' },
  };
  const body = JSON.stringify(payload);
  const signature = `sha256=${createHmac('sha256', 'offline-fixture-webhook-secret').update(body, 'utf8').digest('hex')}`;
  const webhookResponse = {
    setHeader() {},
    end(value) { this.body = value; },
  };
  let webhookFetches = 0;
  let tokenRequests = 0;
  await handleWebhook({
    method: 'POST',
    headers: {
      'x-hub-signature-256': signature,
      'x-github-event': 'projects_v2_item',
      'x-github-delivery': 'PROJECT_FIXTURE_0001',
    },
    body,
  }, webhookResponse, {
    env: {
      AGENTIC_DELIVERY_CONTROLLER_REPOSITORY: 'agentic-delivery-lab/agentic-delivery',
      AGENTIC_DELIVERY_CONTROLLER_REPOSITORY_ID: '1358455028',
      AGENTIC_DELIVERY_APP_INSTALLATION_ID: '163255060',
      AGENTIC_DELIVERY_WEBHOOK_SECRET: 'offline-fixture-webhook-secret',
      AGENTIC_DELIVERY_DISPATCH_SECRET: 'offline-fixture-dispatch-secret',
    },
    tokenProvider: { token: async () => { tokenRequests += 1; return 'offline-fixture-token'; } },
    fetchImpl: async () => { webhookFetches += 1; throw new Error('Unsupported Project events must not reach GitHub.'); },
  });
  assert.equal(webhookResponse.statusCode, 204);
  assert.equal(tokenRequests, 0);
  assert.equal(webhookFetches, 0);

  let fetches = 0;
  let modelCalls = 0;
  await assert.rejects(classifyAndRoute({
    env: {
      GITHUB_REPOSITORY: 'agentic-delivery-lab/agentic-delivery',
      ORIGIN_REPOSITORY: origin,
      SOURCE_ISSUE: '',
      GH_TOKEN: 'offline-fixture-token',
      GITHUB_ACTOR: 'fixture-writer',
      GITHUB_EVENT_NAME: 'projects_v2_item',
    },
    event: {
      action: 'edited',
      repository: { full_name: origin },
      projects_v2_item: {
        content_node_id: sourceIssue.issueNodeId,
        content_type: 'Issue',
      },
      project: {
        id: 'PROJECT_FIXTURE_ONLY',
        fields: { priority: 'highest', status: 'done' },
      },
    },
    fetchImpl: async () => { fetches += 1; throw new Error('No GitHub API reads are allowed.'); },
    config,
    reasonRoute: async () => { modelCalls += 1; throw new Error('A Project event cannot invoke routing.'); },
  }), /Invalid source repository or issue number/);
  assert.equal(fetches, 0);
  assert.equal(modelCalls, 0);
});

test('swapping enrolled same-number repository identities is rejected before route reasoning', async () => {
  const scenario = fixtures.scenarios.factoryCapability;
  const otherSourceIssue = fixtures.scenarios.productFeature.sourceIssue;
  const { result, trace, participantAuthorization, deliveryPolicy, deliveryAuthorizationError } = await runIssueRoute(scenario, {
    eventRepositoryId: otherSourceIssue.repositoryId,
    registryParticipants: [otherSourceIssue],
  });
  assert.equal(result, null);
  assert.equal(participantAuthorization.allowed, false);
  assert.match(participantAuthorization.reason, /repository full name does not match the participant registry/);
  assert.equal(trace.modelCalls, 0);
  assert.equal(deliveryPolicy, null);
  assert.match(deliveryAuthorizationError.message, /repository full name does not match the participant registry/);
  assert.deepEqual(trace.restReads, []);
  assert.deepEqual(trace.protectedEffects, []);
});

test('synthetic Evaluation Report 2.0.0 routes to a non-actionable owner hold', {
  skip: evaluationSchemaContract ? false : 'Set EVALUATION_ARCHITECTURE_ROOT to the pinned Architecture checkout.',
}, () => {
  const scenario = fixtures.scenarios.evaluationFinding;
  const report = scenario.report;
  // Grade replayed synthetic output. This is an intentionally failed capability
  // case, not a claim that a deployed candidate or baseline was evaluated.
  const capabilityCase = scenario.capabilityCase;
  assert.equal(capabilityCase.evidenceClass, 'synthetic-replayed-output');
  assert.equal(capabilityCase.input.sourceIssue, null);
  assert.equal(capabilityCase.expectedRoute, 'ignore');
  const outcome = capabilityCase.candidateOutput.route === capabilityCase.expectedRoute ? 'pass' : 'fail';
  assert.equal(outcome, 'fail');
  assert.equal(report.cases[0].caseId, capabilityCase.caseId);
  assert.equal(report.cases[0].outcome, outcome);
  assert.equal(report.results.deterministicChecks[0].outcome, outcome);
  assert.equal(report.classification, 'synthetic');
  assert.equal(report.contractVersion, '2.0.0');
  assert.equal(report.results.deterministicChecks[0].outcome, 'fail');
  assert.equal(report.cases[0].outcome, 'fail', 'the report must represent a failed capability case, separate from owner resolution');
  assert.equal(report.cases[0].failureClass, 'authorization-violation');
  assert.equal(report.results.deterministicChecks[0].failureClass, report.cases[0].failureClass);
  assert.match(report.results.deterministicChecks[0].details, /Project-only card.*implement/);
  assert.equal(report.results.deterministicChecks[0].evidenceRefs[0], 'tests/fixtures/cross-stream-acceptance/scenarios.json');
  const routed = routeEvaluationReports({
    reports: [report],
    schemaContract: evaluationSchemaContract,
    sourceIssueUrl: `https://github.com/${scenario.sourceIssue.repositoryFullName}/issues/${scenario.sourceIssue.issueNumber}`,
  });
  const disposition = routed.dispositions[0];
  assert.equal(routed.schemaPin.commit, scenario.contractAdoption.schemaCommit);
  assert.equal(routed.proposals.length, 0);
  assert.equal(routed.mutationsRequested, false);
  assert.equal(disposition.action, 'owner-issue');
  assert.equal(disposition.status, 'awaiting-owner-verification');
  assert.equal('candidateTarget' in disposition, false);
  assert.equal('target' in disposition, false);
  assert.equal(disposition.executionAuthorized, false);
  assert.deepEqual(disposition.sourceReport, report);
  assert.deepEqual(disposition.sourceEvidence.evidence, report.evidence);
  assert.equal(disposition.sourceEvidence.sourcePins.length, 8);
  assert.equal(scenario.disposition.status, disposition.status);
  assert.equal(scenario.disposition.ownership.status, 'unresolved');
  assert.equal(scenario.disposition.ownership.actionableTarget, null);
  assert.equal(scenario.disposition.executionAuthorized, false);
  assert.equal(scenario.disposition.sourceReportRef, report.reportId);
  assert.equal(scenario.disposition.sourceEvidenceRef, `${report.reportId}#evidence`);
  assert.deepEqual(scenario.disposition.protectedEffects, []);
  assert.equal(scenario.disposition.modelInvocations, 0);
  assert.deepEqual(report.evidence.map(({ kind }) => kind), ['source', 'result']);
  assert.equal(report.evidence[0].ref, 'tests/fixtures/cross-stream-acceptance/scenarios.json');
  assert.deepEqual(Object.keys(report).sort(), [
    '$schema', 'baseline', 'cases', 'classification', 'comparison', 'contractVersion', 'dataset', 'dependencies',
    'evidence', 'evaluationMode', 'generatedAt', 'graders', 'improvementHypothesis', 'layer', 'limitations',
    'recommendation', 'regressionAssessment', 'reportId', 'results', 'review', 'runStartedAt', 'subject', 'uncertainty',
  ].sort());
  assert.equal(scenario.sourceIssue.repositoryId, '9000001083');
  assert.equal(scenario.sourceIssue.issueNodeId, 'ISSUE_FIXTURE_EVALUATION_17');
  assert.equal(scenario.contractAdoption.status, 'offline-provisional');
  assert.equal(scenario.contractAdoption.routerVersion, '2.0.0');
  assert.equal(scenario.contractAdoption.architectureReleaseVersion, '0.1.0-draft.24');
  assert.equal(fixtures.contracts.evaluationFindingRouter.status, 'merged');
  assert.equal(fixtures.contracts.projectPlanning.pullRequest, 102);
  assert.equal(fixtures.contracts.projectPlanning.status, 'merged');
  assert.equal(fixtures.contracts.projectSelection.pullRequest, 110);
  assert.equal(fixtures.contracts.projectSelection.sourceCommit, '95fc1289312e0324ac407a2e2372580856291a44');
  assert.equal(fixtures.contracts.projectSelection.adoption, 'offline-proposal-only');
});

test('missing Project read scope holds dependent selection while Issue-first recovery remains authorized', async () => {
  const scenario = fixtures.scenarios.projectReadFailure;
  const projectPlanningInput = await planningInputForScenario(scenario, scenario.planningContext.planningFields);
  const granted = normalizeProjectPlanningInput(projectPlanningInput);
  assert.equal(granted.valid, true);
  assert.equal(granted.value.sourceIssue.nodeId, scenario.sourceIssue.issueNodeId);
  assert.equal(granted.value.sourceIssue.repository.id, scenario.sourceIssue.repositoryId);
  assert.equal(granted.value.sourceIssue.repository.fullName, scenario.sourceIssue.repositoryFullName);
  assert.equal(granted.value.sourceIssue.number, scenario.sourceIssue.issueNumber);
  const candidate = structuredClone(projectPlanningInput);
  delete candidate.approvedProject;
  const policyBody = {
    schemaVersion: 1,
    policyId: 'offline-cross-stream-recovery',
    version: 1,
    topologyId: 'offline-synthetic-topology',
    projects: [{
      projectNodeId: candidate.project.nodeId,
      fieldSchemaSha256: candidate.project.fieldSchemaSha256,
      priority: 1,
    }],
  };
  const policySha256 = createHash('sha256').update(JSON.stringify(policyBody)).digest('hex');
  const selectionInput = {
    access: { projectRead: 'granted' },
    candidatesComplete: true,
    sourceIssueIdentity: {
      repositoryId: scenario.sourceIssue.repositoryId,
      repositoryFullName: scenario.sourceIssue.repositoryFullName,
      issueNumber: scenario.sourceIssue.issueNumber,
      issueNodeId: scenario.sourceIssue.issueNodeId,
    },
    selectionPolicy: { ...policyBody, sha256: policySha256 },
    expectedPolicySha256: policySha256,
    candidates: [candidate],
  };
  const selected = selectProjectPlanningContext(selectionInput);
  assert.equal(selected.valid, true);
  assert.deepEqual(selected.value.selectedContext, granted.value);

  const unavailable = structuredClone(selectionInput);
  unavailable.access.projectRead = 'missing-scope';
  unavailable.candidatesComplete = false;
  unavailable.candidates[0].access.projectRead = 'missing-scope';
  const held = selectProjectPlanningContext(unavailable);
  assert.equal(held.valid, false);
  assert.deepEqual(held.errors, ['PROJECT_READ_SCOPE_MISSING']);
  assert.equal(held.value, undefined, 'Project-dependent selection must return no usable context');
  assert.deepEqual(held.candidateEvidence.sourceIssueIdentity, selectionInput.sourceIssueIdentity);
  assert.equal(held.candidateEvidence.trust, 'untrusted-planning-data');
  const replay = structuredClone(unavailable);
  replay.candidates.push(structuredClone(replay.candidates[0]));
  assert.deepEqual(selectProjectPlanningContext(replay), held, 'replayed failure must retain the same stable gap');

  projectPlanningInput.access.projectRead = 'missing-scope';

  const { result, trace, participantAuthorization, deliveryPolicy, deliveryAuthorizationError } = await runIssueRoute(scenario, {
    manualRecovery: true,
    projectPlanningInput,
  });
  assert.deepEqual(trace.projectPlanningResult, { valid: false, errors: ['PROJECT_READ_SCOPE_MISSING'] });
  assert.equal(participantAuthorization.allowed, true);
  assert.equal(deliveryAuthorizationError, null);
  assert.equal(deliveryPolicy.participantMode, 'active');
  assert.equal(deliveryPolicy.readOnlyRun, false);
  assert.equal(result.route, 'resume');
  assert.equal(result.metadata.lifecycleStage, 'execution');
  assert.equal(result.metadata.readiness, 'working');
  assert.equal(result.issue, String(scenario.sourceIssue.issueNumber));
  assert.deepEqual(trace.trustedIssueReads, [{ repository: scenario.sourceIssue.repositoryFullName, issueNumber: scenario.sourceIssue.issueNumber }]);
  assert.equal(trace.modelCalls, 0, 'manual Issue-first recovery must not invoke a model');
  assert.equal(trace.actorPermissionReads.length, 1);
  assert.deepEqual(trace.protectedEffects, []);
});

test('direct recovery still requires the codex-delivery workflow and remains shadow read-only', () => {
  const registry = parseParticipantRegistry(participantSource);
  const directRecovery = resolveDeliveryParticipant({
    controllerRepository: 'agentic-delivery-lab/agentic-delivery',
    eventName: 'workflow_dispatch',
    githubRef: 'refs/heads/main',
    callerWorkflowRef: 'agentic-delivery-lab/agentic-delivery/.github/workflows/codex-delivery.yml@refs/heads/main',
    route: '',
    originRepository: 'agentic-delivery-lab/agentic-delivery',
    originRepositoryId: '1358455028',
    eventRepository: 'agentic-delivery-lab/agentic-delivery',
    eventRepositoryId: '1358455028',
    forceReadOnly: false,
  }, registry, {
    repository: { id: 1358455028, full_name: 'agentic-delivery-lab/agentic-delivery' },
  });
  assert.equal(directRecovery.participantMode, 'shadow');
  assert.equal(directRecovery.readOnlyRun, true);
});
