import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';

import { parseParticipantRegistry } from '../../scripts/lib/participant-registry.mjs';
import { resolveDeliveryParticipant } from '../../scripts/lib/resolve-delivery-participant.mjs';
import { invocationEventSupported } from '../../scripts/lib/agent-invocation.mjs';
import { parseRepositoryYaml } from '../../scripts/lib/yaml.mjs';
import { classifyAndRoute, loadLifecycleConfig } from '../../scripts/issue-intake.mjs';

const repositoryRoot = path.resolve(import.meta.dirname, '../..');
const fixturePath = path.join(repositoryRoot, 'tests/fixtures/cross-stream-acceptance/scenarios.json');
const fixtures = JSON.parse(await readFile(fixturePath, 'utf8'));
const config = await loadLifecycleConfig(repositoryRoot);
const participantSource = parseRepositoryYaml(
  await readFile(path.join(repositoryRoot, 'config/participants.yml'), 'utf8'),
  'participant registry',
);

function fixtureRegistry(sourceIssue) {
  const existing = Object.values(participantSource.repositories)[0];
  const value = {
    ...structuredClone(participantSource),
    repositories: {
      ...structuredClone(participantSource.repositories),
      [sourceIssue.repositoryId]: {
        ...structuredClone(existing),
        expectedFullName: sourceIssue.repositoryFullName,
        mode: 'active',
      },
    },
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
      issue: { number: sourceIssue.issueNumber },
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
    }, fixtureRegistry(sourceIssue), {
      repository: { id: Number(eventRepositoryId), full_name: eventRepository },
    });
  } catch (error) {
    deliveryAuthorizationError = error;
  }
  return { result, trace, deliveryPolicy, deliveryAuthorizationError };
}

test('factory capability work is routed only from its revalidated synthetic source Issue', async () => {
  assert.equal(fixtures.evidenceClass, 'offline-fixture');
  const scenario = fixtures.scenarios.factoryCapability;

  const { result, trace, deliveryPolicy, deliveryAuthorizationError } = await runIssueRoute(scenario);
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

  const { result, trace, deliveryPolicy, deliveryAuthorizationError } = await runIssueRoute(scenario);
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

test('same-number Issues stay isolated across synthetic repositories', async () => {
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
});

test('duplicate and out-of-order Issue events keep the same source identity and route', async () => {
  const scenario = fixtures.scenarios.factoryCapability;
  const later = await runIssueRoute(scenario, { eventAction: 'edited' });
  const delayedEarlier = await runIssueRoute(scenario, { eventAction: 'opened' });
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
  }
});

test('Project-only events cannot enter Issue routing even when the card references an Issue', async () => {
  assert.equal(invocationEventSupported('projects_v2_item', 'edited'), false);
  let fetches = 0;
  let modelCalls = 0;
  const sourceIssue = fixtures.scenarios.factoryCapability.sourceIssue;
  const origin = sourceIssue.repositoryFullName;
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

test('a selected Issue route cannot reach delivery when the triggering repository ID mismatches', async () => {
  const scenario = fixtures.scenarios.factoryCapability;
  const { result, trace, deliveryPolicy, deliveryAuthorizationError } = await runIssueRoute(scenario, {
    eventRepositoryId: '9000001999',
  });
  assert.equal(result.route, 'implement');
  assert.equal(trace.modelCalls, 1, 'semantic route selection precedes the reusable delivery authorization boundary');
  assert.equal(deliveryPolicy, null);
  assert.match(deliveryAuthorizationError.message, /does not match the triggering event/);
  assert.deepEqual(trace.protectedEffects, [], 'a rejected delivery policy must block downstream protected effects');
});

test('synthetic evaluation evidence is retained on an owner hold without model or protected effects', () => {
  const scenario = fixtures.scenarios.evaluationFinding;
  const report = scenario.report;
  assert.equal(report.classification, 'synthetic');
  assert.equal(report.results.deterministicChecks[0].outcome, 'fail');
  assert.match(report.results.deterministicChecks[0].details, /no canonical owner or actionable repository target/);
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

  const { result, trace, deliveryPolicy, deliveryAuthorizationError } = await runIssueRoute(scenario, { manualRecovery: true });
  assert.equal(deliveryAuthorizationError, null);
  assert.equal(deliveryPolicy.participantMode, 'active');
  assert.equal(result.route, 'resume');
  assert.equal(result.metadata.lifecycleStage, 'execution');
  assert.equal(result.metadata.readiness, 'working');
  assert.equal(trace.modelCalls, 0, 'manual Issue-first recovery must not invoke a model');
  assert.equal(trace.actorPermissionReads.length, 1);
  assert.deepEqual(trace.protectedEffects, []);
});
