// agentic-primitive: {"id":"issue-metadata-migration","kind":"script","enforcement":"deterministic","adrs":["ADR-0012","ADR-0013"],"domains":["agentic-delivery-governance"]}

import { issueMetadata, issueTypes, lifecycleStages, readinessOptions } from './issue-metadata.mjs';
import { bindIssueMetadataConfig, setIssueFields, setIssueType } from './issue-field-api.mjs';

function labels(issue) {
  return (issue?.labels ?? []).map((label) => typeof label === 'string' ? label : label?.name).filter(Boolean);
}

function governanceLabels(config) {
  return new Set((config?.governance?.labels ?? []).map((label) => label.name ?? label.label ?? label));
}

function legacyStateLabels(config) {
  return new Set(Object.keys(config?.legacy?.state_labels ?? {}));
}

function legacyTypeLabels(config) {
  return new Set(Object.keys(config?.legacy?.type_labels ?? {}));
}

function issueTypeId(organizationIssueTypes, nativeName) {
  const match = (organizationIssueTypes ?? []).find((type) => type.name === nativeName && type.isEnabled !== false);
  return match?.id ?? null;
}

function option(config, field, id) {
  const values = field === 'lifecycle_stage' ? lifecycleStages(config) : readinessOptions(config);
  return values.find((value) => value.id === id) ?? null;
}

export function organizationMetadataManifest(config) {
  return {
    version: config.version,
    organization: config.organization,
    issueTypes: issueTypes(config).map((type) => ({
      id: type.id,
      name: type.native_name,
      enabled: true,
      legacyLabel: type.legacy_label,
    })),
    pinnedIssueFields: ['lifecycle_stage', 'readiness'].map((key) => ({
      key,
      id: config.fields[key].id,
      name: config.fields[key].name,
      kind: config.fields[key].kind,
      pinnedTo: config.fields[key].pinned_to,
      options: config.fields[key].options.map(({ id, name, description }) => ({ id, name, description })),
    })),
    templateSource: {
      organizationRepository: `${config.organization}/.github`,
      precedence: 'repository-local-overrides-organization',
      repositoryMigration: 'remove-local-forms-after-organization-defaults-are-observed',
    },
  };
}

/**
 * Build a deterministic, repeatable migration plan. Planning has no side
 * effects; applying it requires an explicit operator action.
 */
export function planIssueMetadataMigration({ issue = {}, config, organizationIssueTypes = [] } = {}) {
  const metadata = issueMetadata(issue, config);
  const currentLabels = labels(issue);
  const type = metadata.issueType.id ? issueTypes(config).find((candidate) => candidate.id === metadata.issueType.id) : null;
  const desiredStage = metadata.lifecycleStage ?? type?.initial_stage ?? 'intake';
  const desiredReadiness = metadata.readiness ?? type?.initial_readiness ?? 'not-ready';
  const actions = [];
  const nativeType = issue.issueType ?? issue.issue_type ?? null;
  if (metadata.issueType.source === 'native-unknown') {
    actions.push({ kind: 'manual-issue-type', issueType: metadata.issueType.nativeName, reason: `The observed native issue type ${metadata.issueType.nativeName} is not present in the versioned organization taxonomy.` });
  } else if (metadata.issueType.source === 'conflict') {
    actions.push({ kind: 'manual-issue-type', issueType: null, reason: 'Multiple legacy type labels classify this issue; choose one native organization issue type before migration.' });
  }
  if (!nativeType && type) {
    const nativeId = issueTypeId(organizationIssueTypes, type.native_name);
    actions.push(nativeId
      ? { kind: 'set-issue-type', issueTypeId: nativeId, issueType: type.native_name }
      : { kind: 'manual-issue-type', issueType: type.native_name, reason: 'The organization issue type ID was not observed.' });
  }
  if (!metadata.fieldPresence?.lifecycleStage || !metadata.lifecycleStage) {
    actions.push({ kind: 'set-field', field: 'lifecycle_stage', value: desiredStage, option: option(config, 'lifecycle_stage', desiredStage) });
  }
  if (!metadata.fieldPresence?.readiness || !metadata.readiness) {
    actions.push({ kind: 'set-field', field: 'readiness', value: desiredReadiness, option: option(config, 'readiness', desiredReadiness) });
  }
  const canRemoveTypeFallback = Boolean(nativeType || actions.some((action) => action.kind === 'set-issue-type'));
  const removeLabels = currentLabels.filter((label) => legacyStateLabels(config).has(label)
    || (canRemoveTypeFallback && legacyTypeLabels(config).has(label)));
  if (removeLabels.length) actions.push({ kind: 'remove-legacy-labels', labels: removeLabels });
  return {
    version: config.version,
    issue: issue.number ?? null,
    idempotent: true,
    authoritative: { issueType: 'organization-native', lifecycleStage: 'organization-issue-field', readiness: 'organization-issue-field' },
    current: {
      issueType: metadata.issueType.id,
      lifecycleStage: metadata.lifecycleStage,
      readiness: metadata.readiness,
      labels: currentLabels,
    },
    target: { issueType: type?.id ?? null, lifecycleStage: desiredStage, readiness: desiredReadiness },
    actions,
    blocked: actions.filter((action) => action.kind === 'manual-issue-type').map((action) => action.reason),
    governanceLabels: currentLabels.filter((label) => governanceLabels(config).has(label)),
  };
}

export function migrationLabels({ issue = {}, config, plan } = {}) {
  const current = labels(issue);
  const removals = new Set((plan?.actions ?? []).find((action) => action.kind === 'remove-legacy-labels')?.labels ?? []);
  return current.filter((label) => !removals.has(label));
}

/**
 * Apply only the operations present in a previously generated plan. The
 * caller owns the REST label endpoint and must verify the result afterward.
 */
export async function applyIssueMetadataMigration({ plan, issue, config, graphql, updateLabels, verify, bindings = {}, actor = 'controller' } = {}) {
  if (actor !== 'controller') throw new Error('Only the deterministic controller may apply metadata migration.');
  if (!plan || plan.idempotent !== true) throw new Error('A validated idempotent migration plan is required.');
  for (const action of plan.actions ?? []) {
    if (action.kind === 'manual-issue-type') throw new Error(`Cannot migrate issue type automatically: ${action.reason}`);
    if (action.kind === 'set-issue-type') {
      if (!issue?.id) throw new Error('Issue node ID is required for native type migration.');
      await setIssueType({ graphql, issueId: issue.id, issueTypeId: bindings.issueTypeIds?.[action.issueType] ?? action.issueTypeId, actor });
    }
  }
  const values = Object.fromEntries((plan.actions ?? []).filter((action) => action.kind === 'set-field').map((action) => [action.field, action.value]));
  if (Object.keys(values).length) {
    const boundConfig = bindIssueMetadataConfig(config, { fields: bindings.fields ?? {} });
    if (!issue?.id) throw new Error('Issue node ID is required for issue-field migration.');
    await setIssueFields({ graphql, issueId: issue.id, config: boundConfig, values, actor });
  }
  if ((plan.actions ?? []).some((action) => ['set-issue-type', 'set-field'].includes(action.kind)) && typeof verify === 'function') {
    await verify();
  }
  const nextLabels = migrationLabels({ issue, config, plan });
  if (nextLabels.join('\u0000') !== labels(issue).join('\u0000')) {
    if (typeof updateLabels !== 'function') throw new Error('A label update function is required to remove legacy metadata.');
    await updateLabels(nextLabels);
  }
  return { ...plan, applied: true, labels: nextLabels };
}
