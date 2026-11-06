// agentic-primitive: {"id":"adr-structure-validator","kind":"validator","enforcement":"deterministic","adrs":["ADR-0001","ADR-0020","ADR-0021"],"domains":["agentic-delivery-governance"]}
import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseRepositoryYaml } from './lib/yaml.mjs';
import { isDeepStrictEqual } from 'node:util';
import {
  decisionReferenceMetadata, normalizeDecisionReferenceLines, readDecisionReferenceIndex,
  renderDecisionReference, renderDecisionTemplateReference,
} from './lib/decision-references.mjs';

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

  let referenceIndex;
  try {
    referenceIndex = await readDecisionReferenceIndex(root);
    const template = await readFile(path.join(decisionsDirectory, 'adr-template.md'), 'utf8');
    if (normalizeDecisionReferenceLines(template) !== renderDecisionTemplateReference(referenceIndex)) {
      addError('adr-template.md must remain a reference to the selected Authority template');
    }
  } catch (error) {
    throw new AdrValidationError(errorMessage(`approved Authority reference input is unavailable or changed: ${error.message}`), 1);
  }

  const entries = await readdir(decisionsDirectory, { withFileTypes: true });
  const allowedFiles = new Set(['README.md', 'adr-template.md', 'authority-reference-index.json',
    ...referenceIndex.records.map(record => path.basename(record.file))]);
  for (const entry of entries) {
    if (!entry.isFile() || !allowedFiles.has(entry.name)) {
      addError(`unindexed decision-directory entry: ${entry.name}`);
    }
  }
  const records = entries
    .filter((entry) => entry.isFile() && /^\d{4}-.*\.md$/.test(entry.name))
    .map(({ name }) => name)
    .sort()
    .map((name) => path.join(decisionsDirectory, name));

  if (records.length === 0) addError('no numbered Authority references found');
  const present = new Set(records.map((record) => `docs/decisions/${path.basename(record)}`));
  for (const record of referenceIndex.records) {
    if (!present.has(record.file)) addError(`missing indexed reference: ${record.file}`);
  }

  // References do not allocate or reuse this repository's formal decision
  // numbers. Identity is the selected Authority repository + source + record,
  // checked against the exact index below. Former local proposals stay in Git
  // history and cannot become canonical merely by sharing an integer.

  let previousNumber = 0;
  const recordNumbers = new Set();
  for (const record of records) {
    const filename = path.basename(record);
    const number = filename.slice(0, 4);
    const numericNumber = Number(number);
    if (number === '0000') addError(`${filename} uses reserved ADR number 0000`);
    if (numericNumber <= previousNumber) addError(`${filename} breaks the record sequence: record numbers must be strictly increasing; removed ADR numbers are not reused`);
    if (recordNumbers.has(number)) addError(`${filename} reuses ADR number ${number}`);
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
      addError(`${filename} must not define status in frontmatter; Authority owns decision lifecycle`);
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

    const expected = referenceIndex.records.find((entry) => entry.file === `docs/decisions/${filename}`);
    if (!expected || !isDeepStrictEqual(metadata, decisionReferenceMetadata(referenceIndex, expected))
      || normalizeDecisionReferenceLines(source) !== renderDecisionReference(referenceIndex, expected)) {
      addError(`${filename} must remain a reference only, with the exact selected Authority identity, source, hash and metadata projection`);
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
