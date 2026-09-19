// agentic-primitive: {"id":"issue-classifier","kind":"state-machine","enforcement":"deterministic","adrs":["ADR-0012"],"domains":["agentic-delivery-governance"]}

import { validateTransition } from './lifecycle-transitions.mjs';
import {
  issueMetadata,
  issueTypes,
  lifecycleStages,
  normalize as normalizeMetadata,
  readinessOptions,
  resolveIssueType,
  stageById,
  typeById as metadataTypeById,
} from './issue-metadata.mjs';
import {
  patternById,
  selectOrchestration,
  validateOrchestrationProposal,
} from './orchestration-policy.mjs';

const ROUTES = new Set([
  'hold', 'refine', 'research', 'requirements', 'architecture',
  'plan', 'implement', 'resume', 'validate', 'coordinate',
]);

export function normalize(value) {
  return String(value ?? '').trim().toLocaleLowerCase('en-US');
}

function modernConfig(config) {
  return Boolean(config?.issue_types && config?.fields?.lifecycle_stage && config?.fields?.readiness);
}

function governanceDefinitions(config) {
  const values = config?.governance?.labels ?? config?.governance ?? [];
  return values.map((value) => typeof value === 'string' ? { name: value, label: value } : {
    ...value,
    name: value.name ?? value.label,
    label: value.label ?? value.name,
  }).filter((value) => value.name || value.label);
}

function legacyStateEntry(config, stage) {
  const direct = config?.legacy?.state_labels?.[`state:${stage}`];
  if (direct) return `state:${stage}`;
  return Object.entries(config?.legacy?.state_labels ?? {})
    .find(([, value]) => value?.stage === stage)?.[0] ?? null;
}

/**
 * Compatibility projections are intentionally read-only. Active code should
 * mutate issue fields through issue-field-api.mjs, never these labels.
 */
export function stateLabel(config, id) {
  if (modernConfig(config)) return legacyStateEntry(config, id) ?? (config.states ?? []).find((state) => state.id === id)?.label;
  return config?.states?.find((state) => state.id === id)?.label;
}

export function typeById(config, id) {
  if (modernConfig(config)) return metadataTypeById(config, id);
  return config?.types?.find((type) => type.id === id);
}

export function stateByLabel(config, label) {
  if (modernConfig(config)) {
    const entry = config.legacy?.state_labels?.[label] ?? config.legacy?.state_labels?.[`state:${label}`];
    if (!entry) return undefined;
    return { id: entry.stage, label: String(label).startsWith('state:') ? label : `state:${label}`, readiness: entry.readiness, legacy: true };
  }
  return config?.states?.find((state) => state.label === label);
}

export function typeByLabel(config, label) {
  if (modernConfig(config)) return metadataTypeById(config, config.legacy?.type_labels?.[label]);
  return config?.types?.find((type) => type.label === label);
}

export function managedLabels(config) {
  // Type and lifecycle labels are not active metadata. Keeping only the
  // governance catalog here prevents reconciliation code from deleting or
  // recreating legacy state labels as if they were authoritative.
  return new Set(governanceDefinitions(config).map((item) => item.name ?? item.label));
}

export function labelDefinitions(config) {
  return governanceDefinitions(config).map(({ name, label, color = '1D76DB', description = '' }) => ({
    name: name ?? label,
    color,
    description,
  }));
}

function issueLabels(issue) {
  return [...(issue?.labels ?? []), ...(issue?.governance ?? [])]
    .map((label) => typeof label === 'string' ? label : label?.name)
    .filter(Boolean);
}

function headings(body) {
  const found = new Map();
  const lines = String(body ?? '').split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const match = /^###\s+(.+?)\s*$/.exec(lines[index]);
    if (!match) continue;
    const heading = match[1].trim();
    const values = [];
    for (let next = index + 1; next < lines.length && !/^###\s+/.test(lines[next]); next += 1) values.push(lines[next]);
    found.set(normalizeMetadata(heading), values.join('\n').trim());
  }
  return found;
}

function meaningful(value) {
  return String(value ?? '').replace(/^<!--.*?-->$/s, '').trim().length > 0;
}

function detectFormType(body, config) {
  const values = headings(body);
  const forms = config.forms ?? {};
  const matches = issueTypes(config)
    .filter((type) => forms[type.id])
    .filter((type) => (forms[type.id].headings ?? []).every((heading) => values.has(normalizeMetadata(heading))))
    .map((type) => type.id);
  return { values, matches };
}

function requiredFormFields(config, type, body, source = 'unknown') {
  const form = type && config.forms?.[type.id];
  if (!form) return { detected: false, incomplete: false, missing: [] };
  const detected = detectFormType(body, config).matches.includes(type.id)
    || (source !== 'unknown' && source !== 'conflict'
      && (form.required ?? []).some((heading) => headings(body).has(normalizeMetadata(heading))));
  if (!detected) return { detected: false, incomplete: false, missing: [] };
  const values = headings(body);
  const missing = (form.required ?? []).filter((heading) => !meaningful(values.get(normalizeMetadata(heading))));
  return { detected: true, incomplete: missing.length > 0, missing };
}

function currentIssueType(issue, config) {
  const result = resolveIssueType(issue, config);
  const type = result.id ? typeById(config, result.id) : null;
  return { ...result, type };
}

function currentStageAndReadiness(issue, config, type) {
  const metadata = issueMetadata(issue, config);
  let lifecycleStage = metadata.lifecycleStage;
  let readiness = metadata.readiness;
  const reasons = [];
  if (!lifecycleStage && type) {
    lifecycleStage = type.initial_stage;
    reasons.push(`Initialized ${type.name} work at the ${lifecycleStage} lifecycle stage.`);
  }
  if (!readiness && type) {
    readiness = type.initial_readiness;
    reasons.push(`Initialized delivery readiness at ${readiness}.`);
  }
  if (!lifecycleStage && !type) lifecycleStage = 'intake';
  if (!readiness && !type) readiness = 'not-ready';
  return { ...metadata, lifecycleStage, readiness, reasons };
}

function stageName(config, id) {
  return stageById(config, id)?.name ?? id ?? null;
}

function readinessName(config, id) {
  return readinessOptions(config).find((option) => option.id === id)?.name ?? id ?? null;
}

function issueTrigger(eventAction, eventKind) {
  if (eventKind === 'agent-invocation') return 'agent-invocation';
  if (eventKind === 'issue_comment' || eventKind === 'comment') return 'comment';
  if (['child-event', 'child'].includes(eventKind)) return 'child-event';
  if (eventKind === 'workflow_dispatch' || eventKind === 'manual') return 'manual';
  return 'issue';
}

function policyFor(config) {
  return config.orchestration ?? config.orchestration_policy ?? null;
}

function executionContext(issue, config, stage, type, eventAction, eventKind, governance, available = {}) {
  const saved = issue.execution ?? issue.delivery ?? {};
  const plan = issue.plan ?? saved.plan ?? {
    exists: Boolean(saved.planDigest || saved.plan_digest),
    valid: saved.planValid === true || saved.plan_valid === true,
    digest: saved.planDigest ?? saved.plan_digest ?? null,
  };
  const session = issue.session ?? saved.session ?? {
    exists: Boolean(saved.sessionId || saved.session_id),
    resumable: saved.sessionResumable === true || saved.session_resumable === true,
    id: saved.sessionId ?? saved.session_id ?? null,
  };
  return {
    issueType: type?.id ?? null,
    lifecycleStage: stage,
    readiness: issueMetadata(issue, config).readiness,
    governance,
    trigger: issueTrigger(eventAction, eventKind),
    lineage: issue.lineage ?? { isRoot: !issue.parent, parent: issue.parent ?? null, children: issue.subIssues ?? [] },
    plan,
    session,
    execution: issue.executionState ?? issue.execution ?? { status: 'idle', operation: null },
    scopeChanged: issue.scopeChanged === true || saved.scopeChanged === true,
    // Capability inventory comes from the trusted runner/controller boundary,
    // never from issue content or a model proposal.
    capabilities: available.capabilities ?? ['repository-read', 'repository-write', 'deterministic-validation'],
    mcp: available.mcp ?? [],
    skills: available.skills ?? Object.keys(config.orchestration?.skills ?? {}),
  };
}

function readyGate({ issue, config, type, stage, readiness, governance, form, conflict }) {
  const reasons = [];
  if (normalize(issue.state) !== 'open') reasons.push('The issue is not open.');
  if (!type) reasons.push('A supported native issue type or migration fallback is required.');
  if (conflict?.length) reasons.push(`Conflicting issue-type metadata: ${conflict.join(', ')}.`);
  if (stage !== 'planning') reasons.push(`The issue is at lifecycle stage ${stage ?? 'unknown'}, not Planning.`);
  if (readiness !== 'ready') reasons.push(`Delivery readiness is ${readiness ?? 'unknown'}, not Ready.`);
  if (type && !type.delivery) reasons.push(`${type.name} work does not authorize repository delivery by itself.`);
  if (form.incomplete) reasons.push(`Required intake fields are missing: ${form.missing.join(', ')}.`);
  const blocking = config.readiness?.blocking_governance ?? [];
  const blocked = type?.id === 'architecture' ? [] : governance.filter((label) => blocking.includes(label));
  if (blocked.length) reasons.push(`Unresolved governance gates: ${blocked.join(', ')}.`);
  return { ok: reasons.length === 0, reasons };
}

function routeFor({ type, stage, readiness, gate, orchestration, mode }) {
  if (mode === 'resume') return 'resume';
  if (orchestration?.status === 'degraded' || orchestration?.status === 'replan-required') return 'hold';
  if (orchestration?.pattern === 'idea-discovery') return 'refine';
  if (orchestration?.pattern === 'research-only') return 'research';
  if (orchestration?.pattern === 'requirements') return 'requirements';
  if (orchestration?.pattern === 'architecture-decision') return 'architecture';
  if (orchestration?.pattern === 'validation-only') return 'validate';
  if (orchestration?.pattern === 'parent-coordination') return 'coordinate';
  if (orchestration?.pattern === 'implementation-continuation') return 'resume';
  if (orchestration?.pattern === 'implementation-existing-plan') return 'implement';
  if (orchestration?.pattern === 'implementation-fresh' && gate.ok) return 'plan';
  if (type?.id && stage === 'planning' && readiness === 'ready' && gate.ok) return 'plan';
  return 'hold';
}

function targetFields(config, lifecycleStage, readiness) {
  return {
    lifecycle_stage: lifecycleStage,
    readiness,
    lifecycleStageField: config.fields?.lifecycle_stage?.id ?? null,
    readinessField: config.fields?.readiness?.id ?? null,
  };
}

function compatibilityStateId(issue, config, stage) {
  const labels = issueLabels(issue);
  const selected = labels.find((label) => config?.legacy?.state_labels?.[label]?.stage === stage);
  if (selected) return selected.replace(/^state:/, '');
  const fallback = legacyStateEntry(config, stage);
  return fallback?.replace(/^state:/, '') ?? stage;
}

function classificationResult({ issue, config, typeResult, metadata, form, gate, route, orchestration, reasons = [] }) {
  const stage = metadata.lifecycleStage;
  const readiness = metadata.readiness;
  return {
    workType: typeResult.type?.id ?? null,
    workTypeName: typeResult.type?.name ?? null,
    workTypeSource: typeResult.source,
    candidates: typeResult.conflicts?.length ? [typeResult.type?.id, ...typeResult.conflicts].filter(Boolean) : typeResult.type ? [typeResult.type.id] : [],
    conflict: typeResult.conflicts?.length ? typeResult.conflicts : null,
    stateConflict: Boolean(metadata.conflicts?.length),
    transitionConflict: Boolean(metadata.transitionConflict),
    lifecycleStage: stage,
    lifecycleStageName: stageName(config, stage),
    readiness,
    readinessName: readinessName(config, readiness),
    fieldAuthority: metadata.fieldAuthority,
    fieldPresence: metadata.fieldPresence,
    invalidFields: metadata.invalidFields ?? [],
    // `state` remains a response compatibility alias for consumers being
    // migrated. It is a lifecycle-stage ID, never a state-label authority.
    state: compatibilityStateId(issue, config, stage),
    stateLabel: modernConfig(config) ? null : stateLabel(config, stage),
    governance: metadata.governance ?? [],
    formDetected: form.detected,
    missingFields: form.missing,
    readinessGate: gate,
    readinessCheck: gate,
    targetFields: targetFields(config, stage, readiness),
    targetLabels: metadata.governance ?? [],
    managedLabels: [...managedLabels(config)],
    orchestrationPattern: orchestration?.pattern ?? null,
    orchestration: orchestration ?? null,
    route,
    reasons: [...new Set([...(metadata.reasons ?? []), ...reasons])],
    resolution: normalize(issue.state) === 'closed' ? issue.state_reason ?? null : null,
    migrationRequired: metadata.migrationRequired,
    legacy: metadata.legacy,
  };
}

export function classifyIssue({ issue = {}, config, requestedState, requestedStage, requestedReadiness, mode = 'event', eventAction, eventKind, available } = {}) {
  if (!config || !issueTypes(config).length || !lifecycleStages(config).length) throw new Error('A valid issue metadata configuration is required.');
  const typeResult = currentIssueType(issue, config);
  const baseMetadata = currentStageAndReadiness(issue, config, typeResult.type);
  const governance = issueLabels(issue).filter((label) => managedLabels(config).has(label));
  const metadata = { ...baseMetadata, governance };
  const requested = requestedStage ?? requestedState;
  let transitionConflict = false;
  const stage = requested && !modernConfig(config)
    ? stateByLabel(config, requested)?.id ?? requested
    : requested
      ? stateByLabel(config, requested)?.id ?? config.legacy?.state_labels?.[`state:${requested}`]?.stage ?? requested
      : metadata.lifecycleStage;
  if (stage && stage !== metadata.lifecycleStage) {
    const transition = validateTransition({ config, from: metadata.lifecycleStage, to: stage, workType: typeResult.type?.id, governance, issueState: issue.state });
    if (transition.allowed) metadata.lifecycleStage = stage;
    else {
      transitionConflict = true;
      metadata.reasons.push(`Transition from ${metadata.lifecycleStage} to ${stage} is not allowed.`);
    }
  }
  metadata.transitionConflict = transitionConflict;
  if (requestedReadiness !== undefined) metadata.readiness = requestedReadiness;
  const form = requiredFormFields(config, typeResult.type, issue.body, typeResult.source);
  if (form.incomplete && ['not-ready', 'ready'].includes(metadata.readiness)) metadata.readiness = 'needs-info';
  if (normalize(issue.state) !== 'open') metadata.lifecycleStage = 'done';
  const reasons = [];
  if (typeResult.source === 'legacy-label') reasons.push('Legacy type labels are migration evidence; native issue type metadata remains authoritative.');
  if (baseMetadata.authority === 'legacy-label') reasons.push('Legacy lifecycle labels are migration evidence; pinned issue fields are authoritative.');
  if (typeResult.legacyConflicts?.length) reasons.push(`Stale legacy type labels retained as migration evidence: ${typeResult.legacyConflicts.join(', ')}.`);
  if (baseMetadata.conflicts?.length) reasons.push(`Legacy lifecycle metadata is conflicting: ${baseMetadata.conflicts.join(', ')}.`);
  if (baseMetadata.invalidFields?.length) reasons.push(`Invalid issue-field values require migration: ${baseMetadata.invalidFields.join(', ')}.`);
  if (form.incomplete) reasons.push(`Required intake fields are missing: ${form.missing.join(', ')}.`);
  if (eventAction === 'reopened' && metadata.lifecycleStage === 'done' && typeResult.type) {
    metadata.lifecycleStage = typeResult.type.initial_stage;
    metadata.readiness = typeResult.type.initial_readiness;
    reasons.push(`Reopened work returned to ${metadata.lifecycleStage}.`);
  }
  const gate = readyGate({ issue, config, type: typeResult.type, stage: metadata.lifecycleStage, readiness: metadata.readiness, governance, form, conflict: [...(typeResult.conflicts ?? []), ...(baseMetadata.conflicts ?? [])] });
  if (!gate.ok) reasons.push(...gate.reasons);
  const policy = policyFor(config);
  const context = policy ? executionContext(issue, config, metadata.lifecycleStage, typeResult.type, eventAction, eventKind, governance, available) : null;
  const orchestration = policy ? selectOrchestration({ policy, context }) : null;
  const route = (baseMetadata.conflicts?.length || baseMetadata.invalidFields?.length || typeResult.conflicts?.length || transitionConflict)
    ? 'hold'
    : routeFor({ type: typeResult.type, stage: metadata.lifecycleStage, readiness: metadata.readiness, gate, orchestration, mode });
  return classificationResult({ issue, config, typeResult, metadata, form, gate, route, orchestration, reasons });
}

function legacyProposal(proposal, config) {
  if (proposal?.lifecycleStage !== undefined || proposal?.readiness !== undefined || proposal?.orchestrationPattern !== undefined) return proposal;
  const legacy = stateByLabel(config, proposal?.state);
  return {
    ...proposal,
    lifecycleStage: legacy?.id ?? proposal?.state,
    readiness: legacy?.readiness ?? 'not-ready',
    orchestrationPattern: proposal?.route === 'plan' ? 'implementation-fresh'
      : proposal?.route === 'resume' ? 'implementation-continuation'
        : proposal?.route === 'coordinate' ? 'parent-coordination'
          : proposal?.route === 'refine' ? 'idea-discovery' : null,
  };
}

export function routingOutcomeSchema(config) {
  const types = issueTypes(config).map((type) => type.id);
  const stages = lifecycleStages(config).map((stage) => stage.id);
  const readiness = readinessOptions(config).map((option) => option.id);
  const patterns = policyFor(config)?.patterns?.map((pattern) => pattern.id) ?? [];
  return {
    type: 'object',
    additionalProperties: false,
    required: ['route', 'workType', 'lifecycleStage', 'readiness', 'governance', 'orchestrationPattern', 'summary', 'message'],
    properties: {
      route: { type: 'string', enum: [...ROUTES] },
      workType: { type: ['string', 'null'], enum: [...types, null] },
      lifecycleStage: { type: 'string', enum: stages },
      // Temporary response compatibility alias. It is never used for writes.
      state: { type: 'string', enum: [...new Set((config.legacy?.state_labels ? Object.keys(config.legacy.state_labels).map((label) => label.replace(/^state:/, '')) : stages))] },
      readiness: { type: 'string', enum: readiness },
      governance: { type: 'array', items: { type: 'string', enum: governanceDefinitions(config).map((item) => item.name ?? item.label) } },
      orchestrationPattern: { type: ['string', 'null'], enum: [...patterns, null] },
      summary: { type: 'string', maxLength: 1_000 },
      message: { type: 'string', maxLength: 1_000 },
    },
  };
}

function assertProposalShape(proposal, config) {
  const required = ['route', 'workType', 'lifecycleStage', 'readiness', 'governance', 'orchestrationPattern', 'summary', 'message'];
  if (!proposal || typeof proposal !== 'object' || Array.isArray(proposal)) throw new Error('Routing proposal does not match the required schema.');
  const keys = Object.keys(proposal);
  if (keys.some((key) => !required.includes(key) && key !== 'state')) throw new Error('Routing proposal contains an unapproved property.');
  const normalized = legacyProposal(proposal, config);
  if (required.some((key) => !(key in normalized))) throw new Error('Routing proposal does not match the required schema.');
  return normalized;
}

function governanceForProposal(config, values) {
  const allowed = new Set(governanceDefinitions(config).map((item) => item.name ?? item.label));
  if (!Array.isArray(values) || values.some((label) => typeof label !== 'string' || !allowed.has(label))) throw new Error('Routing proposal uses an unapproved governance label.');
  if (new Set(values).size !== values.length) throw new Error('Routing proposal repeats a governance label.');
  return values;
}

function routePattern(route) {
  return {
    refine: 'idea-discovery', research: 'research-only', requirements: 'requirements', architecture: 'architecture-decision',
    plan: 'implementation-fresh', implement: 'implementation-existing-plan', resume: 'implementation-continuation',
    validate: 'validation-only', coordinate: 'parent-coordination',
  }[route] ?? null;
}

export function validateRoutingProposal({ proposal, issue = {}, event = {}, config, policy = policyFor(config), available } = {}) {
  const value = assertProposalShape(proposal, config);
  if (!ROUTES.has(value.route)) throw new Error('Routing proposal uses an unsupported route.');
  const type = value.workType === null ? null : typeById(config, value.workType);
  if (value.workType !== null && !type) throw new Error('Routing proposal uses an unapproved issue type.');
  const native = currentIssueType(issue, config);
  if (native.source === 'native' && native.type && value.workType !== native.type.id) throw new Error(`Routing proposal conflicts with the native issue type ${native.type.id}.`);
  if (!stageById(config, value.lifecycleStage)) throw new Error('Routing proposal uses an unapproved lifecycle stage.');
  if (!readinessOptions(config).some((option) => option.id === value.readiness)) throw new Error('Routing proposal uses an unapproved readiness value.');
  const governance = governanceForProposal(config, value.governance);
  const holdWithoutPattern = value.route === 'hold' && value.orchestrationPattern === null;
  if (!holdWithoutPattern && (typeof value.orchestrationPattern !== 'string' || !patternById(policy, value.orchestrationPattern))) throw new Error('Routing proposal uses an unapproved orchestration pattern.');
  const expectedPattern = routePattern(value.route);
  if (expectedPattern && value.orchestrationPattern !== expectedPattern) throw new Error(`Route ${value.route} requires ${expectedPattern}.`);
  if (typeof value.summary !== 'string' || !value.summary.trim() || value.summary.length > 1_000) throw new Error('Routing proposal requires a concise summary.');
  if (typeof value.message !== 'string' || value.message.length > 1_000) throw new Error('Routing proposal message must be concise.');
  if (!['hold', 'refine'].includes(value.route) && !type) throw new Error('This route requires an approved issue type.');
  if (normalize(issue.state) !== 'open' && (value.route !== 'hold' || value.lifecycleStage !== 'done')) throw new Error('A closed issue can only remain on hold at the Done lifecycle stage.');
  const current = issueMetadata(issue, config);
  const currentStage = current.lifecycleStage ?? type?.initial_stage;
  if (currentStage && currentStage !== value.lifecycleStage) {
    const transition = validateTransition({ config, from: currentStage, to: value.lifecycleStage, workType: value.workType, governance, issueState: issue.state });
    if (!transition.allowed) throw new Error(`Routing proposal transition rejected: ${transition.reasons.join(' ')}`);
  }
  if (value.lifecycleStage === 'parked' && value.workType !== 'idea') throw new Error('Only Idea work may enter the Parked lifecycle stage.');
  const form = requiredFormFields(config, type, issue.body, 'model');
  const gate = readyGate({ issue, config, type, stage: value.lifecycleStage, readiness: value.readiness, governance, form, conflict: null });
  if (value.route === 'plan' && !gate.ok) throw new Error(`Routing proposal cannot plan: ${gate.reasons.join(' ')}`);
  const selected = policy ? selectOrchestration({ policy, context: executionContext(issue, config, value.lifecycleStage, type, event.action, event.kind, governance, available) }) : null;
  if (selected && selected.status === 'degraded' && value.route !== 'hold') throw new Error(`Required orchestration capability is unavailable: ${selected.reason}`);
  if (selected && selected.status === 'replan-required' && !['plan', 'requirements', 'architecture'].includes(value.route)) throw new Error(selected.reason);
  if (selected && selected.pattern && selected.pattern !== value.orchestrationPattern && value.route !== 'hold') throw new Error(`Routing proposal does not match deterministic orchestration selection (${selected.pattern}).`);
  const selectedPattern = patternById(policy, value.orchestrationPattern);
  const policyProposal = policy && !holdWithoutPattern && !(value.route === 'refine' && value.workType === null) ? validateOrchestrationProposal({
    policy,
    context: executionContext(issue, config, value.lifecycleStage, type, event.action, event.kind, governance, available),
    proposal: {
      pattern: value.orchestrationPattern,
      profile: selectedPattern?.steps?.[0],
      capabilities: selectedPattern?.required_capabilities ?? [],
      mcp: [],
    },
  }) : { allowed: true };
  if (!policyProposal.allowed && value.route !== 'hold') throw new Error(`Orchestration proposal rejected: ${policyProposal.reasons.join(' ')}`);
  return classificationResult({
    issue,
    config,
    typeResult: { ...native, type, source: native.source === 'missing' ? 'model' : native.source, conflicts: [] },
    metadata: { ...current, lifecycleStage: value.lifecycleStage, readiness: value.readiness, governance },
    form,
    gate,
    route: value.route,
    orchestration: selected,
    reasons: [value.summary],
  });
}
