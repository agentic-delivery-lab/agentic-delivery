// agentic-primitive: {"id":"issue-metadata-resolver","kind":"state-machine","enforcement":"deterministic","adrs":["ADR-0012","ADR-0013","ADR-0019"],"domains":["agentic-delivery-governance"]}

const ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const NATIVE_TYPE_SOURCES = ['issueType', 'issue_type', 'issue-type', 'type'];

export function normalize(value) {
  return String(value ?? '')
    .trim()
    .toLocaleLowerCase('en-US')
    .replace(/[\s_/]+/g, '-')
    .replace(/[^a-z0-9-]/g, '');
}

function array(value) {
  return Array.isArray(value) ? value : [];
}

function object(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

export function issueTypes(config) {
  return array(config?.issue_types ?? config?.types);
}

export function lifecycleStages(config) {
  return array(config?.fields?.lifecycle_stage?.options ?? config?.lifecycle?.stages);
}

export function readinessOptions(config) {
  return array(config?.fields?.readiness?.options ?? config?.readiness?.options);
}

export function typeById(config, id) {
  const wanted = normalize(id);
  return issueTypes(config).find((type) => normalize(type.id) === wanted);
}

export function stageById(config, id) {
  const wanted = normalize(id);
  return lifecycleStages(config).find((stage) => normalize(stage.id) === wanted);
}

export function readinessById(config, id) {
  const wanted = normalize(id);
  return readinessOptions(config).find((option) => normalize(option.id) === wanted);
}

function fieldDefinition(config, field) {
  if (field && typeof field === 'object') return field;
  return config?.fields?.[field] ?? null;
}

function fieldNames(field) {
  return [field?.id, field?.runtime_id, field?.github_id, field?.key, field?.name].filter((value) => typeof value === 'string');
}

function valueText(value) {
  if (value == null) return undefined;
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (typeof value !== 'object') return undefined;
  return value.name ?? value.value ?? value.text ?? value.date ?? value.option?.name;
}

function fieldEntryName(entry) {
  const field = entry?.field ?? entry?.issueField;
  return [field?.id, field?.key, field?.name, entry?.fieldId, entry?.fieldName, entry?.name]
    .find((value) => typeof value === 'string');
}

function fieldEntries(issue) {
  const candidates = [issue?.issueFieldValues, issue?.issue_field_values, issue?.fieldValues, issue?.fields];
  for (const candidate of candidates) {
    if (Array.isArray(candidate)) return candidate;
    if (candidate && Array.isArray(candidate.nodes)) return candidate.nodes;
  }
  return [];
}

export function fieldValue(issue = {}, field) {
  const definition = typeof field === 'string' ? { id: field, key: field, name: field } : field;
  const names = new Set(fieldNames(definition).map(normalize));
  for (const [key, value] of Object.entries(object(issue.fields))) {
    if (names.has(normalize(key))) return valueText(value);
  }
  for (const entry of fieldEntries(issue)) {
    if (!names.has(normalize(fieldEntryName(entry)))) continue;
    return valueText(entry.value ?? entry.selectedValue ?? entry.option ?? entry);
  }
  return undefined;
}

function nativeTypeName(issue) {
  for (const key of NATIVE_TYPE_SOURCES) {
    const value = issue?.[key];
    if (typeof value === 'string' && value.trim()) return value;
    if (value && typeof value === 'object') {
      const name = value.name ?? value.title ?? value.id;
      if (typeof name === 'string' && name.trim()) return name;
    }
  }
  return undefined;
}

function typeMatches(type, value) {
  const wanted = normalize(value);
  return [type.id, type.name, type.native_name, ...(type.aliases ?? [])]
    .filter((candidate) => typeof candidate === 'string')
    .some((candidate) => normalize(candidate) === wanted);
}

function labels(issue) {
  return array(issue?.labels)
    .map((label) => typeof label === 'string' ? label : label?.name)
    .filter((label) => typeof label === 'string');
}

export function resolveIssueType(issue = {}, config) {
  const nativeName = nativeTypeName(issue);
  const native = nativeName && issueTypes(config).find((type) => typeMatches(type, nativeName));
  const legacyMatches = [...new Set(labels(issue)
    .map((label) => config?.legacy?.type_labels?.[label])
    .filter((id) => typeof id === 'string'))]
    .map((id) => typeById(config, id))
    .filter(Boolean);
  if (native) {
    const conflicts = legacyMatches.filter((type) => type.id !== native.id).map((type) => type.id);
    // Native organization metadata is authoritative. A stale type label is
    // migration evidence, not a competing classification.
    return { id: native.id, name: native.name, nativeName: native.native_name, source: 'native', conflicts: [], legacyConflicts: conflicts };
  }
  if (nativeName) {
    return {
      id: null,
      name: null,
      nativeName,
      source: 'native-unknown',
      conflicts: [`native issue type ${nativeName}`],
      legacyConflicts: legacyMatches.map((type) => type.id),
    };
  }
  if (legacyMatches.length === 1) {
    return { id: legacyMatches[0].id, name: legacyMatches[0].name, nativeName: legacyMatches[0].native_name, source: 'legacy-label', conflicts: [] };
  }
  return {
    id: null,
    name: null,
    nativeName: null,
    source: legacyMatches.length > 1 ? 'conflict' : 'missing',
    conflicts: legacyMatches.map((type) => type.id),
  };
}

function optionId(options, value) {
  const wanted = normalize(value);
  return options.find((option) => normalize(option.id) === wanted || normalize(option.name) === wanted)?.id ?? null;
}

function legacyLifecycle(issue, config) {
  const matches = labels(issue)
    .map((label) => ({ label, value: config?.legacy?.state_labels?.[label] }))
    .filter((entry) => entry.value);
  if (matches.length !== 1) return { stage: null, readiness: null, labels: matches.map(({ label }) => label), conflict: matches.length > 1 };
  return { ...matches[0].value, labels: [matches[0].label], conflict: false };
}

export function issueMetadata(issue = {}, config) {
  const issueType = resolveIssueType(issue, config);
  const lifecycleField = config?.fields?.lifecycle_stage;
  const readinessField = config?.fields?.readiness;
  const lifecycleRaw = fieldValue(issue, lifecycleField);
  const readinessRaw = fieldValue(issue, readinessField);
  const legacy = legacyLifecycle(issue, config);
  const hasLifecycleField = lifecycleRaw !== undefined;
  const hasReadinessField = readinessRaw !== undefined;
  const lifecycleStage = hasLifecycleField ? optionId(lifecycleStages(config), lifecycleRaw) : legacy.stage ?? null;
  const readiness = hasReadinessField ? optionId(readinessOptions(config), readinessRaw) : legacy.readiness ?? null;
  const invalidFields = [
    hasLifecycleField && !lifecycleStage ? lifecycleField?.name : null,
    hasReadinessField && !readiness ? readinessField?.name : null,
  ].filter(Boolean);
  const conflicts = [];
  if (issueType.conflicts.length) conflicts.push(...issueType.conflicts.map((id) => `issue type ${id}`));
  // Once a pinned lifecycle field is present, legacy labels are migration
  // evidence even when they disagree or contain multiple old states.
  if (legacy.conflict && !hasLifecycleField) conflicts.push('multiple legacy lifecycle labels');
  return {
    issueType,
    lifecycleStage,
    readiness,
    authority: hasLifecycleField ? 'organization-issue-field' : legacy.stage ? 'legacy-label' : 'missing',
    fieldAuthority: hasLifecycleField && hasReadinessField ? 'organization-issue-field' : 'incomplete',
    fieldPresence: { lifecycleStage: hasLifecycleField, readiness: hasReadinessField },
    migrationRequired: issueType.source === 'legacy-label' || !hasLifecycleField || !hasReadinessField || invalidFields.length > 0,
    invalidFields,
    conflicts,
    legacy: { lifecycleStage: legacy.stage ?? null, readiness: legacy.readiness ?? null, labels: legacy.labels },
    fieldValues: { lifecycleStage: lifecycleRaw ?? null, readiness: readinessRaw ?? null },
  };
}

function transitionAllowed(config, from, to) {
  return from === to || (Array.isArray(config?.lifecycle?.transitions?.[from]) && config.lifecycle.transitions[from].includes(to));
}

export function validateIssueMetadataConfig(config) {
  const errors = [];
  if (!config || typeof config !== 'object' || Array.isArray(config)) return { valid: false, errors: ['configuration must be an object'] };
  if (config.version !== 1) errors.push('version must be 1');
  if (config.organization !== 'agentic-delivery-lab') errors.push('organization must be agentic-delivery-lab');
  const expectedAuthority = {
    issue_type: 'organization-native',
    lifecycle: 'organization-issue-field',
    delivery_state: 'organization-issue-field',
    execution_state: 'runner-local',
  };
  for (const [key, value] of Object.entries(expectedAuthority)) if (config.authority?.[key] !== value) errors.push(`authority.${key} must be ${value}`);
  const compatibility = config.field_compatibility;
  if (!compatibility || typeof compatibility !== 'object' || Array.isArray(compatibility)) {
    errors.push('field_compatibility must be an object');
  } else {
    const expectedCompatibility = {
      canonical_key: 'delivery_state',
      canonical_name: 'Delivery State',
      legacy_key: 'readiness',
      legacy_id: 'delivery-readiness',
      legacy_name: 'Delivery Readiness',
      mode: 'legacy-authoritative',
      migration_adr: 'ADR-0019',
      duplicate_field_forbidden: true,
      option_identity: 'preserve',
    };
    for (const [key, value] of Object.entries(expectedCompatibility)) {
      if (compatibility[key] !== value) errors.push(`field_compatibility.${key} must be ${JSON.stringify(value)}`);
    }
    if (config.fields?.delivery_state !== undefined) errors.push('fields.delivery_state must not be introduced during the compatibility window');
  }
  const types = issueTypes(config);
  const typeIds = new Set();
  for (const type of types) {
    if (!type || !ID.test(type.id ?? '') || typeof type.name !== 'string' || !type.name.trim() || typeof type.native_name !== 'string' || !type.native_name.trim()) errors.push('every issue type needs an id, name, and native_name');
    if (typeIds.has(type.id)) errors.push(`duplicate issue type ${type.id}`);
    typeIds.add(type.id);
    if (!stageById(config, type.initial_stage)) errors.push(`${type.id}: unknown initial stage ${type.initial_stage}`);
    if (!readinessById(config, type.initial_readiness)) errors.push(`${type.id}: unknown initial readiness ${type.initial_readiness}`);
  }
  const fields = config.fields ?? {};
  for (const key of ['lifecycle_stage', 'readiness']) {
    const field = fields[key];
    if (!field || field.kind !== 'single-select' || typeof field.name !== 'string' || !Array.isArray(field.options) || !field.options.length || !Array.isArray(field.pinned_to) || !field.pinned_to.length) errors.push(`fields.${key} must be a pinned single-select field`);
    const ids = new Set();
    for (const option of field?.options ?? []) {
      if (!option || !ID.test(option.id ?? '') || typeof option.name !== 'string' || !option.name.trim()) errors.push(`fields.${key} contains an invalid option`);
      if (ids.has(option.id)) errors.push(`fields.${key} repeats option ${option.id}`);
      ids.add(option.id);
    }
  }
  const stages = new Set(lifecycleStages(config).map((stage) => stage.id));
  for (const [from, targets] of Object.entries(config.lifecycle?.transitions ?? {})) {
    if (!stages.has(from) || !Array.isArray(targets) || targets.some((target) => !stages.has(target))) errors.push(`invalid lifecycle transition row ${from}`);
  }
  const legacyTypes = object(config.legacy?.type_labels);
  for (const [label, id] of Object.entries(legacyTypes)) if (!/^type:[a-z0-9-]+$/.test(label) || !typeIds.has(id)) errors.push(`invalid legacy type mapping ${label}`);
  const legacyStates = object(config.legacy?.state_labels);
  for (const [label, value] of Object.entries(legacyStates)) if (!/^state:[a-z0-9-]+$/.test(label) || !stages.has(value?.stage) || !readinessById(config, value?.readiness)) errors.push(`invalid legacy state mapping ${label}`);
  return { valid: errors.length === 0, errors };
}

export function validateFieldMutation({ config, issueState = 'open', field, from, to, workType, governance = [], actor = 'model', dependencies = [] } = {}) {
  const reasons = [];
  const definition = config?.fields?.[field];
  if (!definition) reasons.push(`Unknown issue field: ${field}.`);
  if (actor !== 'controller') reasons.push('Only the deterministic controller may mutate issue fields.');
  if (issueState !== 'open') reasons.push('Only an open issue may change issue fields.');
  const optionSet = new Set((definition?.options ?? []).map((option) => option.id));
  if (definition && !optionSet.has(to)) reasons.push(`Unknown ${field} option: ${to}.`);
  if (field === 'lifecycle_stage' && from != null && from !== to && !transitionAllowed(config, from, to)) reasons.push(`Lifecycle transition from ${from} to ${to} is not allowed.`);
  if (field === 'lifecycle_stage' && ['planning', 'execution'].includes(to)
    && workType !== 'architecture'
    && governance.some((label) => config.readiness?.blocking_governance?.includes(label))) reasons.push('Blocking governance metadata is unresolved.');
  if (field === 'lifecycle_stage' && ['execution', 'validation', 'acceptance'].includes(to)
    && dependencies.some((dependency) => dependency?.state !== 'done')) reasons.push('Required child dependencies are not complete.');
  return { allowed: reasons.length === 0, field, from: from ?? null, to: to ?? null, reasons };
}

export function issueFieldMutation({ config, field, from, to }) {
  const definition = config?.fields?.[field];
  const option = (definition?.options ?? []).find((candidate) => candidate.id === to);
  return option ? { fieldId: definition.id, fieldName: definition.name, optionId: option.id, optionName: option.name, from: from ?? null, to } : null;
}
