// agentic-primitive: {"id":"orchestration-policy-validator","kind":"validator","enforcement":"deterministic","adrs":["ADR-0012","ADR-0015"],"domains":["agentic-delivery-governance"]}

const ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const TRIGGERS = new Set(['issue', 'comment', 'child-event', 'manual']);
const REQUIREMENTS = new Set(['valid-plan', 'resumable-session', 'unchanged-scope', 'lineage-root']);

function list(value) {
  return Array.isArray(value) ? value : [];
}

function uniqueStrings(value) {
  return list(value).filter((item) => typeof item === 'string' && item.trim());
}

function normalized(value) {
  return String(value ?? '').trim().toLocaleLowerCase('en-US').replace(/[\s_/]+/g, '-');
}

export function profileById(policy, id) {
  return policy?.profiles?.[id] ?? null;
}

export function patternById(policy, id) {
  return list(policy?.patterns).find((pattern) => pattern.id === id) ?? null;
}

function profileIds(pattern) {
  return [...new Set([...list(pattern?.steps), ...list(pattern?.optional_steps)])];
}

function profileCapabilitySet(policy, pattern) {
  return new Set(profileIds(pattern).flatMap((id) => list(profileById(policy, id)?.capabilities)));
}

function profileMcpSet(policy, pattern) {
  return new Set(profileIds(pattern).flatMap((id) => list(profileById(policy, id)?.mcp)));
}

function capabilityNames(policy) {
  return new Set(Object.keys(policy?.capabilities ?? {}));
}

function mcpNames(policy) {
  return new Set(Object.keys(policy?.mcp_servers ?? {}));
}

function skillNames(policy) {
  return new Set(Object.keys(policy?.skills ?? {}));
}

function modelNames(policy) {
  return new Map(Object.entries(policy?.models ?? {}));
}

export function validateOrchestrationPolicy(policy, { issueTypes = [], lifecycleStages = [] } = {}) {
  const errors = [];
  if (!policy || typeof policy !== 'object' || Array.isArray(policy)) return { valid: false, errors: ['policy must be an object'] };
  if (policy.version !== 1) errors.push('version must be 1');
  const models = modelNames(policy);
  if (!models.has('gpt-5.6-sol') || !models.has('gpt-5.6-luna')) errors.push('Sol and Luna must be explicit approved models');
  const capabilities = capabilityNames(policy);
  const mcp = mcpNames(policy);
  const skills = skillNames(policy);
  if (!policy.skills || typeof policy.skills !== 'object' || Array.isArray(policy.skills) || !Object.keys(policy.skills).length) errors.push('skills must be a non-empty mapping');
  for (const [id, definition] of Object.entries(policy.skills ?? {})) {
    if (!ID.test(id) || !definition || typeof definition !== 'object' || Array.isArray(definition)) errors.push(`invalid skill definition ${id}`);
  }
  for (const [server, definition] of Object.entries(policy.mcp_servers ?? {})) {
    if (!Array.isArray(definition?.provides) || definition.provides.some((capability) => !capabilities.has(capability))) errors.push(`${server}: MCP server provides an unknown capability`);
  }
  const profiles = policy.profiles;
  if (!profiles || typeof profiles !== 'object' || Array.isArray(profiles) || !Object.keys(profiles).length) errors.push('profiles must be a non-empty mapping');
  for (const [id, profile] of Object.entries(profiles ?? {})) {
    if (!ID.test(id)) errors.push(`invalid profile ID ${id}`);
    for (const field of ['purpose', 'model', 'reasoning', 'mode', 'permissions']) if (typeof profile?.[field] !== 'string' || !profile[field].trim()) errors.push(`${id}: ${field} is required`);
    if (!models.has(profile?.model) || !list(models.get(profile?.model)).includes(profile?.reasoning)) errors.push(`${id}: unsupported model and reasoning combination`);
    for (const field of ['skills', 'capabilities', 'mcp']) if (!Array.isArray(profile?.[field])) errors.push(`${id}: ${field} must be an array`);
    for (const skill of profile?.skills ?? []) if (!skills.has(skill)) errors.push(`${id}: unknown skill ${skill}`);
    for (const capability of profile?.capabilities ?? []) if (!capabilities.has(capability)) errors.push(`${id}: unknown capability ${capability}`);
    for (const server of profile?.mcp ?? []) if (!mcp.has(server)) errors.push(`${id}: unknown MCP server ${server}`);
    if (typeof profile?.mutates_repository !== 'boolean') errors.push(`${id}: mutates_repository must be boolean`);
  }
  if (profiles?.research?.mutates_repository || profiles?.discovery?.mutates_repository || profiles?.validator?.mutates_repository) errors.push('read-only profiles may not mutate the repository');
  if (profiles?.research && !profiles.research.capabilities?.includes('web-research')) errors.push('research must declare web-research');
  if (profiles?.implementer && (profiles.implementer.model !== 'gpt-5.6-luna' || profiles.implementer.reasoning !== 'max')) errors.push('implementer must use GPT-5.6 Luna Max');
  if (profiles?.implementer?.mcp?.length) errors.push('implementer may not declare MCP servers');
  const patterns = list(policy.patterns);
  const patternIds = new Set();
  for (const pattern of patterns) {
    if (!pattern || !ID.test(pattern.id ?? '') || patternIds.has(pattern.id)) errors.push(`invalid or duplicate pattern ${pattern?.id ?? 'unknown'}`);
    patternIds.add(pattern?.id);
    for (const field of ['issue_types', 'stages', 'triggers', 'steps']) if (!Array.isArray(pattern?.[field]) || !pattern[field].length) errors.push(`${pattern?.id ?? 'unknown'}: ${field} must be non-empty`);
    if (list(pattern?.triggers).some((trigger) => !TRIGGERS.has(trigger))) errors.push(`${pattern.id}: trigger is not approved`);
    for (const profile of profileIds(pattern)) if (!profiles?.[profile]) errors.push(`${pattern.id}: unknown profile ${profile}`);
    for (const profile of pattern?.forbidden_profiles ?? []) if (!profiles?.[profile]) errors.push(`${pattern.id}: unknown forbidden profile ${profile}`);
    for (const capability of pattern?.required_capabilities ?? []) if (!capabilities.has(capability)) errors.push(`${pattern.id}: unknown required capability ${capability}`);
    for (const capability of pattern?.required_capabilities ?? []) if (!profileCapabilitySet(policy, pattern).has(capability)) errors.push(`${pattern.id}: no selected profile provides ${capability}`);
    for (const skill of pattern?.required_skills ?? []) if (!skills.has(skill)) errors.push(`${pattern.id}: unknown required skill ${skill}`);
    for (const [control, required] of Object.entries(pattern?.conditional_capabilities ?? {})) {
      if (!ID.test(control) || !Array.isArray(required) || required.some((capability) => !capabilities.has(capability))) errors.push(`${pattern.id}: invalid conditional capability ${control}`);
    }
    for (const requirement of pattern?.requires ?? []) if (!REQUIREMENTS.has(requirement)) errors.push(`${pattern.id}: unknown requirement ${requirement}`);
    if (pattern?.required_skills !== undefined && !Array.isArray(pattern.required_skills)) errors.push(`${pattern.id}: required_skills must be an array`);
    if (issueTypes.length && pattern.issue_types?.some((type) => !issueTypes.includes(type))) errors.push(`${pattern.id}: unknown issue type`);
    if (lifecycleStages.length && pattern.stages?.some((stage) => !lifecycleStages.includes(stage))) errors.push(`${pattern.id}: unknown lifecycle stage`);
    if (['research-only', 'architecture-decision', 'validation-only'].includes(pattern.id)
      && profileIds(pattern).includes('implementer')) errors.push(`${pattern.id}: non-implementation pattern may not invoke implementer`);
  }
  return { valid: errors.length === 0, errors };
}

function validDigest(value) {
  return typeof value === 'string' && /^[a-f0-9]{64}$/i.test(value);
}

function planIsValid(plan = {}) {
  if (!plan.exists || !plan.valid || !validDigest(plan.digest)) return false;
  if (plan.currentDigest !== undefined && plan.currentDigest !== plan.digest) return false;
  if (plan.scopeChanged === true) return false;
  return true;
}

function sessionIsResumable(session = {}) {
  return session.exists === true && session.resumable === true && typeof session.id === 'string' && session.id.trim().length > 0;
}

export function availableCapabilities(input = {}, policy = null) {
  const { capabilities = [], mcp = [], skills } = input ?? {};
  const direct = [...new Set((Array.isArray(capabilities) ? capabilities : []).filter((capability) => typeof capability === 'string'))].sort();
  const servers = [];
  const degraded = [];
  for (const entry of Array.isArray(mcp) ? mcp : []) {
    const name = typeof entry === 'string' ? entry : entry?.name;
    const available = typeof entry === 'string' ? true : entry?.available === true;
    if (!name) continue;
    if (available) servers.push(name);
    else degraded.push(name);
  }
  const resolved = new Set(direct);
  for (const server of servers) for (const capability of policy?.mcp_servers?.[server]?.provides ?? []) resolved.add(capability);
  const availableSkills = skills === undefined
    ? Object.keys(policy?.skills ?? {})
    : (Array.isArray(skills) ? skills.filter((skill) => typeof skill === 'string') : []);
  return { capabilities: [...resolved].sort(), mcp: [...new Set(servers)].sort(), degraded: [...new Set(degraded)].sort(), skills: [...new Set(availableSkills)].sort() };
}

function profileSkillSet(policy, pattern) {
  return new Set(list(pattern?.steps).flatMap((id) => list(profileById(policy, id)?.skills)));
}

function requirementsSatisfied(pattern, context) {
  const planValid = planIsValid(context.plan);
  const sessionValid = sessionIsResumable(context.session);
  for (const requirement of pattern.requires ?? []) {
    if (requirement === 'valid-plan' && !planValid) return false;
    if (requirement === 'resumable-session' && !sessionValid) return false;
    if (requirement === 'unchanged-scope' && (context.scopeChanged === true || context.plan?.scopeChanged === true)) return false;
    if (requirement === 'lineage-root' && context.lineage?.isRoot !== true) return false;
  }
  return true;
}

function eligiblePattern(pattern, context) {
  return list(pattern.issue_types).includes(context.issueType)
    && list(pattern.stages).includes(context.lifecycleStage)
    && list(pattern.triggers).includes(context.trigger)
    && requirementsSatisfied(pattern, context);
}

function choosePattern(policy, context) {
  const patterns = list(policy.patterns);
  const candidates = [
    'implementation-continuation',
    'parent-coordination',
    'research-only',
    'architecture-decision',
    'validation-only',
    'idea-discovery',
    'requirements',
    'implementation-existing-plan',
    'implementation-fresh',
  ];
  return candidates.map((id) => patternById(policy, id)).find((pattern) => pattern && eligiblePattern(pattern, context))
    ?? patterns.find((pattern) => eligiblePattern(pattern, context))
    ?? null;
}

function requiredCapabilities(pattern, context) {
  const required = new Set(pattern?.required_capabilities ?? []);
  for (const [control, capabilities] of Object.entries(pattern?.conditional_capabilities ?? {})) if ((context.governance ?? []).includes(control)) for (const capability of capabilities) required.add(capability);
  return [...required].sort();
}

export function selectOrchestration({ policy, context = {}, available = context } = {}) {
  const normalizedContext = {
    issueType: normalized(context.issueType),
    lifecycleStage: normalized(context.lifecycleStage),
    readiness: normalized(context.readiness),
    governance: list(context.governance).map(normalized),
    trigger: normalized(context.trigger || 'issue'),
    lineage: context.lineage ?? { isRoot: true, children: [] },
    plan: context.plan ?? { exists: false, valid: false, digest: null },
    session: context.session ?? { exists: false, resumable: false, id: null },
    execution: context.execution ?? { status: 'idle', operation: null },
    scopeChanged: context.scopeChanged === true,
    skills: context.skills === undefined ? undefined : uniqueStrings(context.skills),
  };
  if (normalizedContext.plan.exists && !planIsValid(normalizedContext.plan)
    && normalizedContext.lifecycleStage === 'execution') {
    return { status: 'replan-required', pattern: null, steps: [], profiles: [], requiredCapabilities: [], missingCapabilities: [], reason: 'The saved implementation plan is stale or the issue scope changed; planning must run again.' };
  }
  const pattern = choosePattern(policy, normalizedContext);
  if (!pattern) return { status: 'hold', pattern: null, steps: [], profiles: [], requiredCapabilities: [], missingCapabilities: [], reason: 'No approved orchestration pattern matches the issue type, lifecycle stage, trigger, and execution state.' };
  const inventory = availableCapabilities(available, policy);
  const required = requiredCapabilities(pattern, normalizedContext);
  const missing = required.filter((capability) => !inventory.capabilities.includes(capability));
  const requiredSkills = [...profileSkillSet(policy, pattern)].sort();
  const missingSkills = requiredSkills.filter((skill) => !inventory.skills.includes(skill));
  if (missing.length || missingSkills.length) return {
    status: 'degraded', pattern: null, steps: [], profiles: [], requiredCapabilities: required, missingCapabilities: missing,
    requiredSkills, missingSkills, availableSkills: inventory.skills,
    reason: `Required ${missing.length ? `capability is unavailable: ${missing.join(', ')}` : `skill is unavailable: ${missingSkills.join(', ')}`}. Install or explicitly approve it, then retry; no unrelated capability is substituted.`,
  };
  const profiles = list(pattern.steps);
  return {
    status: 'authorized',
    pattern: pattern.id,
    steps: profiles,
    profiles: profiles.map((id) => profileById(policy, id)),
    requiredCapabilities: required,
    missingCapabilities: [],
    availableMcp: inventory.mcp,
    requiredSkills,
    missingSkills: [],
    availableSkills: inventory.skills,
    reason: `Authorized ${pattern.id} for ${normalizedContext.issueType} at ${normalizedContext.lifecycleStage}.`,
  };
}

export function validateOrchestrationProposal({ policy, context, proposal } = {}) {
  const errors = [];
  if (!proposal || typeof proposal !== 'object' || Array.isArray(proposal)) errors.push('proposal must be an object');
  const allowedKeys = new Set(['pattern', 'profile', 'capabilities', 'mcp']);
  for (const key of Object.keys(proposal ?? {})) if (!allowedKeys.has(key)) errors.push(`proposal uses an unapproved property ${key}`);
  const pattern = patternById(policy, proposal?.pattern);
  if (!pattern) errors.push('proposal uses an unapproved orchestration pattern');
  const profile = profileById(policy, proposal?.profile);
  if (!profile) errors.push('proposal uses an unapproved agent profile');
  if (pattern && !profileIds(pattern).includes(proposal.profile)) errors.push('proposal profile is not part of the selected pattern');
  if (!Array.isArray(proposal?.capabilities) || proposal.capabilities.some((capability) => !capabilityNames(policy).has(capability))) errors.push('proposal uses an unapproved capability');
  if (!Array.isArray(proposal?.mcp) || proposal.mcp.some((server) => !mcpNames(policy).has(server))) errors.push('proposal uses an unapproved MCP server');
  const observed = context ? availableCapabilities(context, policy) : { capabilities: [], mcp: [], skills: [] };
  for (const capability of proposal?.capabilities ?? []) if (!observed.capabilities.includes(capability)) errors.push(`proposal requests unavailable capability ${capability}`);
  for (const server of proposal?.mcp ?? []) if (!observed.mcp.includes(server)) errors.push(`proposal requests unavailable MCP server ${server}`);
  // Proposal data is untrusted. Only the observed runner inventory in the
  // context may authorize capabilities or MCP servers; a model cannot grant
  // itself access by listing a capability in its proposal.
  const observedMcp = (context?.mcp ?? []).filter((server) => (proposal.mcp ?? []).includes(typeof server === 'string' ? server : server?.name));
  const selected = pattern && context ? selectOrchestration({ policy, context, available: { capabilities: [...new Set(context.capabilities ?? [])], mcp: observedMcp } }) : null;
  if (selected && selected.pattern !== proposal.pattern) errors.push(`proposal does not match the deterministic selection (${selected.pattern ?? selected.status})`);
  if (pattern && (proposal.capabilities ?? []).some((capability) => !profileCapabilitySet(policy, pattern).has(capability))) errors.push('proposal requests a capability outside the selected pattern policy');
  if (pattern && (proposal.mcp ?? []).some((server) => !profileMcpSet(policy, pattern).has(server))) errors.push('proposal requests an MCP server outside the selected pattern policy');
  return { allowed: errors.length === 0, pattern: proposal?.pattern ?? null, profile: proposal?.profile ?? null, reasons: errors };
}
