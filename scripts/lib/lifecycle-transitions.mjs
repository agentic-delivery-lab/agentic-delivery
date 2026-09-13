// agentic-primitive: {"id":"lifecycle-transition-validator","kind":"validator","enforcement":"deterministic","adrs":["ADR-0012"],"domains":["agentic-delivery-governance"]}

function stateIds(config) {
  return new Set((config?.states ?? []).map((state) => state.id));
}

function typeIds(config) {
  return new Set((config?.types ?? []).map((type) => type.id));
}

/**
 * Validate a proposed work-state change without performing any GitHub write.
 * The caller must apply the returned decision and verify the observed state.
 */
export function validateTransition({ config, from, to, workType, governance = [], issueState = 'open', dependencies = [] } = {}) {
  const reasons = [];
  const states = stateIds(config);
  const types = typeIds(config);
  if (!states.has(to)) reasons.push(`Unknown target lifecycle state: ${to ?? 'undefined'}.`);
  if (from !== undefined && from !== null && from !== to && !states.has(from)) reasons.push(`Unknown current lifecycle state: ${from}.`);
  if (issueState !== 'open' && to !== 'done') reasons.push('Only an open issue may enter a non-final lifecycle state.');
  if (workType !== undefined && workType !== null && !types.has(workType)) reasons.push(`Unknown work type: ${workType}.`);
  if (from !== undefined && from !== null && from !== to && states.has(from) && states.has(to)
    && !(config.transitions?.[from] ?? []).includes(to)) reasons.push(`Transition from ${from} to ${to} is not allowed.`);
  if (to === 'parked' && workType !== 'idea') reasons.push('Only Idea work may enter state:parked.');
  if (['ready-for-plan', 'ready-for-agent', 'in-progress'].includes(to)
    && Array.isArray(config.readiness?.blocking_governance)
    && workType !== 'architecture'
    && governance.some((label) => config.readiness.blocking_governance.includes(label))) {
    reasons.push('Blocking governance metadata is unresolved.');
  }
  if (['ready-for-plan', 'ready-for-agent', 'in-progress', 'review', 'acceptance'].includes(to)
    && dependencies.some((dependency) => dependency.state !== 'done')) {
    reasons.push('Required child dependencies are not complete.');
  }
  return { allowed: reasons.length === 0, from: from ?? null, to: to ?? null, reasons };
}

export function assertTransition(input) {
  const result = validateTransition(input);
  if (!result.allowed) {
    const error = new Error(result.reasons.join(' '));
    error.code = 'INVALID_LIFECYCLE_TRANSITION';
    error.transition = result;
    throw error;
  }
  return result;
}
