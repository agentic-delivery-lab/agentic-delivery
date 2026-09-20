import { createHash } from 'node:crypto';
import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseRepositoryYaml } from './lib/yaml.mjs';

const AGENT_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SHA1 = /^[0-9a-f]{40}$/i;
const SHA256 = /^[0-9a-f]{64}$/i;
const ALLOWED_ROOT_ENTRIES = new Set(['profile', 'agents', 'provenance', '.github', 'AGENTS.md', 'README.md']);
const ALLOWED_TOOLS = new Set(['codebase', 'editFiles', 'fetch', 'githubRepo', 'search', 'terminal']);
const SECRET_PATTERNS = [
  /-----BEGIN [A-Z ]+ PRIVATE KEY-----/i,
  /(?:gh[pousr]_|github_pat_|sk-[A-Za-z0-9_-]{15,})/,
  /(?:api[_-]?key|client[_-]?secret|private[_-]?key|password|token)\s*[:=]\s*['"]?[A-Za-z0-9_./+=-]{12,}/i,
];

export class PublishedAgentValidationError extends Error {
  constructor(message, exitCode = 1) {
    super(message);
    this.name = 'PublishedAgentValidationError';
    this.exitCode = exitCode;
  }
}

function digest(source) {
  return createHash('sha256').update(source, 'utf8').digest('hex');
}

function frontmatter(source, file) {
  const lines = source.split(/\r?\n/);
  if (lines[0] !== '---') throw new Error(`${file} must start with YAML frontmatter`);
  const closing = lines.findIndex((line, index) => index > 0 && line === '---');
  if (closing === -1) throw new Error(`${file} has no closing frontmatter delimiter`);
  return parseRepositoryYaml(lines.slice(1, closing).join('\n'), `${file} frontmatter`);
}

function checkSecrets(value, file, errors) {
  if (SECRET_PATTERNS.some((pattern) => pattern.test(value))) errors.push(`${file} contains a secret or credential-like value`);
}

async function directoryEntries(root) {
  try { return await readdir(root, { withFileTypes: true }); } catch (error) {
    if (error.code === 'ENOENT') throw new PublishedAgentValidationError(`Published-agent check: directory does not exist: ${root}`, 2);
    throw error;
  }
}

export async function validatePublishedAgents({ publicationRoot, allowedTools = ALLOWED_TOOLS } = {}) {
  const root = path.resolve(publicationRoot ?? path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '.github-private'));
  const errors = [];
  const entries = await directoryEntries(root);
  for (const entry of entries) if (!ALLOWED_ROOT_ENTRIES.has(entry.name)) errors.push(`unexpected top-level entry ${entry.name}`);
  const lockPath = path.join(root, 'provenance', 'agents.lock.json');
  let lock;
  try { lock = JSON.parse(await readFile(lockPath, 'utf8')); } catch (error) {
    errors.push(`provenance/agents.lock.json cannot be read: ${error.message}`);
    lock = null;
  }
  if (!lock || lock.schemaVersion !== 1) errors.push('publication lock schemaVersion must be 1');
  if (lock?.canonicalRepository !== 'agentic-delivery-lab/agentic-delivery-primitives') errors.push('publication lock canonicalRepository must be Agentic Primitives');
  if (!Array.isArray(lock?.agents)) errors.push('publication lock agents must be an array');
  const names = new Set();
  const paths = new Set();
  for (const [index, record] of (lock?.agents ?? []).entries()) {
    const prefix = `agents[${index}]`;
    if (!record || typeof record !== 'object' || Array.isArray(record)) { errors.push(`${prefix} must be an object`); continue; }
    if (!AGENT_ID.test(record.agentId ?? '')) errors.push(`${prefix}.agentId must use lowercase kebab-case`);
    if (names.has(record.agentId)) errors.push(`${prefix}.agentId is duplicated`);
    names.add(record.agentId);
    if (!/^agents\/[a-z0-9]+(?:-[a-z0-9-]*[a-z0-9])?\.agent\.md$/.test(record.targetPath ?? '')) errors.push(`${prefix}.targetPath is not a safe published-agent path`);
    if (paths.has(record.targetPath)) errors.push(`${prefix}.targetPath is duplicated`);
    paths.add(record.targetPath);
    if (record.sourceRepository !== 'agentic-delivery-lab/agentic-delivery-primitives') errors.push(`${prefix}.sourceRepository must be Agentic Primitives`);
    if (!SHA1.test(record.sourceCommit ?? '')) errors.push(`${prefix}.sourceCommit must be an immutable commit SHA`);
    if (!SHA256.test(record.contentSha256 ?? '')) errors.push(`${prefix}.contentSha256 must be a SHA-256 digest`);
    if (!Array.isArray(record.governingAdrs) || record.governingAdrs.length === 0) errors.push(`${prefix}.governingAdrs must be non-empty`);
    if (!Array.isArray(record.compatibilityTargets) || record.compatibilityTargets.length === 0) errors.push(`${prefix}.compatibilityTargets must be non-empty`);
    const target = path.join(root, record.targetPath ?? '');
    if (!target.startsWith(path.join(root, 'agents') + path.sep)) errors.push(`${prefix}.targetPath escapes agents/`);
    else {
      try {
        const source = await readFile(target, 'utf8');
        if (digest(source) !== String(record.contentSha256).toLowerCase()) errors.push(`${record.targetPath} contentSha256 does not match its publication lock`);
        checkSecrets(source, record.targetPath, errors);
        const metadata = frontmatter(source, record.targetPath);
        if (typeof metadata?.name !== 'string' || !metadata.name.trim()) errors.push(`${record.targetPath} frontmatter requires name`);
        if (metadata?.name !== record.agentId) errors.push(`${record.targetPath} frontmatter name must match agentId`);
        if (typeof metadata?.description !== 'string' || !metadata.description.trim()) errors.push(`${record.targetPath} frontmatter requires description`);
        if (!Array.isArray(metadata?.tools) || metadata.tools.length === 0) errors.push(`${record.targetPath} frontmatter requires an explicit tools list`);
        for (const tool of metadata?.tools ?? []) {
          if (typeof tool !== 'string' || !allowedTools.has(tool) || tool.includes('*')) errors.push(`${record.targetPath} declares an unapproved tool: ${tool}`);
        }
      } catch (error) {
        errors.push(`${record.targetPath} cannot be read or parsed: ${error.message}`);
      }
    }
  }
  checkSecrets(JSON.stringify(lock ?? {}), 'provenance/agents.lock.json', errors);
  if (errors.length > 0) throw new PublishedAgentValidationError(`${errors.map((error) => `Published-agent check: ${error}`).join('\n')}\nPublished-agent check failed with ${errors.length} error(s).`);
  return { agents: lock.agents.length, root };
}

const isMainModule = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMainModule) {
  try {
    const result = await validatePublishedAgents({ publicationRoot: process.argv[2] ?? undefined });
    process.stdout.write(`Published-agent check passed: ${result.agents} agent projection(s).\n`);
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = error.exitCode ?? 1;
  }
}
