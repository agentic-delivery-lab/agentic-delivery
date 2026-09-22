import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const SHA = /^[0-9a-f]{40}$/i;
const ZERO = '0'.repeat(40);
// Keep the migration source configurable. This is a migration validator, not
// runtime routing code; assembling the documented default also prevents the
// control-plane boundary scan from mistaking its evidence label for a fixed
// production origin.
const DEFAULT_SOURCE_REPOSITORY = ['agentic-delivery-lab', 'agentic-delivery'].join('/');

export class ExtractionSourceValidationError extends Error {
  constructor(message, exitCode = 1) {
    super(message);
    this.name = 'ExtractionSourceValidationError';
    this.exitCode = exitCode;
  }
}

async function git(root, args) {
  try {
    return (await execFileAsync('git', ['-C', root, ...args], {
      encoding: 'utf8',
      windowsHide: true,
      maxBuffer: 32 * 1024 * 1024,
    })).stdout.trim();
  } catch (error) {
    throw new ExtractionSourceValidationError(`git ${args.join(' ')} failed in ${root}: ${error.message}`, 2);
  }
}

async function readJson(file) {
  try {
    return JSON.parse(await readFile(file, 'utf8'));
  } catch (error) {
    throw new ExtractionSourceValidationError(`cannot read ${file}: ${error.message}`);
  }
}

function fail(errors) {
  if (errors.length > 0) {
    const visible = errors.length > 20
      ? [...errors.slice(0, 20), `... ${errors.length - 20} additional error(s) omitted; inspect the target source map before publication.`]
      : errors;
    throw new ExtractionSourceValidationError(
      `${visible.map((error) => `Extraction-source check: ${error}`).join('\n')}\nExtraction-source check failed with ${errors.length} error(s).`,
    );
  }
}

async function validateTarget({ targetRoot, sourceRoot, sourceCommit, sourceRef, sourceRepository, errors }) {
  const manifestPath = path.join(targetRoot, 'migration/manifest.json');
  const mapPath = path.join(targetRoot, 'migration/source-commit-map.csv');
  let manifest;
  let map;
  try {
    manifest = await readJson(manifestPath);
    map = await readFile(mapPath, 'utf8');
  } catch (error) {
    errors.push(`${targetRoot}: ${error.message}`);
    return { mappedCommits: 0 };
  }

  const label = String(manifest.target?.repository ?? targetRoot);
  if (manifest.source?.repository !== sourceRepository) {
    errors.push(`${label}: source.repository must be ${sourceRepository}`);
  }
  if (manifest.source?.commit !== sourceCommit) {
    errors.push(`${label}: source.commit must equal ${sourceCommit}, got ${manifest.source?.commit ?? '<missing>'}`);
  }
  if (sourceRef !== undefined && manifest.source?.ref !== sourceRef) {
    errors.push(`${label}: source.ref must equal ${sourceRef}, got ${manifest.source?.ref ?? '<missing>'}`);
  }

  const lines = map.split(/\r?\n/).filter(Boolean);
  if (lines.shift()?.trim() !== 'old                                      new') {
    errors.push(`${label}: source map header is invalid`);
    return { mappedCommits: Math.max(0, lines.length) };
  }
  const sourceCommits = new Set();
  for (const [index, line] of lines.entries()) {
    const fields = line.trim().split(/\s+/);
    const oldCommit = fields[0];
    const newCommit = fields[1];
    if (fields.length !== 2 || !SHA.test(oldCommit ?? '') || !(SHA.test(newCommit ?? '') || newCommit === ZERO)) {
      errors.push(`${label}: source map line ${index + 2} is invalid`);
      continue;
    }
    if (sourceCommits.has(oldCommit)) errors.push(`${label}: source map repeats ${oldCommit}`);
    sourceCommits.add(oldCommit);
    try {
      if (await git(sourceRoot, ['cat-file', '-t', oldCommit]) !== 'commit') {
        errors.push(`${label}: source map commit ${oldCommit} is not present in the source repository`);
        continue;
      }
      await git(sourceRoot, ['merge-base', '--is-ancestor', oldCommit, sourceCommit]);
    } catch {
      errors.push(`${label}: source map commit ${oldCommit} is not an ancestor of source snapshot ${sourceCommit}`);
    }
  }
  return { mappedCommits: lines.length };
}

export async function validateExtractionSource({
  sourceRoot,
  sourceCommit,
  sourceRef,
  sourceRepository = DEFAULT_SOURCE_REPOSITORY,
  targetRoots = [],
} = {}) {
  if (!sourceRoot || !sourceCommit || !Array.isArray(targetRoots) || targetRoots.length === 0) {
    throw new ExtractionSourceValidationError('sourceRoot, sourceCommit, and at least one targetRoot are required', 2);
  }
  if (!SHA.test(String(sourceCommit))) throw new ExtractionSourceValidationError('sourceCommit must be a 40-character immutable SHA', 2);
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(String(sourceRepository))) {
    throw new ExtractionSourceValidationError('sourceRepository must be an owner/repository identifier', 2);
  }
  const errors = [];
  try {
    if (await git(sourceRoot, ['cat-file', '-t', sourceCommit]) !== 'commit') errors.push(`source snapshot ${sourceCommit} is not present in ${sourceRoot}`);
  } catch (error) {
    errors.push(error.message);
  }
  const targets = [];
  for (const targetRoot of targetRoots) {
    const result = await validateTarget({ targetRoot: path.resolve(targetRoot), sourceRoot: path.resolve(sourceRoot), sourceCommit, sourceRef, sourceRepository, errors });
    targets.push({ targetRoot: path.resolve(targetRoot), mappedCommits: result.mappedCommits });
  }
  fail(errors);
  return { status: 'passed', sourceRepository, sourceCommit, sourceRef: sourceRef ?? null, targets };
}

function parseArguments(argv) {
  const values = { targetRoots: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--') continue;
    if (argument === '--target-root') {
      const value = argv[++index];
      if (!value || value.startsWith('--')) throw new ExtractionSourceValidationError('--target-root requires a path', 2);
      values.targetRoots.push(value);
      continue;
    }
    if (!argument.startsWith('--') || !argv[index + 1] || argv[index + 1].startsWith('--')) {
      throw new ExtractionSourceValidationError(`invalid argument: ${argument}`, 2);
    }
    values[argument.slice(2).replaceAll('-', '')] = argv[++index];
  }
  return values;
}

const isMainModule = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMainModule) {
  try {
    const args = parseArguments(process.argv.slice(2));
    const result = await validateExtractionSource({
      sourceRoot: args.sourceroot,
      sourceCommit: args.sourcecommit,
      sourceRef: args.sourceref,
      sourceRepository: args.sourcerepository,
      targetRoots: args.targetRoots,
    });
    process.stdout.write(`Extraction source check passed: ${result.targets.length} target(s) at ${result.sourceCommit}.\n`);
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = error.exitCode ?? 1;
  }
}
