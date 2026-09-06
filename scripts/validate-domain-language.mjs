import { access, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseRepositoryYaml, YamlParseError } from './lib/yaml.mjs';

export class DomainLanguageValidationError extends Error {
  constructor(message, exitCode = 1) {
    super(message);
    this.name = 'DomainLanguageValidationError';
    this.exitCode = exitCode;
  }
}

function checkError(message) {
  return `Domain-language check: ${message}`;
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

function presentString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function normalized(value) {
  return value.trim().toLowerCase();
}

export async function validateDomainLanguage(repositoryRoot = process.cwd()) {
  const root = path.resolve(repositoryRoot);
  if (!(await isDirectory(root))) {
    throw new DomainLanguageValidationError(checkError(`repository root does not exist: ${repositoryRoot}`), 2);
  }

  const domainDirectory = path.join(root, 'docs', 'domain');
  const registryPath = path.join(domainDirectory, 'ubiquitous-language.yml');
  if (!(await isDirectory(domainDirectory))) {
    throw new DomainLanguageValidationError(checkError('missing docs/domain directory'), 2);
  }
  if (!(await isFile(registryPath))) {
    throw new DomainLanguageValidationError(checkError('missing docs/domain/ubiquitous-language.yml'), 2);
  }

  let registry;
  try {
    registry = parseRepositoryYaml(
      await readFile(registryPath, 'utf8'),
      'invalid YAML',
    );
  } catch (error) {
    if (error instanceof YamlParseError) {
      throw new DomainLanguageValidationError(checkError(`invalid YAML: ${error.message.replace(/^invalid YAML: /, '').split(/\r?\n/, 1)[0]}`), 1);
    }
    throw new DomainLanguageValidationError(
      checkError(`cannot read docs/domain/ubiquitous-language.yml: ${error.message}`),
      2,
    );
  }

  const errors = [];
  const addError = (message) => errors.push(message);

  if (!registry || typeof registry !== 'object' || Array.isArray(registry)) {
    addError('root must be a mapping');
    registry = {};
  }

  if (!Number.isInteger(registry.version) || registry.version <= 0) {
    addError('version must be a positive integer');
  }

  let domain = registry.domain;
  if (!domain || typeof domain !== 'object' || Array.isArray(domain)) {
    addError('domain must be a mapping');
    domain = {};
  }
  for (const field of ['name', 'purpose']) {
    if (!presentString(domain[field])) addError(`domain.${field} must be a non-empty string`);
  }

  let contexts = registry.bounded_contexts;
  if (!Array.isArray(contexts) || contexts.length === 0) {
    addError('bounded_contexts must be a non-empty sequence');
    contexts = [];
  }

  const contextIds = new Map();
  contexts.forEach((context, index) => {
    const location = `bounded_contexts[${index}]`;
    if (!context || typeof context !== 'object' || Array.isArray(context)) {
      addError(`${location} must be a mapping`);
      return;
    }
    for (const field of ['id', 'name', 'definition']) {
      if (!presentString(context[field])) addError(`${location}.${field} must be a non-empty string`);
    }
    const contextId = context.id;
    if (!presentString(contextId)) return;
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(contextId)) {
      addError(`${location}.id must use kebab-case`);
    }
    if (contextIds.has(contextId)) {
      addError(`duplicate bounded context id: ${contextId}`);
    } else {
      contextIds.set(contextId, index);
    }
  });

  let terms = registry.terms;
  if (!Array.isArray(terms) || terms.length === 0) {
    addError('terms must be a non-empty sequence');
    terms = [];
  }

  const canonicalTerms = new Map();
  const validTerms = [];
  terms.forEach((termEntry, index) => {
    const location = `terms[${index}]`;
    if (!termEntry || typeof termEntry !== 'object' || Array.isArray(termEntry)) {
      addError(`${location} must be a mapping`);
      return;
    }
    for (const field of ['context', 'term', 'definition']) {
      if (!presentString(termEntry[field])) addError(`${location}.${field} must be a non-empty string`);
    }
    const contextId = termEntry.context;
    const term = termEntry.term;
    if (presentString(contextId) && !contextIds.has(contextId)) {
      addError(`${location}.context references unknown bounded context: ${contextId}`);
    }
    if (!presentString(contextId) || !presentString(term)) return;
    const key = `${contextId}\u0000${normalized(term)}`;
    if (canonicalTerms.has(key)) {
      addError(`duplicate term in ${contextId}: ${term}`);
    } else {
      canonicalTerms.set(key, index);
    }
    validTerms.push({ termEntry, index, contextId, term });
  });

  const avoidOwners = new Map();
  for (const { termEntry, index, contextId, term } of validTerms) {
    if (!Object.hasOwn(termEntry, 'avoid')) continue;
    const location = `terms[${index}].avoid`;
    const avoidValues = termEntry.avoid;
    if (!Array.isArray(avoidValues) || avoidValues.length === 0) {
      addError(`${location} must be a non-empty sequence of strings`);
      continue;
    }
    avoidValues.forEach((avoidValue, avoidIndex) => {
      if (!presentString(avoidValue)) {
        addError(`${location}[${avoidIndex}] must be a non-empty string`);
        return;
      }
      const avoidKey = `${contextId}\u0000${normalized(avoidValue)}`;
      if (canonicalTerms.has(avoidKey)) {
        addError(`avoid value conflicts with a canonical term in ${contextId}: ${avoidValue}`);
      }
      const previousOwner = avoidOwners.get(avoidKey);
      if (previousOwner) {
        addError(`avoid value maps to both ${previousOwner} and ${term} in ${contextId}: ${avoidValue}`);
      } else {
        avoidOwners.set(avoidKey, term);
      }
    });
  }

  if (errors.length > 0) {
    throw new DomainLanguageValidationError(
      `${errors.map((message) => checkError(message)).join('\n')}\n${checkError(`failed with ${errors.length} error(s).`)}`,
      1,
    );
  }

  return { contexts: contexts.length, terms: terms.length };
}

const isMainModule = process.argv[1]
  && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMainModule) {
  if (process.argv.length > 3) {
    process.stderr.write(`Usage: ${path.basename(process.argv[1])} [repository-root]\n`);
    process.exitCode = 2;
  } else {
    try {
      const result = await validateDomainLanguage(process.argv[2] ?? '.');
      process.stdout.write(`Domain-language check passed: ${result.contexts} context(s), ${result.terms} term(s).\n`);
    } catch (error) {
      process.stderr.write(`${error.message}\n`);
      process.exitCode = error.exitCode ?? 1;
    }
  }
}
