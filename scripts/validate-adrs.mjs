import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

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
    .filter((entry) => entry.isFile() && /^\d{4}-.+\.md$/.test(entry.name))
    .map(({ name }) => name)
    .sort()
    .map((name) => path.join(decisionsDirectory, name));

  if (records.length === 0) addError('no numbered ADR records found');

  let expectedNumber = 1;
  for (const record of records) {
    const filename = path.basename(record);
    const number = filename.slice(0, 4);
    const expectedFilename = String(expectedNumber).padStart(4, '0');
    if (number !== expectedFilename) {
      addError(`${filename} breaks the record sequence; expected a record starting with ${expectedFilename}`);
    }
    expectedNumber += 1;

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

    const metadata = parsedFrontmatter.content;
    if (/^status:/m.test(metadata)) {
      addError(`${filename} must not define status in frontmatter; the main branch defines official ADR state`);
    }
    if (!/^date: \d{4}-\d{2}-\d{2}$/m.test(metadata)) {
      addError(`${filename} has no ISO date in its frontmatter`);
    }
    if (!/^source-issue: https:\/\/github\.com\/[^/\s]+\/[^/\s]+\/issues\/\d+$/m.test(metadata)) {
      addError(`${filename} has no valid GitHub source-issue URL in its frontmatter`);
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
