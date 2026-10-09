import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';

import { authorizeParticipation, parseParticipantRegistry } from '../../scripts/lib/participant-registry.mjs';
import { resolveDeliveryParticipant } from '../../scripts/lib/resolve-delivery-participant.mjs';
import { invocationEventSupported, webhookEventSupported } from '../../scripts/lib/agent-invocation.mjs';
import { parseRepositoryYaml } from '../../scripts/lib/yaml.mjs';
import { classifyAndRoute, loadLifecycleConfig } from '../../scripts/issue-intake.mjs';
import { handleWebhook } from '../../api/github/webhook.mjs';

const repositoryRoot = path.resolve(import.meta.dirname, '../..');
const fixturePath = path.join(repositoryRoot, 'tests/fixtures/cross-stream-acceptance/scenarios.json');
const fixtures = JSON.parse(await readFile(fixturePath, 'utf8'));
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
  };
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
      callerWorkflowRef: `agentic-delivery-lab/agentic-delivery/.github/workflows/${manualRecovery ? 'codex-delivery' : 'issue-intake'}.yml@refs/heads/main`,
      route: manualRecovery ? '' : result.route,
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

test('factory capability work is routed only from its revalidated synthetic source Issue', async () => {
  assert.equal(fixtures.evidenceClass, 'offline-fixture');
  const scenario = fixtures.scenarios.factoryCapability;

  const { result, trace, participantAuthorization, deliveryPolicy, deliveryAuthorizationError } = await runIssueRoute(scenario);
  assert.equal(participantAuthorization.allowed, true);
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

  const { result, trace, participantAuthorization, deliveryPolicy, deliveryAuthorizationError } = await runIssueRoute(scenario);
  assert.equal(participantAuthorization.allowed, true);
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

test('Project priority and status do not change the source-Issue route', async () => {
  const scenario = fixtures.scenarios.productFeature;
  const baseline = await runIssueRoute(scenario);
  const alteredPlanningContext = structuredClone(scenario);
  alteredPlanningContext.planningContext.planningFields = [
    { key: 'portfolio-group', value: 'changed by synthetic Project event' },
    { key: 'portfolio-sequence', value: 1 },
    { key: 'project-priority', value: 'highest' },
    { key: 'project-status', value: 'done' },
  ];
  const altered = await runIssueRoute(alteredPlanningContext);
  assert.equal(altered.result.route, baseline.result.route);
  assert.equal(altered.result.metadata.orchestrationPattern, baseline.result.metadata.orchestrationPattern);
  assert.equal(altered.trace.modelIssue.id, scenario.sourceIssue.issueNodeId);
  assert.equal(altered.trace.modelIssue.project, undefined);
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

test('duplicate and out-of-order Issue events keep the same source identity and route', async () => {
  const scenario = fixtures.scenarios.factoryCapability;
  const later = await runIssueRoute(scenario, { eventAction: 'edited' });
  const delayedEarlier = await runIssueRoute(scenario, {
    eventAction: 'opened',
    eventIssue: { state: 'closed', title: 'stale out-of-order title', body: 'stale out-of-order body' },
  });
  const duplicate = await runIssueRoute(scenario, { eventAction: 'edited' });
  assert.equal(later.result.route, 'implement');
  assert.equal(delayedEarlier.result.route, later.result.route);
  assert.equal(duplicate.result.route, later.result.route);
  for (const run of [later, delayedEarlier, duplicate]) {
    assert.deepEqual(run.trace.trustedIssueReads, [{
      repository: scenario.sourceIssue.repositoryFullName,
      issueNumber: scenario.sourceIssue.issueNumber,
    }]);
    assert.deepEqual(run.trace.protectedEffects, []);
    assert.equal(run.trace.modelIssue.state, 'open');
    assert.equal(run.trace.modelIssue.title, scenario.sourceIssue.title);
  }
  assert.equal(delayedEarlier.trace.modelIssue.body, scenario.sourceIssue.body);
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

test('synthetic evaluation evidence is retained on an owner hold without model or protected effects', () => {
  const scenario = fixtures.scenarios.evaluationFinding;
  const report = scenario.report;
  assert.equal(report.classification, 'synthetic');
  assert.equal(report.results.deterministicChecks[0].outcome, 'fail');
  assert.match(report.results.deterministicChecks[0].details, /no canonical owner or actionable repository target/);
  assert.equal(report.results.deterministicChecks[0].evidenceRefs[0], 'tests/fixtures/cross-stream-acceptance/scenarios.json');
  assert.equal(scenario.disposition.status, 'hold');
  assert.equal(scenario.disposition.ownership.status, 'unresolved');
  assert.equal(scenario.disposition.ownership.actionableTarget, null);
  assert.equal(scenario.disposition.executionAuthorized, false);
  assert.equal(scenario.disposition.sourceReportRef, report.reportId);
  assert.equal(scenario.disposition.sourceEvidenceRef, `${report.reportId}#evidence`);
  assert.equal(scenario.disposition.improvementIssueProposal.createdIssue, false);
  assert.equal(scenario.disposition.improvementIssueProposal.status, 'proposed-for-human-project-triage');
  assert.deepEqual(scenario.disposition.protectedEffects, []);
  assert.equal(scenario.disposition.modelInvocations, 0);
  assert.deepEqual(report.evidence.map(({ kind }) => kind), ['source', 'result']);
  assert.equal(report.evidence[0].ref, 'tests/fixtures/cross-stream-acceptance/scenarios.json');
  assert.deepEqual(Object.keys(report).sort(), [
    '$schema', 'baseline', 'classification', 'comparison', 'contractVersion', 'dataset', 'dependencies',
    'evidence', 'evaluationMode', 'generatedAt', 'graders', 'layer', 'limitations', 'recommendation',
    'regressionAssessment', 'reportId', 'results', 'review', 'subject', 'uncertainty',
  ].sort());
  assert.equal(scenario.sourceIssue.repositoryId, '9000001083');
  assert.equal(scenario.sourceIssue.issueNodeId, 'ISSUE_FIXTURE_EVALUATION_17');
  assert.equal(scenario.contractAdoption.status, 'review-pending');
  assert.equal(scenario.contractAdoption.routerVersion, '1.0.0');
  assert.equal(scenario.contractAdoption.architectureProposalVersion, '2.0.0');
  assert.equal(fixtures.contractsUnderReview.projectPlanning.pullRequest, 102);
  assert.equal(fixtures.contractsUnderReview.projectPlanning.status, 'review-pending');
});

test('missing Project read scope records a planning gap while Issue-first recovery remains authorized', async () => {
  const scenario = fixtures.scenarios.projectReadFailure;
  assert.equal(scenario.projectPlanningGap.code, 'PROJECT_READ_SCOPE_MISSING');
  assert.equal(scenario.projectPlanningGap.executionAuthorized, false);

  const { result, trace, participantAuthorization, deliveryPolicy, deliveryAuthorizationError } = await runIssueRoute(scenario, { manualRecovery: true });
  assert.equal(participantAuthorization.allowed, true);
  assert.equal(deliveryAuthorizationError, null);
  assert.equal(deliveryPolicy.participantMode, 'active');
  assert.equal(result.route, 'resume');
  assert.equal(result.metadata.lifecycleStage, 'execution');
  assert.equal(result.metadata.readiness, 'working');
  assert.equal(trace.modelCalls, 0, 'manual Issue-first recovery must not invoke a model');
  assert.equal(trace.actorPermissionReads.length, 1);
  assert.deepEqual(trace.protectedEffects, []);
});
