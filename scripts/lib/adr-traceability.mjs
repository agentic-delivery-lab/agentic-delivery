import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

import { parseRepositoryYaml } from './yaml.mjs';

export const TRACEABILITY_VERSION = 1;
export const ADR_FILENAME = /^docs\/decisions\/(\d{4})-([a-z0-9-]+)\.md$/;
export const PRIMITIVE_MARKER = /(?:<!--|\/\/|#)\s*agentic-primitive:\s*(\{.*\})(?:\s*-->)?\s*$/;
const PRIMITIVE_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const ADR_ID = /^ADR-\d{4}$/;
const DOMAIN_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const KINDS = new Set(['instruction', 'skill', 'hook', 'customization', 'script', 'state-machine', 'validator', 'workflow']);
const ENFORCEMENTS = new Set(['deterministic', 'instructional', 'semantic']);
const TEXT_EXTENSIONS = new Set(['.md', '.mjs', '.js', '.yml', '.yaml', '.json', '.jsonc', '.toml', '.txt']);
const IGNORED_DIRECTORIES = new Set(['.git', 'node_modules', '.codex-delivery', 'coverage']);

function frontmatter(source) {
  const lines = String(source).split(/\r?\n/);
  if (lines[0] !== '---') return null;
  const closing = lines.findIndex((line, index) => index > 0 && line === '---');
  if (closing === -1) return { values: null, body: source };
  return { values: parseRepositoryYaml(lines.slice(1, closing).join('\n'), 'ADR frontmatter'), body: lines.slice(closing + 1).join('\n') };
}

function listify(value) {
  return Array.isArray(value) ? value.map(String) : [];
}

function headingAnchor(text, headings) {
  const base = String(text).toLocaleLowerCase('en-US')
    .replace(/<[^>]+>/g, '')
    .replace(/[^\p{Letter}\p{Number}\s-]/gu, '')
    .trim().replace(/\s+/g, '-');
  const count = headings.get(base) ?? 0;
  headings.set(base, count + 1);
  return `#${base}${count ? `-${count}` : ''}`;
}

function markerLocation(relativePath, lines, lineIndex, anchors) {
  if (!relativePath.endsWith('.md')) return null;
  for (let index = lineIndex - 1; index >= 0; index -= 1) {
    const match = /^#{1,6}\s+(.+?)\s*$/.exec(lines[index]);
    if (match) return headingAnchor(match[1], anchors);
  }
  return null;
}

function validatePrimitive(value, source) {
  const errors = [];
  if (!value || typeof value !== 'object' || Array.isArray(value)) return [`${source}: metadata must be a JSON object`];
  if (!PRIMITIVE_ID.test(value.id ?? '')) errors.push(`${source}: id must use lowercase kebab-case`);
  if (!KINDS.has(value.kind)) errors.push(`${source}: kind must be one of ${[...KINDS].join(', ')}`);
  if (!ENFORCEMENTS.has(value.enforcement)) errors.push(`${source}: enforcement must be one of ${[...ENFORCEMENTS].join(', ')}`);
  for (const field of ['adrs', 'domains']) {
    if (!Array.isArray(value[field]) || value[field].length === 0 || value[field].some((item) => typeof item !== 'string')) {
      errors.push(`${source}: ${field} must be a non-empty string array`);
    }
  }
  if (Array.isArray(value.adrs)) for (const adr of value.adrs) if (!ADR_ID.test(adr)) errors.push(`${source}: invalid ADR reference ${adr}`);
  if (Array.isArray(value.domains)) for (const domain of value.domains) if (!DOMAIN_ID.test(domain)) errors.push(`${source}: invalid domain reference ${domain}`);
  if (value.replaces !== undefined && (!Array.isArray(value.replaces) || value.replaces.some((item) => !PRIMITIVE_ID.test(item)))) {
    errors.push(`${source}: replaces must be an array of primitive IDs`);
  }
  return errors;
}

async function walk(root, relative = '') {
  const directory = path.join(root, relative);
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (entry.name.startsWith('.') && !['.github', '.agents'].includes(entry.name)) continue;
    if (entry.isDirectory()) {
      if (!IGNORED_DIRECTORIES.has(entry.name)) files.push(...await walk(root, path.join(relative, entry.name)));
    } else if (TEXT_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) files.push(path.join(relative, entry.name));
  }
  return files;
}

export async function collectPrimitives(repositoryRoot) {
  const root = path.resolve(repositoryRoot);
  const result = [];
  const errors = [];
  for (const relativePath of await walk(root)) {
    const absolutePath = path.join(root, relativePath);
    let source;
    try { source = await readFile(absolutePath, 'utf8'); } catch { continue; }
    const lines = source.split(/\r?\n/);
    const anchors = new Map();
    lines.forEach((line, lineIndex) => {
      const match = PRIMITIVE_MARKER.exec(line);
      if (!match) return;
      let value;
      try { value = JSON.parse(match[1]); } catch { errors.push(`${relativePath}:${lineIndex + 1}: metadata is not valid JSON`); return; }
      const sourceName = `${relativePath}:${lineIndex + 1}`;
      errors.push(...validatePrimitive(value, sourceName));
      if (errors.some((error) => error.startsWith(`${sourceName}:`))) return;
      const anchor = markerLocation(relativePath, lines, lineIndex, anchors);
      result.push({
        ...value,
        path: relativePath,
        ...(anchor ? { anchor } : {}),
        location: `${relativePath}${anchor ?? ''}`,
        line: lineIndex + 1,
      });
    });
  }
  const ids = new Set();
  for (const primitive of result) {
    if (ids.has(primitive.id)) errors.push(`duplicate primitive ID: ${primitive.id}`);
    ids.add(primitive.id);
  }
  return { primitives: result.sort((left, right) => left.id.localeCompare(right.id)), errors };
}

export async function collectAdrs(repositoryRoot) {
  const root = path.resolve(repositoryRoot);
  const records = [];
  const errors = [];
  const decisions = path.join(root, 'docs', 'decisions');
  for (const entry of (await readdir(decisions, { withFileTypes: true })).filter((item) => item.isFile())) {
    const match = `docs/decisions/${entry.name}`.match(ADR_FILENAME);
    if (!match) continue;
    const source = await readFile(path.join(decisions, entry.name), 'utf8');
    const parsed = frontmatter(source);
    const id = `ADR-${match[1]}`;
    const values = parsed?.values ?? {};
    const domains = listify(values.domains);
    const requiredEnforcement = listify(values['required-enforcement']);
    if (!domains.length) errors.push(`${entry.name}: domains must be a non-empty array`);
    if (!requiredEnforcement.length || requiredEnforcement.some((item) => !ENFORCEMENTS.has(item))) errors.push(`${entry.name}: required-enforcement is invalid`);
    const supersedes = listify(values.supersedes);
    if (supersedes.some((item) => !ADR_ID.test(item))) errors.push(`${entry.name}: supersedes contains an invalid ADR`);
    records.push({ id, file: `docs/decisions/${entry.name}`, domains, requiredEnforcement, supersedes });
  }
  return { adrs: records.sort((left, right) => left.id.localeCompare(right.id)), errors };
}

export function buildTraceability({ adrs, primitives, domains = [] }) {
  const adrById = new Map(adrs.map((adr) => [adr.id, adr]));
  const primitiveByAdr = new Map(adrs.map((adr) => [adr.id, []]));
  const primitiveRows = primitives.map((primitive) => ({
    id: primitive.id,
    path: primitive.path,
    ...(primitive.anchor ? { anchor: primitive.anchor } : {}),
    location: primitive.location,
    kind: primitive.kind,
    enforcement: primitive.enforcement,
    adrs: [...primitive.adrs].sort(),
    domains: [...primitive.domains].sort(),
    ...(primitive.replaces ? { replaces: [...primitive.replaces].sort() } : {}),
  }));
  for (const primitive of primitives) for (const adr of primitive.adrs) if (primitiveByAdr.has(adr)) primitiveByAdr.get(adr).push(primitive.id);
  const adrRows = adrs.map((adr) => ({
    id: adr.id,
    file: adr.file,
    domains: [...adr.domains].sort(),
    requiredEnforcement: [...adr.requiredEnforcement].sort(),
    ...(adr.supersedes.length ? { supersedes: [...adr.supersedes].sort() } : {}),
    primitives: [...(primitiveByAdr.get(adr.id) ?? [])].sort(),
  }));
  const domainIds = new Set([...domains, ...adrs.flatMap((adr) => adr.domains), ...primitives.flatMap((primitive) => primitive.domains)]);
  const domainRows = [...domainIds].sort().map((id) => ({
    id,
    adrs: adrRows.filter((adr) => adr.domains.includes(id)).map((adr) => adr.id),
    primitives: primitiveRows.filter((primitive) => primitive.domains.includes(id)).map((primitive) => primitive.id),
  }));
  return { version: TRACEABILITY_VERSION, source: 'primitive-references', adrs: adrRows, domains: domainRows, primitives: primitiveRows };
}

export function validateTraceability({ index, adrs, primitives, domainIds = [] }) {
  const errors = [];
  const expected = buildTraceability({ adrs, primitives, domains: domainIds });
  if (JSON.stringify(index) !== JSON.stringify(expected)) errors.push('generated traceability index is stale or does not match primitive references');
  const validDomains = new Set(domainIds);
  const adrById = new Map(adrs.map((adr) => [adr.id, adr]));
  for (const adr of adrs) for (const domain of adr.domains) if (!validDomains.has(domain)) errors.push(`${adr.id}: references unknown domain ${domain}`);
  for (const primitive of primitives) {
    for (const adrId of primitive.adrs) {
      const adr = adrById.get(adrId);
      if (!adr) errors.push(`${primitive.id}: references unknown ${adrId}`);
      else {
        if (!primitive.domains.some((domain) => adr.domains.includes(domain))) errors.push(`${primitive.id}: no primitive domain applies to ${adrId}`);
        for (const required of adr.requiredEnforcement) if (required === primitive.enforcement) continue;
      }
    }
    for (const domain of primitive.domains) if (!validDomains.has(domain)) errors.push(`${primitive.id}: references unknown domain ${domain}`);
  }
  for (const adr of adrs) {
    const refs = primitives.filter((primitive) => primitive.adrs.includes(adr.id));
    if (!refs.length) errors.push(`${adr.id}: has no implementing primitive`);
    for (const required of adr.requiredEnforcement) if (!refs.some((primitive) => primitive.enforcement === required)) errors.push(`${adr.id}: has no ${required} primitive`);
  }
  for (const adr of adrs) for (const superseded of adr.supersedes) if (adrById.has(superseded)) errors.push(`${adr.id}: superseded ${superseded} remains active`);
  return { valid: errors.length === 0, errors, expected };
}
