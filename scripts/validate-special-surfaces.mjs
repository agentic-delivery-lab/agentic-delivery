import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseRepositoryYaml } from './lib/yaml.mjs';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SHA1 = /^[0-9a-f]{40}$/;
const REQUIRED_SURFACES = new Map([
  ['public-organization-governance', { repository: '.github', visibility: 'public', role: 'public-organization-governance' }],
  ['private-member-copilot-publication', { repository: '.github-private', visibility: 'private', role: 'private-member-and-copilot-publication' }],
]);

export class SpecialSurfaceValidationError extends Error {
  constructor(message, exitCode = 1) {
    super(message);
    this.name = 'SpecialSurfaceValidationError';
    this.exitCode = exitCode;
  }
}

function addError(errors, message) {
  errors.push(`Special-surface check: ${message}`);
}

function nonEmptyString(value) {
  return typeof value === 'string' && value.length > 0;
}

function pathList(value, label, errors) {
  if (!Array.isArray(value) || value.length === 0 || value.some((entry) => !nonEmptyString(entry))) {
    addError(errors, `${label} must be a non-empty list of paths`);
    return false;
  }
  return true;
}

export async function validateSpecialSurfaces({ repositoryRoot: root = repositoryRoot } = {}) {
  const manifestPath = path.join(root, 'migration/special-surfaces.yml');
  let manifest;
  try {
    manifest = parseRepositoryYaml(await readFile(manifestPath, 'utf8'), manifestPath);
  } catch (error) {
    throw new SpecialSurfaceValidationError(`cannot read manifest: ${error.message}`);
  }

  const errors = [];
  if (manifest.schemaVersion !== 1) addError(errors, 'schemaVersion must be 1');
  if (manifest.organization !== 'agentic-delivery-lab') addError(errors, 'organization must be agentic-delivery-lab');
  if (!Array.isArray(manifest.surfaces) || manifest.surfaces.length !== REQUIRED_SURFACES.size) {
    addError(errors, `surfaces must contain exactly ${REQUIRED_SURFACES.size} required special surfaces`);
  }

  const seen = new Set();
  for (const surface of manifest.surfaces ?? []) {
    if (!surface || typeof surface !== 'object' || Array.isArray(surface)) {
      addError(errors, 'each surface must be an object');
      continue;
    }
    if (!ID.test(String(surface.id ?? '')) || seen.has(surface.id)) addError(errors, `surface IDs must be unique kebab-case values: ${surface.id ?? '<missing>'}`);
    seen.add(surface.id);
    const expected = REQUIRED_SURFACES.get(surface.id);
    if (!expected) {
      addError(errors, `surface ${surface.id ?? '<missing>'} is not an approved special surface`);
      continue;
    }
    for (const field of ['repository', 'visibility', 'role']) if (surface[field] !== expected[field]) addError(errors, `surface ${surface.id}.${field} must be ${expected[field]}`);
    if (surface.fullName !== `agentic-delivery-lab/${expected.repository}`) addError(errors, `surface ${surface.id}.fullName must match its organization repository`);
    if (typeof surface.canonical !== 'boolean') addError(errors, `surface ${surface.id}.canonical must be boolean`);
    if (surface.nonRuntime !== true) addError(errors, `surface ${surface.id}.nonRuntime must be true`);
    if (surface.workflowInheritance !== false) addError(errors, `surface ${surface.id}.workflowInheritance must be false`);
    pathList(surface.githubConsumedPaths, `surface ${surface.id}.githubConsumedPaths`, errors);
    pathList(surface.governancePaths, `surface ${surface.id}.governancePaths`, errors);
    if (!nonEmptyString(surface.bridge)) addError(errors, `surface ${surface.id}.bridge must describe its compatibility boundary`);
    if (surface.localEvidence !== undefined) {
      if (!surface.localEvidence || typeof surface.localEvidence !== 'object' || Array.isArray(surface.localEvidence)) {
        addError(errors, `surface ${surface.id}.localEvidence must be an object`);
      } else {
        if (!nonEmptyString(surface.localEvidence.branch)) addError(errors, `surface ${surface.id}.localEvidence.branch must be non-empty`);
        if (!SHA1.test(String(surface.localEvidence.commit ?? ''))) addError(errors, `surface ${surface.id}.localEvidence.commit must be an immutable SHA`);
        if (!nonEmptyString(surface.localEvidence.check)) addError(errors, `surface ${surface.id}.localEvidence.check must be non-empty`);
      }
    }

    if (surface.id === 'public-organization-governance') {
      if (surface.status !== 'observed') addError(errors, 'public-organization-governance.status must be observed until the public surface is revalidated');
      if (surface.canonical !== true) addError(errors, 'public-organization-governance must remain canonical for public defaults');
      for (const expectedPath of ['profile/README.md', '.github/ISSUE_TEMPLATE/**', '.github/pull_request_template.md']) {
        if (!surface.githubConsumedPaths.includes(expectedPath)) addError(errors, `public surface must declare ${expectedPath}`);
      }
    }

    if (surface.id === 'private-member-copilot-publication') {
      if (!['pending-entitlement', 'ready'].includes(surface.status)) addError(errors, 'private-member-copilot-publication.status must remain pending-entitlement or ready');
      if (surface.canonical !== false) addError(errors, 'private-member-copilot-publication must be a projection surface');
      if (!surface.projection || typeof surface.projection !== 'object' || Array.isArray(surface.projection)) {
        addError(errors, 'private-member-copilot-publication.projection must be an object');
      } else {
        if (surface.projection.canonicalRepository !== 'agentic-delivery-primitives') addError(errors, 'private publication must project from Agentic Primitives');
        if (surface.projection.provenancePath !== 'provenance/agents.lock.json') addError(errors, 'private publication provenance must use provenance/agents.lock.json');
        if (surface.projection.editableProjection !== false) addError(errors, 'private publication projection must be non-editable');
      }
      for (const excluded of ['secrets', 'runtime-state', 'lifecycle-state', 'architecture-authority', 'control-plane-implementation', 'organization-custom-instructions', 'enterprise-managed-settings']) {
        if (!surface.exclusions?.includes(excluded)) addError(errors, `private surface must exclude ${excluded}`);
      }
    }
  }

  for (const id of REQUIRED_SURFACES.keys()) if (!seen.has(id)) addError(errors, `required surface ${id} is missing`);
  if (errors.length > 0) throw new SpecialSurfaceValidationError(`${errors.join('\n')}\nSpecial-surface check failed with ${errors.length} error(s).`);
  return { surfaces: manifest.surfaces.length, status: 'passed' };
}

const isMainModule = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMainModule) {
  try {
    const result = await validateSpecialSurfaces({ repositoryRoot: process.argv[2] ?? undefined });
    process.stdout.write(`Special-surface check passed: ${result.surfaces} surface(s).\n`);
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = error.exitCode ?? 1;
  }
}
