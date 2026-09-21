// agentic-primitive: {"id":"event-catalog-validator","kind":"validator","enforcement":"deterministic","adrs":["ADR-0017","ADR-0018"],"domains":["agentic-delivery-governance","agentic-delivery-control-plane"]}

const EVENT_ROLES = new Set(['lifecycle-input', 'invocation-input', 'observation-input']);
const EVENT_NAMES = ['issues', 'issue_comment', 'pull_request', 'pull_request_review', 'pull_request_review_comment'];
const EXPECTED_ROLES = new Map([
  ['issues', 'lifecycle-input'],
  ['issue_comment', 'invocation-input'],
  ['pull_request', 'observation-input'],
  ['pull_request_review', 'invocation-input'],
  ['pull_request_review_comment', 'invocation-input'],
]);
const ID = /^[a-z0-9_]+$/;
const ACTION = /^[a-z0-9_]+$/;

function list(value) {
  return Array.isArray(value) ? value : [];
}

function object(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

export function validateEventCatalog(catalog) {
  const errors = [];
  if (!catalog || typeof catalog !== 'object' || Array.isArray(catalog)) return { valid: false, errors: ['catalog must be an object'] };
  if (catalog.schemaVersion !== 1) errors.push('schemaVersion must be 1');
  if (!/^\d+\.\d+\.\d+$/.test(String(catalog.version ?? ''))) errors.push('version must be a semantic version');
  if (catalog.organization !== 'agentic-delivery-lab') errors.push('organization must be agentic-delivery-lab');
  const events = object(catalog.events);
  for (const eventName of EVENT_NAMES) {
    const entry = events[eventName];
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      errors.push(`events.${eventName} must be an object`);
      continue;
    }
    if (!EVENT_ROLES.has(entry.role)) errors.push(`events.${eventName}.role is unsupported`);
    else if (entry.role !== EXPECTED_ROLES.get(eventName)) errors.push(`events.${eventName}.role must be ${EXPECTED_ROLES.get(eventName)}`);
    const actions = list(entry.actions);
    if (!actions.length) errors.push(`events.${eventName}.actions must be non-empty`);
    if (new Set(actions).size !== actions.length) errors.push(`events.${eventName}.actions must be unique`);
    for (const action of actions) if (typeof action !== 'string' || !ACTION.test(action)) errors.push(`events.${eventName}.actions contains an invalid action`);
  }
  for (const eventName of Object.keys(events)) if (!EVENT_NAMES.includes(eventName) || !ID.test(eventName)) errors.push(`events contains unsupported event ${eventName}`);
  const rules = object(catalog.rules);
  for (const rule of ['issueLifecycleEventsMayRouteWithoutMention', 'conversationEventsRequireExplicitInvocation', 'pullRequestEventsAreObservationOnlyByDefault', 'unsupportedEventsAreAcknowledgedWithoutRoute']) {
    if (rules[rule] !== true) errors.push(`rules.${rule} must be true`);
  }
  if (rules.installationRepositoryEvents !== 'not-enabled') errors.push('rules.installationRepositoryEvents must be not-enabled until a dispatcher exists');
  return { valid: errors.length === 0, errors };
}

export function eventActions(catalog, eventName) {
  return list(catalog?.events?.[eventName]?.actions);
}

export { EVENT_NAMES, EVENT_ROLES };
