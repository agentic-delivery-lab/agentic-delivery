import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseRepositoryYaml } from './lib/yaml.mjs';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ID = /^[a-z0-9](?:[a-z0-9.-]{0,62}[a-z0-9])?$/;
const ALLOWED_FRONTMATTER = new Set(['version', 'id', 'name', 'description', 'schedule']);
const ALLOWED_SCHEDULE = new Set(['kind', 'expression', 'timeZone']);

export class AutomationTemplateValidationError extends Error {
  constructor(message, exitCode = 1) {
    super(message);
    this.name = 'AutomationTemplateValidationError';
    this.exitCode = exitCode;
  }
}

function addError(errors, message) {
  errors.push(`Automation template check: ${message}`);
}

function nonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function parseTemplate(source, relativePath, errors) {
  const lines = source.split(/\r?\n/);
  if (lines[0] !== '---') {
    addError(errors, `${relativePath} must start with YAML frontmatter`);
    return null;
  }
  const closing = lines.indexOf('---', 1);
  if (closing < 0) {
    addError(errors, `${relativePath} has no closing frontmatter delimiter`);
    return null;
  }
  let frontmatter;
  try {
    frontmatter = parseRepositoryYaml(lines.slice(1, closing).join('\n'), relativePath);
  } catch (error) {
    addError(errors, `${relativePath} frontmatter is invalid: ${error.message}`);
    return null;
  }
  const body = lines.slice(closing + 1).join('\n').trim();
  return { frontmatter, body };
}

function validateSchedule(schedule, relativePath, errors) {
  if (!schedule || typeof schedule !== 'object' || Array.isArray(schedule)) {
    addError(errors, `${relativePath}.schedule must be an object`);
    return;
  }
  for (const key of Object.keys(schedule)) if (!ALLOWED_SCHEDULE.has(key)) addError(errors, `${relativePath}.schedule contains unsupported field ${key}`);
  const kind = schedule.kind;
  if (!['manual', 'hourly', 'cron'].includes(kind)) {
    addError(errors, `${relativePath}.schedule.kind must be manual, hourly, or cron`);
    return;
  }
  if (kind === 'manual' || kind === 'hourly') {
    if ('expression' in schedule || 'timeZone' in schedule) addError(errors, `${relativePath}.schedule.${kind} must not define expression or timeZone`);
    return;
  }
  if (!nonEmptyString(schedule.expression) || schedule.expression.trim().split(/\s+/).length !== 5) addError(errors, `${relativePath}.schedule.expression must contain exactly five cron fields`);
  if (schedule.timeZone !== 'local') addError(errors, `${relativePath}.schedule.timeZone must be local`);
}

export async function validateAutomationTemplates({ repositoryRoot: root = repositoryRoot } = {}) {
  const manifestPath = path.join(root, 'automations/templates/manifest.json');
  let manifest;
  try {
    manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  } catch (error) {
    throw new AutomationTemplateValidationError(`cannot read manifest: ${error.message}`);
  }
  const errors = [];
  if (manifest.schemaVersion !== 1) addError(errors, 'manifest schemaVersion must be 1');
  if (manifest.status !== 'draft' && manifest.status !== 'released') addError(errors, 'manifest status must be draft or released');
  if (manifest.canonicalRepository !== 'agentic-delivery-lab/agentic-delivery') addError(errors, 'manifest canonicalRepository is invalid');
  if (!Array.isArray(manifest.templates) || manifest.templates.length === 0) addError(errors, 'manifest templates must be a non-empty array');
  const seenIds = new Set();
  const seenPaths = new Set();
  const expectedFiles = [];
  for (const entry of manifest.templates ?? []) {
    const prefix = `manifest template ${entry?.id ?? '<missing>'}`;
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      addError(errors, `${prefix} must be an object`);
      continue;
    }
    if (!ID.test(String(entry.id ?? '')) || seenIds.has(entry.id)) addError(errors, `${prefix} id must be unique and lowercase`);
    seenIds.add(entry.id);
    if (typeof entry.sourcePath !== 'string' || !entry.sourcePath.startsWith('automations/templates/') || !entry.sourcePath.endsWith('.automation.md') || entry.sourcePath.includes('..') || seenPaths.has(entry.sourcePath)) addError(errors, `${prefix} sourcePath is invalid or duplicated`);
    seenPaths.add(entry.sourcePath);
    if (entry.executionPolicy !== 'read-only-advisory') addError(errors, `${prefix} executionPolicy must be read-only-advisory`);
    if (!Array.isArray(entry.compatibilityTargets) || entry.compatibilityTargets.length === 0) addError(errors, `${prefix} compatibilityTargets must be non-empty`);
    if (entry.projection?.repository !== 'agentic-delivery-lab/agentic-delivery-distribution') addError(errors, `${prefix} projection repository is invalid`);
    if (typeof entry.projection?.targetPath !== 'string' || !entry.projection.targetPath.startsWith('packages/agent-plugin/automations/') || !entry.projection.targetPath.endsWith('.automation.md') || entry.projection.targetPath.includes('..')) addError(errors, `${prefix} projection targetPath is invalid`);
    expectedFiles.push(entry.sourcePath);
    try {
      const source = await readFile(path.join(root, entry.sourcePath), 'utf8');
      const parsed = parseTemplate(source, entry.sourcePath, errors);
      if (!parsed) continue;
      const keys = Object.keys(parsed.frontmatter ?? {});
      for (const key of keys) if (!ALLOWED_FRONTMATTER.has(key)) addError(errors, `${entry.sourcePath} contains unsupported frontmatter field ${key}`);
      if (parsed.frontmatter.version !== 1) addError(errors, `${entry.sourcePath}.version must be 1`);
      if (parsed.frontmatter.id !== entry.id || !ID.test(String(parsed.frontmatter.id ?? ''))) addError(errors, `${entry.sourcePath}.id must match its manifest id`);
      if (!nonEmptyString(parsed.frontmatter.name)) addError(errors, `${entry.sourcePath}.name must be non-empty`);
      if ('description' in parsed.frontmatter && !nonEmptyString(parsed.frontmatter.description)) addError(errors, `${entry.sourcePath}.description must be non-empty when present`);
      validateSchedule(parsed.frontmatter.schedule, entry.sourcePath, errors);
      if (!parsed.body) addError(errors, `${entry.sourcePath} prompt body must be non-empty`);
      if (!/read[- ]only/i.test(parsed.body) || !/do not (?:edit|mutate|change)/i.test(parsed.body)) addError(errors, `${entry.sourcePath} must state its read-only boundary`);
    } catch (error) {
      addError(errors, `${entry.sourcePath} cannot be read: ${error.message}`);
    }
  }
  let actualFiles = [];
  try {
    actualFiles = (await readdir(path.join(root, 'automations/templates'), { withFileTypes: true }))
      .filter((entry) => entry.isFile() && entry.name.endsWith('.automation.md'))
      .map((entry) => `automations/templates/${entry.name}`)
      .sort();
  } catch (error) {
    addError(errors, `cannot list automation templates: ${error.message}`);
  }
  if (JSON.stringify(actualFiles) !== JSON.stringify([...expectedFiles].sort())) addError(errors, `manifest/template mismatch: expected ${expectedFiles.sort().join(', ')}, found ${actualFiles.join(', ')}`);
  if (errors.length > 0) throw new AutomationTemplateValidationError(`${errors.join('\n')}\nAutomation template check failed with ${errors.length} error(s).`);
  return { templates: actualFiles.length, status: 'passed' };
}

const isMainModule = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMainModule) {
  try {
    const result = await validateAutomationTemplates({ repositoryRoot: process.argv[2] ?? undefined });
    process.stdout.write(`Automation template check passed: ${result.templates} template(s).\n`);
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = error.exitCode ?? 1;
  }
}
