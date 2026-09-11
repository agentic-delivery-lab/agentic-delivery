// agentic-primitive: {"id":"adr-structure-validator","kind":"validator","enforcement":"deterministic","adrs":["ADR-0001"],"domains":["agentic-delivery-governance"]}
import { execFile } from 'node:child_process';
import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseRepositoryYaml } from './lib/yaml.mjs';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const requiredHeadings = [
  '## Context and Problem Statement',
  '## Decision Drivers',
  '## Considered Options',
  '## Decision Outcome',
  '### Consequences',
  '### Confirmation',
  '## More Information',
];

export class AdrValidationError extends Error {
  constructor(message, exitCode = 1) {
    super(message);
    this.name = 'AdrValidationError';
    this.exitCode = exitCode;
  }
}

function errorMessage(message) {
  return `ADR check: ${message}`;
}

async function isDirectory(filePath) {
  try {
    return (await stat(filePath)).isDirectory();
  } catch {
    return false;
  }
}

async function isFile(filePath) {
  try {
    return (await stat(filePath)).isFile();
  } catch {
    return false;
  }
}

function frontmatter(source) {
  const lines = source.split(/\r?\n/);
  if (lines[0] !== '---') return null;
  const closingIndex = lines.findIndex((line, index) => index > 0 && line === '---');
  if (closingIndex === -1) return { lines, content: null };
  return { lines, content: lines.slice(1, closingIndex).join('\n') };
}

export async function validateAdrs(repositoryRoot = process.cwd()) {
  const root = path.resolve(repositoryRoot);
  if (!(await isDirectory(root))) {
    throw new AdrValidationError(errorMessage(`repository root does not exist: ${repositoryRoot}`), 2);
  }

  const decisionsDirectory = path.join(root, 'docs', 'decisions');
  const errors = [];
  const addError = (message) => errors.push(errorMessage(message));

  if (!(await isDirectory(decisionsDirectory))) {
    addError('missing docs/decisions directory');
    throw new AdrValidationError(errors.join('\n'), 1);
  }

  for (const requiredFile of ['README.md', 'adr-template.md']) {
    if (!(await isFile(path.join(decisionsDirectory, requiredFile)))) {
      addError(`missing docs/decisions/${requiredFile}`);
    }
  }

  const records = (await readdir(decisionsDirectory, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && /^\d{4}-.*\.md$/.test(entry.name))
    .map(({ name }) => name)
    .sort()
    .map((name) => path.join(decisionsDirectory, name));

  if (records.length === 0) addError('no numbered ADR records found');

  // A removed ADR number is historical identity, not a reusable slot. When
  // Git history is available, reject a current record whose number previously
  // named a different file. Fixture roots without Git history remain valid.
  try {
    const { stdout } = await execFileAsync('git', ['-C', root, 'log', '--all', '--format=', '--name-only', '--', 'docs/decisions'], { encoding: 'utf8' });
    const historicalNames = new Map();
    for (const file of stdout.split(/\r?\n/).filter((value) => /^docs\/decisions\/\d{4}-[a-z0-9-]+\.md$/.test(value))) {
      const number = file.slice('docs/decisions/'.length, 'docs/decisions/'.length + 4);
      const names = historicalNames.get(number) ?? new Set();
      names.add(path.basename(file));
      historicalNames.set(number, names);
    }
    for (const record of records) {
      const filename = path.basename(record);
      const number = filename.slice(0, 4);
      const priorNames = historicalNames.get(number);
      if (priorNames && [...priorNames].some((name) => name !== filename)) {
        addError(`${filename} reuses ADR-${number}, previously assigned to ${[...priorNames].filter((name) => name !== filename).join(', ')}`);
      }
    }
  } catch { /* A non-Git fixture cannot prove historical reuse. */ }

  let previousNumber = 0;
  const recordNumbers = new Set();
  for (const record of records) {
    const filename = path.basename(record);
    const number = filename.slice(0, 4);
    const numericNumber = Number(number);
    if (numericNumber <= previousNumber) addError(`${filename} breaks the record sequence: record numbers must be strictly increasing; removed ADR numbers are not reused`);
    if (recordNumbers.has(number)) addError(`${filename} duplicates ADR-${number}`);
    previousNumber = numericNumber;
    recordNumbers.add(number);

    if (!/^\d{4}-[a-z0-9]+(?:[a-z0-9-]*[a-z0-9])?\.md$/.test(filename)) {
      addError(`${filename} does not use the NNNN-title-with-dashes.md format`);
    }

    let source;
    try {
      source = await readFile(record, 'utf8');
    } catch (error) {
      addError(`${filename} cannot be read: ${error.message}`);
      continue;
    }

    const parsedFrontmatter = frontmatter(source);
    if (!parsedFrontmatter) {
      addError(`${filename} has no opening YAML frontmatter`);
      continue;
    }
    if (parsedFrontmatter.content === null) {
      addError(`${filename} has no closing YAML frontmatter`);
      continue;
    }

    let metadata;
    try {
      metadata = parseRepositoryYaml(parsedFrontmatter.content, `${filename} frontmatter`);
    } catch (error) {
      addError(`${filename} has invalid YAML frontmatter: ${error.message}`);
      metadata = {};
    }
    if (Object.hasOwn(metadata, 'status')) {
      addError(`${filename} must not define status in frontmatter; the main branch defines official ADR state`);
    }
    if (typeof metadata?.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(metadata.date)) {
      addError(`${filename} has no ISO date in its frontmatter`);
    }
    if (typeof metadata?.['source-issue'] !== 'string' || !/^https:\/\/github\.com\/[^/\s]+\/[^/\s]+\/issues\/\d+$/.test(metadata['source-issue'])) {
      addError(`${filename} has no valid GitHub source-issue URL in its frontmatter`);
    }
    const domains = metadata?.domains;
    if (!Array.isArray(domains) || domains.length === 0 || domains.some((domain) => typeof domain !== 'string' || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(domain))) {
      addError(`${filename} must declare one or more valid domains in frontmatter`);
    }
    const enforcement = metadata?.['required-enforcement'];
    if (!Array.isArray(enforcement) || enforcement.length === 0 || enforcement.some((item) => !['deterministic', 'instructional', 'semantic'].includes(item))) {
      addError(`${filename} must declare valid required-enforcement values in frontmatter`);
    }
    if (metadata?.supersedes !== undefined && (!Array.isArray(metadata.supersedes)
      || metadata.supersedes.some((item) => typeof item !== 'string' || !/^ADR-\d{4}$/.test(item)))) {
      addError(`${filename} has invalid supersedes metadata`);
    }

    for (const heading of requiredHeadings) {
      if (!source.split(/\r?\n/).includes(heading)) {
        addError(`${filename} is missing required heading: ${heading}`);
      }
    }
    if (!/https:\/\/github\.com\/[^/\s]+\/[^/\s]+\/issues\/\d+/.test(source)) {
      addError(`${filename} does not link its source issue`);
    }

    if (await isFile(path.join(decisionsDirectory, 'README.md'))) {
      const readme = await readFile(path.join(decisionsDirectory, 'README.md'), 'utf8');
      if (!readme.includes(`(${filename})`)) {
        addError(`${filename} is not linked from docs/decisions/README.md`);
      }
    }
  }

  if (errors.length > 0) {
    throw new AdrValidationError(`${errors.join('\n')}\nADR check failed with ${errors.length} error(s).`, 1);
  }

  return records.length;
}

const isMainModule = process.argv[1]
  && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMainModule) {
  if (process.argv.length > 3) {
    process.stderr.write(`Usage: ${path.basename(process.argv[1])} [repository root]\n`);
    process.exitCode = 2;
  } else {
    try {
      const count = await validateAdrs(process.argv[2] ?? '.');
      process.stdout.write(`ADR check passed: ${count} record(s).\n`);
    } catch (error) {
      process.stderr.write(`${error.message}\n`);
      process.exitCode = error.exitCode ?? 1;
    }
  }
}
