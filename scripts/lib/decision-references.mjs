// Consumer-side integrity and reading of the selected Authority's decision
// references. Canonical decision validation and authorship remain upstream.
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { APPROVED_ARCHITECTURE_SOURCE, APPROVED_ARCHITECTURE_INTEGRITY } from './approved-architecture-source.mjs';

const indexPath = 'docs/decisions/authority-reference-index.json';
// Hash of the source-owned metadata projection, checked against the accepted
// immutable source during preparation. This is not runtime admission.
const indexSha256 = 'cf270ee380b11dd0e467dca3009e04617f1d8f775f9e4dbbbf3012266ac09faf';
const hash = value => createHash('sha256').update(value).digest('hex');
const normalizeLines = value => value.replace(/\r\n/g, '\n');

function requireKnownIndex(index) {
  if (hash(`${JSON.stringify(index, null, 2)}\n`) !== indexSha256) {
    throw new Error('Authority reference index does not match the reviewed metadata projection.');
  }
}

export function parseDecisionReferenceIndex(raw) {
  const source = normalizeLines(raw);
  if (hash(source) !== indexSha256) throw new Error('Authority reference index does not match the reviewed metadata projection.');
  const index = JSON.parse(source);
  requireKnownIndex(index);
  if (!isDeepStrictEqual(index.architecture, APPROVED_ARCHITECTURE_SOURCE)
    || !isDeepStrictEqual(index.integrity, APPROVED_ARCHITECTURE_INTEGRITY)) {
    throw new Error('Authority reference index uses a different approved-source selection.');
  }
  return index;
}

export async function readDecisionReferenceIndex(repositoryRoot) {
  return parseDecisionReferenceIndex(await readFile(path.join(repositoryRoot, indexPath), 'utf8'));
}

export function decisionReferenceMetadata(index, record) {
  return {
    reference: record.id,
    date: record.date,
    'source-issue': record.sourceIssue,
    domains: record.domains,
    'required-enforcement': record.requiredEnforcement,
    ...(record.supersedes ? { supersedes: record.supersedes } : {}),
    'canonical-source': {
      repository: index.architecture.repository,
      repositoryId: index.architecture.repositoryId,
      commit: index.architecture.sourceCommit,
      path: record.canonicalPath,
      sha256: record.sha256,
    },
  };
}

export function renderDecisionReference(index, record) {
  const metadata = Object.entries(decisionReferenceMetadata(index, record))
    .map(([key, value]) => `${key}: ${JSON.stringify(value)}`).join('\n');
  const title = record.title.replace(/^ADR-\d{4}\s*[:—-]?\s*/, '').replace(/^\d+\.\s*/, '');
  const base = `https://github.com/${index.architecture.repository}/blob/`;
  return `---\n${metadata}\n---\n\n# ${record.id} — ${title} (Authority reference)\n\n`
    + `Canonical decision: [${record.id}](${base}${index.architecture.sourceCommit}/${record.canonicalPath}).\n\n`
    + `Governing Architecture Release: \`${index.architecture.version}\`, `
    + `[manifest commit ${index.architecture.commit}](${base}${index.architecture.commit}/${index.integrity.manifestPath}).\n\n`
    + `Canonical file SHA-256: \`${record.sha256}\`.\n\n`
    + 'This file carries reference metadata only. Architecture Authority owns the\n'
    + 'decision text and its lifecycle; a consumer branch does not become another\n'
    + 'canonical source. Git history retains the former local decision records.\n';
}

export function renderDecisionTemplateReference(index) {
  const source = index.architecture;
  return '# Architecture decision template — reference\n\n'
    + 'Use the shared template from the approved Architecture Authority source:\n\n'
    + `[${index.template.path}](https://github.com/${source.repository}/blob/${source.sourceCommit}/${index.template.path}).\n\n`
    + `Canonical file SHA-256: \`${index.template.sha256}\`.\n\n`
    + 'This consumer contains no formal decision template or independent numbering\n'
    + 'scheme. Formal changes require a separately identified Authority tracking\n'
    + 'Issue and its owning repository workflow. If the trusted template input is\n'
    + 'unavailable, hold; do not invent a local substitute.\n';
}

export { normalizeLines as normalizeDecisionReferenceLines };
