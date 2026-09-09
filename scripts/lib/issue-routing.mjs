const TITLE_TYPE_PREFIXES = new Map([
  ['bug', 'bug'], ['feature', 'feature'], ['request', 'feature'], ['task', 'task'],
  ['idea', 'idea'], ['research', 'research'], ['architecture', 'architecture'], ['adr', 'architecture'],
]);

export function normalize(value) {
  return String(value ?? '').trim().toLocaleLowerCase('en-US');
}

export function stateLabel(config, id) {
  return config.states.find((state) => state.id === id)?.label;
}

export function typeById(config, id) {
  return config.types.find((type) => type.id === id);
}

export function stateByLabel(config, label) {
  return config.states.find((state) => state.label === label);
}

export function typeByLabel(config, label) {
  return config.types.find((type) => type.label === label);
}

export function managedLabels(config) {
  return new Set([
    ...config.types.map((type) => type.label),
    ...config.states.map((state) => state.label),
    ...config.governance.map((item) => item.label),
  ]);
}

export function labelDefinitions(config) {
  return [
    ...config.types.map((type) => ({ name: type.label, color: '1D76DB', description: `${type.name} work type.` })),
    ...config.states.map(({ label, color, description }) => ({ name: label, color, description })),
    ...config.governance,
  ];
}

function issueLabels(issue) {
  return (issue?.labels ?? []).map((label) => typeof label === 'string' ? label : label?.name).filter(Boolean);
}

function nativeTypeName(issue) {
  const candidates = [issue?.type?.name, issue?.issue_type?.name, issue?.type, issue?.issue_type];
  return candidates.find((candidate) => typeof candidate === 'string') ?? '';
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
    found.set(normalize(heading), values.join('\n').trim());
  }
  return found;
}

function meaningful(value) {
  const normalized = String(value ?? '').replace(/^<!--.*?-->$/s, '').trim();
  return normalized.length > 0;
}

function detectFormType(body, config) {
  const bodyHeadings = headings(body);
  const matches = config.types
    .filter((type) => config.forms?.[type.id])
    .filter((type) => config.forms[type.id].headings.every((heading) => bodyHeadings.has(normalize(heading))))
    .map((type) => type.id);
  return { bodyHeadings, matches };
}

function titleType(title) {
  const match = /^\s*([^:–—-]+?)\s*[:–—-]/u.exec(String(title ?? ''));
  return TITLE_TYPE_PREFIXES.get(normalize(match?.[1]));
}

function resolveNativeType(issue, config) {
  const name = normalize(nativeTypeName(issue));
  return config.types.find((type) => normalize(type.name) === name || normalize(type.id) === name);
}

export function resolveWorkType({ issue = {}, body = issue.body, config }) {
  const labels = issueLabels(issue);
  const native = resolveNativeType(issue, config);
  const fallback = [...new Set(labels.map((label) => typeByLabel(config, label)).filter(Boolean).map((type) => type.id))]
    .map((id) => typeById(config, id));
  const forms = detectFormType(body, config);
  const title = titleType(issue.title);
  const candidates = new Set([
    ...fallback.map((type) => type.id),
    ...forms.matches,
    ...(title ? [title] : []),
  ]);

  if (native) {
    const conflicts = [...candidates].filter((candidate) => candidate !== native.id);
    return { type: native, source: 'native', conflict: conflicts.length > 0 ? conflicts : null, candidates: [native.id, ...conflicts] };
  }
  if (fallback.length === 1) {
    const conflicts = [...candidates].filter((candidate) => candidate !== fallback[0].id);
    return { type: fallback[0], source: 'label', conflict: conflicts.length > 0 ? conflicts : null, candidates: [fallback[0].id, ...conflicts] };
  }
  if (fallback.length > 1) return { type: null, source: 'conflict', conflict: fallback.map((type) => type.id), candidates: [...candidates] };
  if (forms.matches.length === 1) {
    const conflicts = [...candidates].filter((candidate) => candidate !== forms.matches[0]);
    return {
      type: typeById(config, forms.matches[0]),
      source: 'form',
      conflict: conflicts.length > 0 ? conflicts : null,
      candidates: [...candidates],
    };
  }
  if (forms.matches.length > 1) return { type: null, source: 'conflict', conflict: forms.matches, candidates: [...candidates] };
  if (title) return { type: typeById(config, title), source: 'title', conflict: null, candidates: [...candidates] };
  return { type: null, source: 'unknown', conflict: null, candidates: [...candidates] };
}

function initialState(config, type) {
  return typeById(config, type)?.initial_state ?? 'needs-triage';
}

function defaultStateForType(config, type, body, incomplete = false) {
  if (incomplete) return 'needs-info';
  return initialState(config, type);
}

function stateIds(config, labels) {
  return [...new Set(labels.map((label) => stateByLabel(config, label)?.id).filter(Boolean))];
}

function priorState(config, labels, requestedState) {
  const states = stateIds(config, labels);
  const alternatives = states.filter((state) => state !== requestedState);
  if (requestedState && alternatives.length === 1) return alternatives[0];
  return states.length === 1 ? states[0] : null;
}

function currentState(config, labels, requestedState) {
  const states = stateIds(config, labels);
  if (requestedState) return requestedState;
  return states.length === 1 ? states[0] : null;
}

function stateConflict(config, labels, requestedState) {
  const states = stateIds(config, labels);
  if (requestedState) return states.filter((state) => state !== requestedState).length > 1;
  return states.length > 1;
}

function requiredFormFields(config, type, body, source = 'unknown') {
  const form = config.forms?.[type?.id];
  if (!form) return { detected: false, incomplete: false, missing: [] };
  const values = headings(body);
  const detected = detectFormType(body, config).matches.includes(type.id)
    || (source !== 'unknown' && source !== 'conflict'
      && form.required.some((heading) => values.has(normalize(heading))));
  if (!detected) return { detected: false, incomplete: false, missing: [] };
  const missing = form.required.filter((heading) => !meaningful(values.get(normalize(heading))));
  return { detected: true, incomplete: missing.length > 0, missing };
}

function transitionAllowed(config, from, to) {
  if (!from || from === to) return true;
  return (config.transitions?.[from] ?? []).includes(to);
}

function readiness(config, { issue, type, state, governance, form, conflict }) {
  const reasons = [];
  if (issue.state && normalize(issue.state) !== 'open') reasons.push('The issue is not open.');
  if (!type) reasons.push('A supported work type is required.');
  if (conflict?.length) reasons.push(`Conflicting work-type signals: ${conflict.join(', ')}.`);
  if (type && !config.readiness.delivery_types.includes(type.id)) reasons.push(`${type.name} work must mature before planning.`);
  if (state !== 'ready-for-plan') reasons.push(`The issue is in state ${state ?? 'unknown'}, not state:ready-for-plan.`);
  if (form.incomplete) reasons.push(`Required intake fields are missing: ${form.missing.join(', ')}.`);
  const blocked = governance.filter((label) => config.readiness.blocking_governance.includes(label));
  if (blocked.length) reasons.push(`Unresolved governance gates: ${blocked.join(', ')}.`);
  return { ok: reasons.length === 0, reasons };
}

export function classifyIssue({ issue = {}, config, requestedState, mode = 'event', eventAction } = {}) {
  if (!config?.types || !config?.states || !config?.readiness) throw new Error('A valid lifecycle configuration is required.');
  const labels = issueLabels(issue);
  const governance = labels.filter((label) => config.governance.some((item) => item.label === label));
  const work = resolveWorkType({ issue, config });
  const form = requiredFormFields(config, work.type, issue.body, work.source);
  const previous = priorState(config, labels, requestedState);
  const conflictingStates = stateConflict(config, labels, requestedState);
  let state = currentState(config, labels, requestedState);
  const reasons = [];

  if (normalize(issue.state) !== 'open') state = 'done';
  else if (work.conflict?.length || !work.type) {
    state = 'needs-triage';
    reasons.push(work.conflict?.length ? 'Work-type metadata conflicts and needs human triage.' : 'The issue needs a supported work type.');
    if (conflictingStates) reasons.push('Multiple lifecycle states are present and need human triage.');
  } else if (conflictingStates) {
    state = 'needs-triage';
    reasons.push('Multiple lifecycle states are present and need human triage.');
  } else if (eventAction === 'reopened' && state === 'done') {
    state = defaultStateForType(config, work.type.id, issue.body, form.incomplete);
    reasons.push(`Reopened work returned to ${state}.`);
  } else if (!requestedState && state === 'needs-triage' && initialState(config, work.type.id) !== 'needs-triage') {
    state = defaultStateForType(config, work.type.id, issue.body, form.incomplete);
    reasons.push(`${work.type.name} work entered its initial maturation state: ${state}.`);
  } else if (requestedState && previous && !transitionAllowed(config, previous, requestedState)) {
    state = previous;
    reasons.push(`Transition from ${previous} to ${requestedState} is not allowed.`);
  } else if (!state) {
    state = defaultStateForType(config, work.type.id, issue.body, form.incomplete);
  } else if (form.incomplete && !['needs-info', 'done'].includes(state)) {
    state = 'needs-info';
    reasons.push(`Required intake fields are missing: ${form.missing.join(', ')}.`);
  }

  if (state === 'parked' && work.type?.id !== 'idea') {
    reasons.push('Only Idea work may use state:parked.');
    state = 'needs-triage';
  }

  const gate = readiness(config, { issue, type: work.type, state, governance, form, conflict: work.conflict });
  if (state === 'ready-for-plan' && !gate.ok) {
    reasons.push(...gate.reasons);
    state = form.incomplete ? 'needs-info' : defaultStateForType(config, work.type?.id, issue.body);
  }

  if (state === 'done' && normalize(issue.state) === 'closed') reasons.push(`Closed with resolution ${issue.state_reason ?? 'completed'}.`);
  const typeLabel = work.type && work.source !== 'native' ? work.type.label : null;
  const targetLabels = [typeLabel, stateLabel(config, state)].filter(Boolean);
  const route = mode === 'resume' ? 'resume' : state === 'ready-for-plan' && gate.ok ? 'plan' : 'hold';
  return {
    workType: work.type?.id ?? null,
    workTypeName: work.type?.name ?? null,
    workTypeSource: work.source,
    candidates: work.candidates,
    conflict: work.conflict,
    stateConflict: conflictingStates,
    state,
    stateLabel: stateLabel(config, state),
    governance,
    formDetected: form.detected,
    missingFields: form.missing,
    readiness: gate,
    route,
    reasons: [...new Set(reasons)],
    targetLabels,
    managedLabels: [...managedLabels(config)],
    resolution: normalize(issue.state) === 'closed' ? issue.state_reason ?? null : null,
  };
}

export function parseEventRequestedState(event, config) {
  if (event?.action !== 'labeled' || !event.label?.name) return undefined;
  return stateByLabel(config, event.label.name)?.id;
}
