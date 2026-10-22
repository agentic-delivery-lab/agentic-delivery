// agentic-primitive: {"id":"repository-validation-profile","kind":"validator","enforcement":"deterministic","adrs":["ADR-0018"],"domains":["agentic-delivery-governance","agentic-delivery-control-plane"]}
import { createHash } from 'node:crypto';
import path from 'node:path';

// Compiled controller-owned proposal. Repository enrollment and profile
// admission remain separate; resolving a profile does not activate delivery.
const verify = (argv, timeoutMs = 300_000) => ({ argv, timeoutMs, sandbox: 'delivery-verify' });
const install = [{ argv: ['pnpm','install','--frozen-lockfile','--ignore-scripts','--ignore-pnpmfile'], timeoutMs: 600_000, sandbox: 'delivery-deps' }];
const factory = (checks) => [
  verify(['node','@controller/scripts/run-delivery-tests.mjs']),
  ...checks.map((check) => verify(['pnpm',check])),
];
const profiles = [
  { repositoryId: '1358455028', name: 'agentic-delivery', id: 'control-plane', install,
    // The full Control Plane suite can exceed ten minutes on supported hosts.
    commands: [verify(['node','@controller/scripts/run-delivery-tests.mjs'], 900_000),
      ...['validate-toolchain.mjs','validate-adrs.mjs','validate-domain-language.mjs','validate-changelog.mjs','validate-config-files.mjs']
        .map((script) => verify(['node',`@controller/scripts/${script}`,'@workspace'])),
      ...['control-plane:boundary','traceability:check','migration:check'].map((check) => verify(['pnpm',check])),
      { argv: ['pnpm','audit','--audit-level=high','--ignore-pnpmfile'], timeoutMs: 600_000, sandbox: 'delivery-deps' } ] },
  { repositoryId: '1380894616', name: 'agentic-delivery-architecture', id: 'architecture', install,
    requiredReadOnlyInputs: ['requirementsSource'],
    commands: factory(['architecture:check','migration:check']) },
  { repositoryId: '1416207421', name: 'agentic-delivery-requirements', id: 'requirements', install,
    commands: factory(['requirements:check']) },
  { repositoryId: '1380894656', name: 'agentic-delivery-agent-customizations', id: 'agent-customizations', install,
    requiredReadOnlyInputs: ['architectureSource'],
    commands: factory(['primitive:check','migration:check']) },
  { repositoryId: '1380894705', name: 'agentic-delivery-distribution', id: 'distribution', install,
    commands: factory(['distribution:check']) },
  { repositoryId: '1368850419', name: '.github', id: 'public-adapter', install: [],
    commands: [verify(['node','@controller/scripts/validate-public-governance.mjs','--surface-root','@workspace','--control-plane-root','@controller']),
      verify(['node','--test','tests/*.test.mjs'])] },
  { repositoryId: '1380894756', name: '.github-private', id: 'private-adapter', install: [],
    commands: [verify(['node','@controller/scripts/validate-published-agents.mjs','@workspace','--require-surface','--primitive-root','@primitiveSource'])],
    requiredReadOnlyInputs: ['primitiveSource'] },
];
function freeze(value) {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}
export function resolveValidationProfile({ repositoryId, repository, controllerCommit }) {
  const selected = profiles.find((profile) => profile.repositoryId === repositoryId && `agentic-delivery-lab/${profile.name}` === repository);
  if (!selected || !/^[a-f0-9]{40}$/.test(controllerCommit ?? '')) {
    throw new Error('The validation profile requires a supported repository identity and immutable controller commit.');
  }
  const definition = { version: '1.0.0-proposed.2', ...selected };
  return freeze({ ...structuredClone(definition), controllerCommit,
    contentSha256: createHash('sha256').update(JSON.stringify(definition)).digest('hex') });
}

export function validationProfileReference(profile) {
  return { id: profile.id, version: profile.version, contentSha256: profile.contentSha256, controllerCommit: profile.controllerCommit };
}
export function matchesValidationProfile(reference, profile) {
  const expected = validationProfileReference(profile);
  return reference !== null && typeof reference === 'object' && Object.keys(reference).length === 4
    && Object.entries(expected).every(([key, value]) => reference[key] === value);
}
export function materializeValidationCommand(command, { workspace, controllerRoot, primitiveSource }) {
  const roots = { workspace, controller: controllerRoot, primitiveSource };
  return command.argv.map((argument) => {
    if (!argument.startsWith('@')) return argument;
    const match = /^@(workspace|controller|primitiveSource)(\/.*)?$/.exec(argument);
    const root = match && roots[match[1]];
    if (typeof root !== 'string' || !path.isAbsolute(root)) throw new Error('The validation profile requires a trusted absolute read-only input path.');
    const suffix = match[2]?.slice(1) ?? '';
    if (suffix.includes('\\') || suffix.split('/').includes('..') || path.isAbsolute(suffix)) {
      throw new Error('The validation command must stay within its declared input.');
    }
    const resolved = path.resolve(root, suffix);
    const relative = path.relative(root, resolved);
    if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
      throw new Error('The validation command must stay within its declared input.');
    }
    return resolved;
  });
}

// Presence is an admission prerequisite, not proof of source provenance. The
// trusted authority resolver must verify and mount these inputs; Issue/env paths
// cannot provision them. No such resolver is installed by this proposal.
export function requireValidationProfileInputs(profile, inputs) {
  for (const name of profile.requiredReadOnlyInputs ?? []) {
    if (typeof inputs[name] !== 'string' || !path.isAbsolute(inputs[name])) {
      throw Object.assign(new Error(`The validation profile requires admitted read-only input ${name}; preserve the operation until trusted source admission is available.`), { code: 'VALIDATION_PROFILE_HOLD' });
    }
  }
}
