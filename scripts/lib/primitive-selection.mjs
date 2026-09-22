// agentic-primitive: {"id":"primitive-selection-validator","kind":"validator","enforcement":"deterministic","adrs":["ADR-0018"],"domains":["agentic-delivery-control-plane"]}

const ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
const SHA1 = /^[0-9a-f]{40}$/i;
const SHA256 = /^[0-9a-f]{64}$/i;

function list(value) {
  return Array.isArray(value) ? value : [];
}

function mapping(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function uniqueStrings(value) {
  return list(value).filter((item) => typeof item === 'string' && item.trim());
}

function sameSet(left, right) {
  const a = [...new Set(left)].sort();
  const b = [...new Set(right)].sort();
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

function primitiveIdsFromCatalog(catalog) {
  return new Set(list(catalog?.primitives).map((primitive) => primitive?.id).filter((id) => typeof id === 'string'));
}

function addError(errors, message) {
  errors.push(message);
}

/**
 * Validate the immutable mapping from orchestration profiles to released
 * Agentic Primitives. This is a selection contract, not a second catalog:
 * the Primitive repository remains the only authority for primitive content.
 */
export function validatePrimitiveSelection(selection, { policy, primitiveCatalog } = {}) {
  const errors = [];
  if (!selection || typeof selection !== 'object' || Array.isArray(selection)) {
    return { valid: false, errors: ['selection must be an object'] };
  }
  if (selection.schemaVersion !== 1) addError(errors, 'schemaVersion must be 1');
  if (selection.contractVersion !== '1.0.0') addError(errors, 'contractVersion must be 1.0.0');

  const source = selection.source;
  if (!source || typeof source !== 'object' || Array.isArray(source)) {
    addError(errors, 'source must be an object');
  } else {
    if (source.repository !== 'agentic-delivery-lab/agentic-delivery-primitives') addError(errors, 'source.repository must be the Agentic Primitives repository');
    if (typeof source.releaseId !== 'string' || !source.releaseId.startsWith('urn:agentic-delivery:primitive-release:')) addError(errors, 'source.releaseId must identify a Primitive release');
    if (typeof source.version !== 'string' || !SEMVER.test(source.version)) addError(errors, 'source.version must be a semantic version');
    if (typeof source.commit !== 'string' || !SHA1.test(source.commit)) addError(errors, 'source.commit must be a 40-character commit SHA');
    if (typeof source.contentSha256 !== 'string' || !SHA256.test(source.contentSha256)) addError(errors, 'source.contentSha256 must be a SHA-256 digest');
    if (typeof source.capabilityPolicyVersion !== 'string' || !SEMVER.test(source.capabilityPolicyVersion)) addError(errors, 'source.capabilityPolicyVersion must be a semantic version');
  }

  const policyProfiles = mapping(policy?.profiles);
  const selectedProfiles = mapping(selection.profiles);
  if (!Object.keys(selectedProfiles).length) addError(errors, 'profiles must be a non-empty mapping');
  const selectedIds = Object.keys(selectedProfiles);
  for (const profileId of Object.keys(policyProfiles)) {
    if (!(profileId in selectedProfiles)) addError(errors, `missing selection for orchestration profile ${profileId}`);
  }
  for (const profileId of selectedIds) {
    if (!(profileId in policyProfiles)) addError(errors, `selection contains an unknown orchestration profile ${profileId}`);
  }

  const policyCapabilities = new Set(Object.keys(mapping(policy?.capabilities)));
  const policyMcp = new Set(Object.keys(mapping(policy?.mcp_servers)));
  const knownPrimitiveIds = primitiveIdsFromCatalog(primitiveCatalog);
  for (const [profileId, selectionProfile] of Object.entries(selectedProfiles)) {
    if (!selectionProfile || typeof selectionProfile !== 'object' || Array.isArray(selectionProfile)) {
      addError(errors, `${profileId}: selection must be an object`);
      continue;
    }
    const expected = policyProfiles[profileId];
    const primitiveIds = uniqueStrings(selectionProfile.primitiveIds);
    if (!primitiveIds.length) addError(errors, `${profileId}: primitiveIds must be a non-empty array`);
    if (new Set(primitiveIds).size !== primitiveIds.length) addError(errors, `${profileId}: primitiveIds must be unique`);
    for (const id of primitiveIds) {
      if (!ID.test(id)) addError(errors, `${profileId}: invalid primitive ID ${id}`);
      if (knownPrimitiveIds.size && !knownPrimitiveIds.has(id)) addError(errors, `${profileId}: unknown Primitive ${id}`);
    }

    const capabilities = uniqueStrings(selectionProfile.capabilities);
    const mcp = uniqueStrings(selectionProfile.mcp);
    const tools = selectionProfile.tools;
    if (!Array.isArray(selectionProfile.capabilities)) addError(errors, `${profileId}: capabilities must be an array`);
    if (!Array.isArray(selectionProfile.tools) || tools.some((tool) => typeof tool !== 'string')) addError(errors, `${profileId}: tools must be an explicit string array`);
    if (!Array.isArray(selectionProfile.mcp)) addError(errors, `${profileId}: mcp must be an array`);
    if (selectionProfile.fallback !== 'hold' && selectionProfile.fallback !== 'fail-closed') addError(errors, `${profileId}: fallback must be hold or fail-closed`);
    for (const capability of capabilities) if (!policyCapabilities.has(capability)) addError(errors, `${profileId}: unknown capability ${capability}`);
    for (const server of mcp) if (!policyMcp.has(server)) addError(errors, `${profileId}: unknown MCP server ${server}`);

    if (expected) {
      if (selectionProfile.model !== expected.model) addError(errors, `${profileId}: model does not match orchestration policy`);
      if (selectionProfile.reasoning !== expected.reasoning) addError(errors, `${profileId}: reasoning does not match orchestration policy`);
      if (!sameSet(capabilities, expected.capabilities)) addError(errors, `${profileId}: capabilities do not match orchestration policy`);
      if (!sameSet(mcp, expected.mcp)) addError(errors, `${profileId}: MCP selection does not match orchestration policy`);
    }
  }
  return { valid: errors.length === 0, errors };
}

export { SHA1, SHA256, SEMVER };
