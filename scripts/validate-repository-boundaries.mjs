import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { parseRepositoryYaml } from './lib/yaml.mjs';

const execFileAsync = promisify(execFile);
const REPOSITORY = /^[A-Za-z0-9_.-]+$/;
const TARGET_IDS = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const STATUSES = new Set(['pending', 'pending-entitlement', 'transitional', 'ready']);

export class RepositoryBoundaryValidationError extends Error {
  constructor(message, exitCode = 1) {
    super(message);
    this.name = 'RepositoryBoundaryValidationError';
    this.exitCode = exitCode;
  }
}

async function trackedMatches(repositoryRoot, pattern) {
  try {
    const { stdout } = await execFileAsync('git', ['-C', repositoryRoot, 'ls-files', '--cached', '--others', '--exclude-standard', '--', pattern], { encoding: 'utf8', windowsHide: true });
    return stdout.split(/\r?\n/).filter(Boolean);
  } catch (error) {
    throw new RepositoryBoundaryValidationError(`Repository boundary check: git inventory failed: ${error.message}`, 2);
  }
}

export async function validateRepositoryBoundaries({ repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..') } = {}) {
  const manifestPath = path.join(repositoryRoot, 'migration', 'repository-boundaries.yml');
  let manifest;
  try {
    manifest = parseRepositoryYaml(await readFile(manifestPath, 'utf8'), manifestPath);
  } catch (error) {
    throw new RepositoryBoundaryValidationError(`Repository boundary check: cannot read manifest: ${error.message}`);
  }
  const errors = [];
  if (manifest.version !== 1) errors.push('version must be 1');
  if (manifest.source?.repository !== 'agentic-delivery-lab/agentic-delivery') errors.push('source.repository must identify the current migration source');
  if (manifest.source?.defaultBranch !== 'main') errors.push('source.defaultBranch must be main');
  if (manifest.source?.historyStrategy !== 'filtered-history-with-source-map') errors.push('source.historyStrategy must preserve filtered history and a source map');
  if (manifest.source?.historyTool !== 'git-filter-repo') errors.push('source.historyTool must be git-filter-repo');
  if (manifest.source?.issueAndPullRequestUrls !== 'preserve') errors.push('source.issueAndPullRequestUrls must be preserve');
  if (!Array.isArray(manifest.targets) || manifest.targets.length === 0) errors.push('targets must be a non-empty array');

  const targetIds = new Set();
  const targetRepositories = new Set();
  const ownership = new Map();
  for (const target of manifest.targets ?? []) {
    if (!target || typeof target !== 'object' || Array.isArray(target)) {
      errors.push('each target must be an object');
      continue;
    }
    if (!TARGET_IDS.test(String(target.id ?? '')) || targetIds.has(target.id)) errors.push(`target IDs must be unique kebab-case values: ${target.id ?? '<missing>'}`);
    targetIds.add(target.id);
    const repository = String(target.repository ?? '');
    if (!repository.includes('/') && !REPOSITORY.test(repository)) errors.push(`target ${target.id} has an invalid repository name`);
    if (targetRepositories.has(repository)) errors.push(`target repositories must be unique: ${repository}`);
    targetRepositories.add(repository);
    if (!STATUSES.has(target.status)) errors.push(`target ${target.id} has an unsupported status`);
    if (typeof target.canonical !== 'boolean') errors.push(`target ${target.id}.canonical must be boolean`);
    if (!Array.isArray(target.sourcePaths)) errors.push(`target ${target.id}.sourcePaths must be an array`);
    for (const pattern of target.sourcePaths ?? []) {
      if (typeof pattern !== 'string' || pattern.length === 0) {
        errors.push(`target ${target.id} contains an invalid source path`);
        continue;
      }
      const matches = await trackedMatches(repositoryRoot, pattern);
      if (matches.length === 0) errors.push(`target ${target.id} source path has no tracked match: ${pattern}`);
      for (const match of matches) {
        const prior = ownership.get(match);
        if (prior && prior !== target.id) errors.push(`${match} is assigned to both ${prior} and ${target.id}`);
        ownership.set(match, target.id);
      }
    }
  }

  for (const projection of manifest.projections ?? []) {
    if (!projection?.canonicalTarget || !projection?.projectionTarget || projection.canonicalTarget === projection.projectionTarget) errors.push(`projection ${projection?.id ?? '<missing>'} must have distinct canonical and projection targets`);
    if (projection.editableProjection !== false) errors.push(`projection ${projection?.id ?? '<missing>'} must be non-editable`);
    if (typeof projection.provenance !== 'string' || !projection.provenance) errors.push(`projection ${projection?.id ?? '<missing>'} must declare provenance`);
  }
  if (errors.length > 0) throw new RepositoryBoundaryValidationError(`${errors.map((error) => `Repository boundary check: ${error}`).join('\n')}\nRepository boundary check failed with ${errors.length} error(s).`);
  return { targets: manifest.targets.length, mappedFiles: ownership.size };
}

const isMainModule = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMainModule) {
  try {
    const result = await validateRepositoryBoundaries({ repositoryRoot: process.argv[2] ?? undefined });
    process.stdout.write(`Repository boundary check passed: ${result.targets} target(s), ${result.mappedFiles} mapped file(s).\n`);
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = error.exitCode ?? 1;
  }
}
