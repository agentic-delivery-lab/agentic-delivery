import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';

import { parseRepositoryYaml } from '../../scripts/lib/yaml.mjs';
import { issueFieldBindingMaskCommands } from '../../scripts/mask-issue-field-bindings.mjs';
import {
  EXPECTED_ORGANIZATION_ISSUE_FORMS,
  loadOrganizationIssueForms,
} from '../helpers/organization-issue-forms.mjs';
import { validateIssueMetadataConfig } from '../../scripts/lib/issue-metadata.mjs';

const repositoryRoot = path.resolve(import.meta.dirname, '../..');

async function text(relativePath) {
  return readFile(path.join(repositoryRoot, relativePath), 'utf8');
}

test('issue intake configuration keeps issue type, lifecycle stage, readiness, and governance separate', async () => {
  const config = parseRepositoryYaml(await text('config/issue-metadata.yml'), 'issue metadata configuration');
  assert.deepEqual(config.issue_types.map((type) => type.name), [
    'Idea', 'Research', 'Feature / Outcome', 'Bug', 'Task', 'Requirements',
    'Architecture Decision', 'Implementation', 'Validation',
  ]);
  assert.ok(config.issue_types.every((type) => type.native_name));
  assert.deepEqual(config.fields.lifecycle_stage.options.map((option) => option.id), [
    'intake', 'discovery', 'definition', 'decision', 'planning', 'execution',
    'validation', 'acceptance', 'done', 'parked',
  ]);
  assert.deepEqual(config.fields.readiness.options.map((option) => option.id), [
    'not-ready', 'needs-info', 'ready', 'working', 'waiting', 'awaiting-human', 'blocked',
  ]);
  assert.deepEqual(config.fields.lifecycle_stage.pinned_to, ['all-issue-types', 'issues-without-type']);
  assert.deepEqual(config.fields.readiness.pinned_to, ['all-issue-types', 'issues-without-type']);
  assert.ok(config.governance.labels.some((item) => item.name === 'adr:needed'));
  assert.ok(!config.governance.labels.some((item) => item.name === 'adr:required'));
  assert.deepEqual(config.readiness.planning_types, ['bug', 'feature', 'task', 'implementation']);
  assert.deepEqual(config.readiness.blocking_governance, ['adr:needed', 'adr:proposed', 'adr:removal']);
  assert.equal(config.authority.issue_type, 'organization-native');
  assert.equal(config.authority.lifecycle, 'organization-issue-field');
  assert.equal(config.authority.delivery_state, 'organization-issue-field');
  assert.equal(config.authority.execution_state, 'runner-local');
  assert.deepEqual(config.field_compatibility, {
    canonical_key: 'delivery_state',
    canonical_name: 'Delivery State',
    legacy_key: 'readiness',
    legacy_id: 'delivery-readiness',
    legacy_name: 'Delivery Readiness',
    mode: 'legacy-authoritative',
    migration_adr: 'ADR-0019',
    duplicate_field_forbidden: true,
    option_identity: 'preserve',
  });
  assert.deepEqual(validateIssueMetadataConfig(config), { valid: true, errors: [] });
});

test('structured issue forms and generic fallback are present', async () => {
  const { forms, config } = await loadOrganizationIssueForms();
  for (const [template, expectedType] of Object.entries(EXPECTED_ORGANIZATION_ISSUE_FORMS)) {
    const form = forms[template];
    assert.ok(form);
    assert.equal(form.type, expectedType);
    assert.ok(Array.isArray(form.body) && form.body.length > 1);
  }
  assert.equal(config.blank_issues_enabled, true);
});

test('repository has no local issue-form override', async () => {
  await assert.rejects(
    access(path.join(repositoryRoot, '.github', 'ISSUE_TEMPLATE')),
    (error) => error.code === 'ENOENT',
  );
});

test('trusted intake jobs resolve pnpm from the nested bootstrap manifest', async () => {
  const intakeWorkflow = parseRepositoryYaml(await text('.github/workflows/issue-intake.yml'), 'issue intake workflow');
  for (const jobName of ['authorize', 'classify']) {
    const setup = intakeWorkflow.jobs[jobName].steps.find((step) => step.name === 'Set up pnpm and Node.js');
    assert.ok(setup, `${jobName} sets up its trusted runtime`);
    assert.equal(setup.with['package-json-file'], 'trusted-intake/package.json');
  }
});

test('organization issue-field bindings use Actions secrets through reusable workflows', async () => {
  const intake = parseRepositoryYaml(await text('.github/workflows/issue-intake.yml'), 'issue intake workflow');
  const invocation = parseRepositoryYaml(await text('.github/workflows/agent-invocation.yml'), 'agent invocation workflow');
  const delivery = parseRepositoryYaml(await text('.github/workflows/codex-delivery.yml'), 'codex delivery workflow');
  const secretRef = '${{ secrets.ISSUE_FIELD_BINDINGS_JSON }}';
  const intakeSource = await text('.github/workflows/issue-intake.yml');
  const deliverySource = await text('.github/workflows/codex-delivery.yml');
  const classifier = intake.jobs.classify.steps.find((step) => step.name === 'Reason about and validate issue routing');
  const sourceDelivery = delivery.jobs.deliver.steps.find((step) => step.name === 'Run source issue delivery');

  assert.equal(intake.on.workflow_call.secrets.ISSUE_FIELD_BINDINGS_JSON.required, true);
  assert.equal(invocation.jobs.intake.secrets.ISSUE_FIELD_BINDINGS_JSON, secretRef);
  assert.equal(classifier.env.ISSUE_FIELD_BINDINGS_JSON, secretRef);
  assert.equal(intake.jobs.deliver.secrets.ISSUE_FIELD_BINDINGS_JSON, secretRef);
  assert.equal(delivery.on.workflow_call.secrets.ISSUE_FIELD_BINDINGS_JSON.required, true);
  assert.equal(sourceDelivery.env.ISSUE_FIELD_BINDINGS_JSON, secretRef);
  assert.doesNotMatch(intakeSource, /vars\.ISSUE_FIELD_BINDINGS_JSON/);
  assert.doesNotMatch(deliverySource, /vars\.ISSUE_FIELD_BINDINGS_JSON/);
});

test('organization issue-field binding components are masked before each consumer runs', async () => {
  const intake = parseRepositoryYaml(await text('.github/workflows/issue-intake.yml'), 'issue intake workflow');
  const delivery = parseRepositoryYaml(await text('.github/workflows/codex-delivery.yml'), 'codex delivery workflow');
  const intakeSteps = intake.jobs.classify.steps;
  const deliverySteps = delivery.jobs.deliver.steps;
  const release = JSON.parse(await text('config/controller-release.json'));
  const intakeMask = intakeSteps.findIndex((step) => step.name === 'Mask organization issue-field binding components');
  const deliveryMask = deliverySteps.findIndex((step) => step.name === 'Mask organization issue-field binding components');
  const intakeBootstrap = intakeSteps.findIndex((step) => step.name === 'Check out trusted intake');
  const deliveryBootstrap = deliverySteps.findIndex((step) => step.name === 'Check out trusted issue-field masker');
  const classifier = intakeSteps.findIndex((step) => step.name === 'Reason about and validate issue routing');
  const sourceDelivery = deliverySteps.findIndex((step) => step.name === 'Run source issue delivery');
  const secretRef = '${{ secrets.ISSUE_FIELD_BINDINGS_JSON }}';

  assert.ok(intakeBootstrap >= 0 && intakeBootstrap < intakeMask);
  assert.ok(intakeMask >= 0 && intakeMask < classifier);
  assert.ok(deliveryBootstrap >= 0 && deliveryBootstrap < deliveryMask);
  assert.ok(deliveryMask >= 0 && deliveryMask < sourceDelivery);
  assert.equal(intakeSteps[intakeMask].env.ISSUE_FIELD_BINDINGS_JSON, secretRef);
  assert.equal(deliverySteps[deliveryMask].env.ISSUE_FIELD_BINDINGS_JSON, secretRef);
  assert.equal(intakeSteps[intakeMask]['working-directory'], 'trusted-intake');
  assert.equal(deliverySteps[deliveryMask]['working-directory'], 'trusted-bootstrap');
  assert.equal(intakeSteps[intakeBootstrap].with.ref, release.bootstrapCommit);
  assert.equal(deliverySteps[deliveryBootstrap].with.path, 'trusted-bootstrap');
  assert.equal(deliverySteps[deliveryBootstrap].with.ref, release.bootstrapCommit);
  assert.equal(issueFieldBindingMaskCommands(JSON.stringify({ fields: {
    lifecycle_stage: { id: 'field-id', options: { ready: 'option-id' } },
  } })), '::add-mask::field-id\n::add-mask::option-id\n');
});

test('issue events invoke intake and only an authorized route invokes reusable delivery', async () => {
  const intakeWorkflow = parseRepositoryYaml(await text('.github/workflows/issue-intake.yml'), 'issue intake workflow');
  const deliveryWorkflow = parseRepositoryYaml(await text('.github/workflows/codex-delivery.yml'), 'codex delivery workflow');
  const invocationWorkflow = parseRepositoryYaml(await text('.github/workflows/agent-invocation.yml'), 'agent invocation workflow');
  assert.ok(intakeWorkflow.on.issues.types.includes('opened'));
  assert.ok(intakeWorkflow.on.issues.types.includes('closed'));
  assert.ok(intakeWorkflow.jobs.classify);
  assert.equal(intakeWorkflow.jobs.classify.permissions.contents, 'read');
  assert.equal(intakeWorkflow.jobs.classify.permissions.issues, 'read');
  assert.equal(intakeWorkflow.jobs.classify.permissions['pull-requests'], 'read');
  assert.ok(intakeWorkflow.jobs.deliver.uses?.includes('codex-delivery.yml'));
  assert.ok(intakeWorkflow.jobs.classify.outputs.lifecycle_stage);
  assert.ok(intakeWorkflow.jobs.classify.outputs.readiness);
  assert.ok(intakeWorkflow.jobs.classify.outputs.invocation_accepted);
  assert.ok(intakeWorkflow.jobs.classify.outputs.participant_mode);
  assert.equal(intakeWorkflow.jobs.classify.outputs.participant_mode, '${{ steps.intake-policy.outputs.participant_mode }}');
  assert.equal(
    intakeWorkflow.jobs.classify.outputs.read_only_run,
    '${{ steps.intake-policy.outputs.read_only_run }}',
  );
  assert.ok(intakeWorkflow.jobs.classify.outputs.controller_version);
  assert.ok(intakeWorkflow.jobs.classify.outputs.controller_commit);
  const finalizer = intakeWorkflow.jobs['finalize-invocation'];
  assert.ok(finalizer.needs.includes('classify'));
  const finalizerSteps = finalizer.steps;
  const finalizerBoundaryCheckout = finalizerSteps.find((step) => step.name === 'Check out the workflow revision for finalizer event normalization');
  const finalizerNodeSetup = finalizerSteps.find((step) => step.name === 'Set up Node.js and pnpm for finalizer normalization');
  const finalizerNormalize = finalizerSteps.find((step) => step.name === 'Normalize the wrapped event for the pinned receipt finalizer');
  const finalizerPinValidation = finalizerSteps.find((step) => step.name === 'Validate the participant controller pin');
  const finalizerCheckout = finalizerSteps.find((step) => step.name === 'Check out the controller');
  const finalizeReceipt = finalizerSteps.find((step) => step.name === 'Persist invocation completion or retryability');
  assert.equal(finalizerBoundaryCheckout.with.ref, '${{ github.sha }}');
  assert.equal(finalizerBoundaryCheckout.with.path, 'dispatch-boundary');
  assert.equal(finalizerNodeSetup.with['package-json-file'], 'dispatch-boundary/package.json');
  assert.equal(finalizerNormalize.id, 'normalized-finalizer-event');
  assert.equal(finalizerNormalize.env.SOURCE_EVENT_PATH, '${{ github.event_path }}');
  assert.match(finalizerNormalize.run, /node dispatch-boundary\/scripts\/normalize-repository-dispatch-event\.mjs/);
  assert.equal(finalizeReceipt.env.CONTROLLER_EVENT_PATH, '${{ steps.normalized-finalizer-event.outputs.event_path }}');
  assert.equal(finalizerPinValidation.env.CONTROLLER_COMMIT, '${{ needs.classify.outputs.controller_commit }}');
  assert.match(finalizerPinValidation.run, /\^\[0-9a-f\]\{40\}\$/);
  assert.equal(finalizerCheckout.with.ref, '${{ needs.classify.outputs.controller_commit }}');
  assert.ok(finalizerSteps.indexOf(finalizerPinValidation) < finalizerSteps.indexOf(finalizerCheckout));
  assert.ok(finalizerSteps.indexOf(finalizerBoundaryCheckout) < finalizerSteps.indexOf(finalizerNormalize));
  assert.ok(finalizerSteps.indexOf(finalizerNormalize) < finalizerSteps.indexOf(finalizerPinValidation));
  assert.ok(finalizerSteps.indexOf(finalizerCheckout) < finalizerSteps.indexOf(finalizeReceipt));
  const intakeSource = await text('.github/workflows/issue-intake.yml');
  assert.match(intakeSource, /steps\.invocation\.outputs\.controller_commit \|\| steps\.participant\.outputs\.controller_commit/);
  assert.doesNotMatch(intakeSource, /inputs\.controller_commit|github\.event\.client_payload\.controller/);
  assert.match(intakeSource, /Check out the validated controller release/);
  assert.match(intakeSource, /ref: 01503edac6533370b24f2e882e6ea1f7b2a21304/);
  assert.doesNotMatch(intakeSource, /ref: main/);
  assert.ok(intakeSource.indexOf('Validate and normalize explicit agent invocation')
    < intakeSource.indexOf('Check out the validated controller release'));
  assert.equal(intakeWorkflow.jobs.classify.needs, 'authorize');
  assert.ok(intakeWorkflow.jobs.authorize);
  assert.equal(intakeWorkflow.jobs.authorize['runs-on'], 'ubuntu-latest');
  assert.equal(intakeWorkflow.jobs.authorize.permissions.issues, 'read');
  assert.equal(intakeWorkflow.on.workflow_dispatch.inputs.force_read_only.default, true);
  assert.equal(intakeWorkflow.on.workflow_dispatch.inputs.controller_commit, undefined);
  assert.equal(intakeWorkflow.on.workflow_call.inputs.controller_commit, undefined);
  const intakeCallerCheck = intakeWorkflow.jobs.authorize.steps.find((step) => step.name === 'Validate intake caller provenance');
  assert.ok(intakeCallerCheck);
  assert.equal(intakeCallerCheck.run, 'node scripts/validate-intake-caller.mjs');
  assert.equal(intakeCallerCheck['working-directory'], 'trusted-intake');
  assert.deepEqual(intakeCallerCheck.env, {
    EVENT_NAME: '${{ github.event_name }}',
    GIT_REF: '${{ github.ref }}',
    CALLER_WORKFLOW_REF: '${{ github.workflow_ref }}',
    AGENT_INVOCATION: '${{ inputs.agent_invocation || false }}',
    CURRENT_REPOSITORY: '${{ github.repository }}',
    CURRENT_REPOSITORY_ID: '${{ github.event.repository.id }}',
  });
  const authorizationSteps = intakeWorkflow.jobs.authorize.steps;
  const trustedAuthorizationCheckout = authorizationSteps.find((step) => step.name === 'Check out trusted authorization');
  const bootstrapCommit = JSON.parse(await text('config/controller-release.json')).bootstrapCommit;
  const setupAuthorizationRuntime = authorizationSteps.find((step) => step.name === 'Set up pnpm and Node.js');
  const installAuthorizationDependencies = authorizationSteps.find((step) => step.name === 'Install trusted authorization dependencies');
  const actorAuthorization = authorizationSteps.find((step) => step.name === 'Authorize the issue event actor before self-hosted intake');
  assert.ok(trustedAuthorizationCheckout);
  assert.equal(trustedAuthorizationCheckout.with.ref, bootstrapCommit);
  assert.ok(authorizationSteps.indexOf(trustedAuthorizationCheckout) < authorizationSteps.indexOf(setupAuthorizationRuntime));
  assert.ok(authorizationSteps.indexOf(setupAuthorizationRuntime) < authorizationSteps.indexOf(installAuthorizationDependencies));
  assert.ok(authorizationSteps.indexOf(installAuthorizationDependencies) < authorizationSteps.indexOf(intakeCallerCheck));
  assert.ok(authorizationSteps.indexOf(intakeCallerCheck) < authorizationSteps.indexOf(actorAuthorization));
  assert.equal(installAuthorizationDependencies.run, 'pnpm install --frozen-lockfile --ignore-scripts');
  assert.equal(installAuthorizationDependencies['working-directory'], 'trusted-intake');
  assert.doesNotMatch(intakeSource, /agentic-delivery-lab\/agentic-delivery/);
  assert.match(await text('.github/workflows/issue-intake.yml'), /authorize-issue-event\.mjs/);
  assert.match(await text('.github/workflows/issue-intake.yml'), /steps\.invocation\.outputs\.accepted == 'true'/);
  assert.doesNotMatch(await text('.github/workflows/issue-intake.yml'), /\n\s*issue_comment:\s*\n/);
  const intakeSteps = intakeWorkflow.jobs.classify.steps;
  const trustedIntakeCheckout = intakeSteps.find((step) => step.name === 'Check out trusted intake');
  const install = intakeSteps.find((step) => step.name === 'Install intake dependencies');
  const invocation = intakeSteps.find((step) => step.name === 'Validate and normalize explicit agent invocation');
  const participant = intakeSteps.find((step) => step.name === 'Resolve participant mode for direct intake');
  const intakePolicy = intakeSteps.find((step) => step.name === 'Resolve participant and read-only run policy');
  const routing = intakeSteps.find((step) => step.name === 'Reason about and validate issue routing');
  assert.ok(participant);
  assert.equal(participant.id, 'participant');
  assert.equal(participant.if, '${{ !inputs.agent_invocation }}');
  assert.match(participant.run, /loadParticipantRegistry\(\)/);
  assert.match(participant.run, /participantForRepository\(registry, process\.env\.ORIGIN_REPOSITORY_ID\)/);
  assert.match(participant.run, /participant\.expectedFullName !== process\.env\.ORIGIN_REPOSITORY/);
  assert.match(participant.run, /participant\.mode === 'disabled'/);
  assert.match(participant.run, /controller_version=\$\{participant\.controller\.version\}/);
  assert.match(participant.run, /controller_commit=\$\{participant\.controller\.commit\}/);
  assert.equal(participant['working-directory'], 'trusted-intake');
  assert.ok(intakePolicy);
  assert.equal(intakePolicy.id, 'intake-policy');
  assert.equal(intakePolicy.env.EVENT_NAME, '${{ github.event_name }}');
  assert.equal(intakePolicy.env.AGENT_INVOCATION, '${{ inputs.agent_invocation || false }}');
  assert.equal(intakePolicy.env.REGISTRY_PARTICIPANT_MODE, '${{ steps.participant.outputs.participant_mode }}');
  assert.equal(intakePolicy.env.INVOCATION_PARTICIPANT_MODE, '${{ steps.invocation.outputs.participant_mode }}');
  assert.equal(intakePolicy.env.FORCE_READ_ONLY, '${{ inputs.force_read_only || false }}');
  assert.match(intakePolicy.run, /scripts\/lib\/intake-policy\.mjs/);
  assert.equal(intakePolicy['working-directory'], 'trusted-intake');
  assert.ok(intakeSteps.indexOf(participant) < intakeSteps.indexOf(intakePolicy));
  assert.ok(intakeSteps.indexOf(invocation) < intakeSteps.indexOf(intakePolicy));
  assert.equal(routing.env.PARTICIPANT_MODE, '${{ steps.intake-policy.outputs.participant_mode }}');
  assert.equal(routing.env.READ_ONLY_RUN, '${{ steps.intake-policy.outputs.read_only_run }}');
  assert.equal(routing.env.CONTROL_PLANE_MODE, undefined);
  const controllerCheckout = intakeSteps.find((step) => step.name === 'Check out the validated controller release');
  const controllerInstall = intakeSteps.find((step) => step.name === 'Install validated controller dependencies');
  assert.equal(trustedIntakeCheckout.with.path, 'trusted-intake');
  assert.equal(install['working-directory'], 'trusted-intake');
  assert.equal(invocation['working-directory'], 'trusted-intake');
  assert.equal(controllerCheckout.with.path, undefined);
  assert.equal(controllerInstall['working-directory'], '.');
  assert.match(controllerInstall.run, /pnpm install --frozen-lockfile --ignore-scripts/);
  assert.ok(intakeSteps.indexOf(controllerCheckout) < intakeSteps.indexOf(controllerInstall));
  assert.ok(intakeSteps.indexOf(controllerInstall) < intakeSteps.indexOf(routing));
  assert.equal(intakeWorkflow.jobs.deliver.permissions.contents, 'read');
  assert.equal(intakeWorkflow.jobs.deliver.permissions.issues, 'write');
  assert.equal(intakeWorkflow.jobs.deliver.permissions['pull-requests'], undefined);
  assert.match(intakeWorkflow.jobs.deliver.if, /needs\.classify\.outputs\.participant_mode == 'active'/);
  assert.match(intakeWorkflow.jobs.deliver.if, /needs\.classify\.outputs\.read_only_run == 'false'/);
  assert.equal(intakeWorkflow.jobs.deliver.with.participant_mode, undefined);
  assert.equal(intakeWorkflow.jobs.deliver.with.controller_commit, undefined);
  assert.equal(intakeWorkflow.jobs.deliver.with.read_only_run, undefined);
  assert.equal(intakeWorkflow.jobs.deliver.secrets.CODEX_DELIVERY_APP_PRIVATE_KEY, '${{ secrets.CODEX_DELIVERY_APP_PRIVATE_KEY }}');
  assert.equal(intakeWorkflow.jobs.deliver.secrets.CODEX_DELIVERY_APP_ID, undefined);
  assert.equal(intakeWorkflow.jobs.deliver.secrets.CODEX_DELIVERY_APP_INSTALLATION_ID, undefined);
  assert.equal(intakeWorkflow.on.workflow_call.secrets.CODEX_DELIVERY_APP_ID, undefined);
  assert.equal(intakeWorkflow.on.workflow_call.secrets.CODEX_DELIVERY_APP_INSTALLATION_ID, undefined);
  assert.equal(invocationWorkflow.jobs.intake.secrets.CODEX_DELIVERY_APP_ID, undefined);
  assert.equal(invocationWorkflow.jobs.intake.secrets.CODEX_DELIVERY_APP_INSTALLATION_ID, undefined);
  assert.equal(invocationWorkflow.jobs.intake.secrets.CODEX_DELIVERY_APP_PRIVATE_KEY, '${{ secrets.CODEX_DELIVERY_APP_PRIVATE_KEY }}');
  assert.equal(invocation.env.CODEX_DELIVERY_APP_ID, '${{ vars.CODEX_DELIVERY_APP_ID }}');
  assert.equal(invocation.env.CODEX_DELIVERY_APP_INSTALLATION_ID, '${{ vars.CODEX_DELIVERY_APP_INSTALLATION_ID }}');
  assert.equal(invocation.env.CODEX_DELIVERY_APP_PRIVATE_KEY, '${{ secrets.CODEX_DELIVERY_APP_PRIVATE_KEY }}');
  assert.equal(routing.env.CODEX_DELIVERY_APP_ID, '${{ vars.CODEX_DELIVERY_APP_ID }}');
  assert.equal(routing.env.CODEX_DELIVERY_APP_INSTALLATION_ID, '${{ vars.CODEX_DELIVERY_APP_INSTALLATION_ID }}');
  assert.equal(routing.env.CODEX_DELIVERY_APP_PRIVATE_KEY, '${{ secrets.CODEX_DELIVERY_APP_PRIVATE_KEY }}');
  assert.equal(deliveryWorkflow.on.workflow_call.inputs.issue.required, true);
  assert.equal(deliveryWorkflow.on.workflow_call.inputs.route.required, true);
  assert.equal(deliveryWorkflow.on.workflow_call.inputs.participant_mode, undefined);
  assert.equal(deliveryWorkflow.on.workflow_call.inputs.controller_commit, undefined);
  assert.equal(deliveryWorkflow.on.workflow_call.inputs.read_only_run, undefined);
  assert.equal(deliveryWorkflow.on.workflow_dispatch.inputs.force_read_only.default, true);
  assert.equal(deliveryWorkflow.on.workflow_dispatch.inputs.controller_commit, undefined);
  assert.equal(deliveryWorkflow.on.workflow_call.secrets.CODEX_DELIVERY_APP_PRIVATE_KEY.required, true);
  assert.equal(deliveryWorkflow.on.workflow_call.secrets.CODEX_DELIVERY_APP_ID, undefined);
  assert.equal(deliveryWorkflow.on.workflow_call.secrets.CODEX_DELIVERY_APP_INSTALLATION_ID, undefined);
  const deliveryRun = deliveryWorkflow.jobs.deliver.steps.find((step) => step.name === 'Run source issue delivery');
  assert.equal(deliveryRun.env.CODEX_DELIVERY_APP_ID, '${{ vars.CODEX_DELIVERY_APP_ID }}');
  assert.equal(deliveryRun.env.CODEX_DELIVERY_APP_INSTALLATION_ID, '${{ vars.CODEX_DELIVERY_APP_INSTALLATION_ID }}');
  assert.equal(deliveryRun.env.CODEX_DELIVERY_APP_PRIVATE_KEY, '${{ secrets.CODEX_DELIVERY_APP_PRIVATE_KEY }}');
  assert.equal(deliveryWorkflow.jobs.deliver.permissions.contents, 'read');
  assert.equal(deliveryWorkflow.jobs.deliver.permissions['pull-requests'], undefined);
  assert.equal(deliveryWorkflow.jobs.deliver.needs, 'resolve');
  assert.match(deliveryWorkflow.jobs.deliver.if, /needs\.resolve\.outputs\.participant_mode == 'active'/);
  assert.match(deliveryWorkflow.jobs.deliver.if, /needs\.resolve\.outputs\.read_only_run == 'false'/);
  assert.equal(deliveryWorkflow.jobs.deliver.env.ORIGIN_REPOSITORY, '${{ inputs.origin_repository || github.repository }}');
  assert.equal(deliveryWorkflow.jobs.deliver.env.ORIGIN_REPOSITORY_ID, '${{ inputs.origin_repository_id || github.event.repository.id }}');
  assert.equal(deliveryWorkflow.jobs.deliver.env.PARTICIPANT_MODE, '${{ needs.resolve.outputs.participant_mode }}');
  assert.equal(deliveryWorkflow.jobs.deliver.env.READ_ONLY_RUN, '${{ needs.resolve.outputs.read_only_run }}');
  assert.equal(deliveryWorkflow.jobs.deliver.env.CONTROL_PLANE_COMMIT, '${{ needs.resolve.outputs.controller_commit }}');
  const resolver = deliveryWorkflow.jobs.resolve;
  assert.equal(resolver['runs-on'], 'ubuntu-latest');
  assert.equal(resolver.permissions.contents, 'read');
  assert.equal(resolver.permissions.issues, undefined);
  const manualBootstrap = resolver.steps.find((step) => step.name === 'Check out trusted participant registry bootstrap');
  assert.equal(manualBootstrap.if, undefined);
  assert.equal(manualBootstrap.with.path, 'trusted-bootstrap');
  assert.equal(manualBootstrap.with.ref, '01503edac6533370b24f2e882e6ea1f7b2a21304');
  const participantPolicy = resolver.steps.find((step) => step.name === 'Resolve caller and participant policy from trusted inputs');
  assert.equal(participantPolicy.id, 'participant-policy');
  assert.equal(participantPolicy.env.CALLER_WORKFLOW_REF, '${{ github.workflow_ref }}');
  assert.equal(participantPolicy.env.EVENT_PAYLOAD_PATH, '${{ steps.normalized-event.outputs.event_path || github.event_path }}');
  assert.equal(participantPolicy.env.FORCE_READ_ONLY, "${{ github.event_name == 'workflow_dispatch' && format('{0}', github.event.inputs.force_read_only) || 'unset' }}");
  assert.match(participantPolicy.run, /resolve-delivery-participant\.mjs/);
  assert.equal(resolver.outputs.controller_commit, '${{ steps.participant-policy.outputs.controller_commit }}');
  const installDelivery = deliveryWorkflow.jobs.deliver.steps.find((step) => step.name === 'Install trusted controller dependencies');
  const runDelivery = deliveryWorkflow.jobs.deliver.steps.find((step) => step.name === 'Run source issue delivery');
  const pinnedDeliveryCheckout = deliveryWorkflow.jobs.deliver.steps.find((step) => step.name === 'Check out pinned controller');
  assert.equal(pinnedDeliveryCheckout.with.ref, '${{ needs.resolve.outputs.controller_commit }}');
  assert.ok(deliveryWorkflow.jobs.deliver.steps.indexOf(pinnedDeliveryCheckout) < deliveryWorkflow.jobs.deliver.steps.indexOf(installDelivery));
  assert.ok(deliveryWorkflow.jobs.deliver.steps.indexOf(installDelivery) < deliveryWorkflow.jobs.deliver.steps.indexOf(runDelivery));
  assert.ok(!deliveryWorkflow.on.issues);
  assert.ok(!deliveryWorkflow.on.issue_comment);
});
