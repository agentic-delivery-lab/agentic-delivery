import { createHash } from 'node:crypto';
import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseRepositoryYaml } from './lib/yaml.mjs';

const AGENT_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const PRIMITIVE_ID = /^urn:agentic-delivery:primitive:[a-z0-9-]+$/;
const ADR_ID = /^urn:agentic-delivery:adr:[a-z0-9-]+$/;
const SHA1 = /^[0-9a-f]{40}$/i;
const SHA256 = /^[0-9a-f]{64}$/i;
const SEMVER = /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
const ALLOWED_ROOT_ENTRIES = new Set(['profile', 'agents', 'provenance', '.github', '.gitignore', 'AGENTS.md', 'README.md']);
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

function primitiveMetadata(source, file) {
  const marker = /<!--\s*agentic-primitive:\s*(\{[\s\S]*?\})\s*-->/u.exec(source);
  if (!marker) throw new Error(`${file} must contain an agentic-primitive metadata block`);
  let value;
  try { value = JSON.parse(marker[1]); } catch (error) { throw new Error(`${file} primitive metadata is invalid JSON: ${error.message}`); }
  const primitiveId = String(value.id ?? '').startsWith('urn:')
    ? String(value.id)
    : `urn:agentic-delivery:primitive:${String(value.id ?? '')}`;
  return { ...value, primitiveId };
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

async function regularFile(filePath, label) {
  const details = await stat(filePath);
  if (!details.isFile()) throw new Error(`${label} is not a regular file`);
  return readFile(filePath, 'utf8');
}

async function loadPrimitiveSource({ primitiveRoot, errors }) {
  const result = { release: null, agents: new Map() };
  try {
    result.release = JSON.parse(await regularFile(path.join(primitiveRoot, 'manifests/primitive-release.json'), 'Primitive release manifest'));
    if (result.release.schemaVersion !== 1 || !SHA1.test(result.release.sourceCommit ?? '')) {
      errors.push('Primitive release manifest must contain schemaVersion 1 and an immutable sourceCommit');
    }
  } catch (error) {
    errors.push(`Primitive release manifest cannot be read: ${error.message}`);
    return result;
  }
  let entries;
  try { entries = await readdir(path.join(primitiveRoot, 'agents/copilot'), { withFileTypes: true }); }
  catch (error) {
    if (error.code !== 'ENOENT') errors.push(`Primitive agent source directory cannot be read: ${error.message}`);
    return result;
  }
  for (const entry of entries.filter((item) => item.isFile() && item.name.endsWith('.agent.md')).sort((left, right) => left.name.localeCompare(right.name))) {
    const sourcePath = `agents/copilot/${entry.name}`;
    try {
      const source = await regularFile(path.join(primitiveRoot, sourcePath), sourcePath);
      const metadata = primitiveMetadata(source, sourcePath);
      const parsed = frontmatter(source, sourcePath);
      const agentId = String(parsed?.name ?? '');
      if (!AGENT_ID.test(agentId)) throw new Error('frontmatter name must use lowercase kebab-case');
      if (result.agents.has(agentId)) throw new Error(`duplicate canonical agent ${agentId}`);
      result.agents.set(agentId, { sourcePath, source, agentId, metadata });
    } catch (error) {
      errors.push(`Primitive source ${sourcePath} cannot be read or parsed: ${error.message}`);
    }
  }
  return result;
}

export async function validatePublishedAgents({ publicationRoot, primitiveRoot, allowedTools = ALLOWED_TOOLS, requireSurface = false } = {}) {
  const root = path.resolve(publicationRoot ?? path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '.github-private'));
  const errors = [];
  const entries = await directoryEntries(root);
  for (const entry of entries) {
    // A normal checkout contains the VCS metadata directory. It is not part
    // of the published surface and must not make the repository fail its own
    // publication check.
    if (entry.name === '.git') continue;
    if (!ALLOWED_ROOT_ENTRIES.has(entry.name)) errors.push(`unexpected top-level entry ${entry.name}`);
  }
  if (requireSurface) {
    const requiredFiles = ['profile/README.md', '.github/CODEOWNERS', '.github/workflows/validate-published-agents.yml', 'provenance/surface.yml'];
    for (const relative of requiredFiles) {
      try {
        const source = await regularFile(path.join(root, relative), relative);
        checkSecrets(source, relative, errors);
      } catch (error) {
        errors.push(`${relative} cannot be read: ${error.message}`);
      }
    }
  }
  const lockPath = path.join(root, 'provenance', 'agents.lock.json');
  let lock;
  try { lock = JSON.parse(await readFile(lockPath, 'utf8')); } catch (error) {
    errors.push(`provenance/agents.lock.json cannot be read: ${error.message}`);
    lock = null;
  }
  if (!lock || lock.schemaVersion !== 1) errors.push('publication lock schemaVersion must be 1');
  if (lock?.canonicalRepository !== 'agentic-delivery-lab/agentic-delivery-primitives') errors.push('publication lock canonicalRepository must be Agentic Primitives');
  if (!Array.isArray(lock?.agents)) errors.push('publication lock agents must be an array');
  const primitive = primitiveRoot ? await loadPrimitiveSource({ primitiveRoot: path.resolve(primitiveRoot), errors }) : null;
  const names = new Set();
  const paths = new Set();
  for (const [index, record] of (lock?.agents ?? []).entries()) {
    const prefix = `agents[${index}]`;
    if (!record || typeof record !== 'object' || Array.isArray(record)) { errors.push(`${prefix} must be an object`); continue; }
    if (!AGENT_ID.test(record.agentId ?? '')) errors.push(`${prefix}.agentId must use lowercase kebab-case`);
    if (!PRIMITIVE_ID.test(record.primitiveId ?? '')) errors.push(`${prefix}.primitiveId must be a primitive URI`);
    if (names.has(record.agentId)) errors.push(`${prefix}.agentId is duplicated`);
    names.add(record.agentId);
    if (!/^agents\/[a-z0-9]+(?:-[a-z0-9-]*[a-z0-9])?\.agent\.md$/.test(record.targetPath ?? '')) errors.push(`${prefix}.targetPath is not a safe published-agent path`);
    if (paths.has(record.targetPath)) errors.push(`${prefix}.targetPath is duplicated`);
    paths.add(record.targetPath);
    if (record.sourceRepository !== 'agentic-delivery-lab/agentic-delivery-primitives') errors.push(`${prefix}.sourceRepository must be Agentic Primitives`);
    if (!SHA1.test(record.sourceCommit ?? '')) errors.push(`${prefix}.sourceCommit must be an immutable commit SHA`);
    if (!SHA1.test(record.sourceRef ?? '') || String(record.sourceRef).toLowerCase() !== String(record.sourceCommit).toLowerCase()) errors.push(`${prefix}.sourceRef must repeat the immutable source commit SHA`);
    if (!SHA256.test(record.contentSha256 ?? '')) errors.push(`${prefix}.contentSha256 must be a SHA-256 digest`);
    if (!Array.isArray(record.governingAdrs) || record.governingAdrs.length === 0 || record.governingAdrs.some((adr) => !ADR_ID.test(adr))) errors.push(`${prefix}.governingAdrs must contain primitive ADR URIs`);
    if (!SEMVER.test(record.toolPolicyVersion ?? '')) errors.push(`${prefix}.toolPolicyVersion must use SemVer`);
    if (typeof record.promotionRelease !== 'string' || !record.promotionRelease.trim()) errors.push(`${prefix}.promotionRelease must be non-empty`);
    if (typeof record.promotedAt !== 'string' || Number.isNaN(Date.parse(record.promotedAt))) errors.push(`${prefix}.promotedAt must be an RFC3339 timestamp`);
    if (!Array.isArray(record.compatibilityTargets) || record.compatibilityTargets.length === 0 || record.compatibilityTargets.some((target) => typeof target !== 'string' || !target.trim())) errors.push(`${prefix}.compatibilityTargets must be non-empty strings`);
    if (primitive?.release) {
      if (record.sourceCommit !== primitive.release.sourceCommit) errors.push(`${prefix}.sourceCommit must match the checked-out Primitive release sourceCommit`);
      if (record.promotionRelease !== primitive.release.releaseId) errors.push(`${prefix}.promotionRelease must match the checked-out Primitive release`);
      if (record.toolPolicyVersion !== primitive.release.capabilityPolicyVersion) errors.push(`${prefix}.toolPolicyVersion must match the checked-out Primitive capability policy`);
      const canonical = primitive.agents.get(record.agentId);
      if (!canonical) errors.push(`${prefix}.agentId has no canonical Primitive source file`);
      else {
        if (digest(canonical.source) !== String(record.contentSha256).toLowerCase()) errors.push(`${prefix}.contentSha256 does not match the canonical Primitive source`);
        if (canonical.metadata.primitiveId !== record.primitiveId) errors.push(`${prefix}.primitiveId does not match the canonical Primitive metadata`);
      }
    }
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
        const canonical = primitive?.agents.get(record.agentId);
        if (canonical && source !== canonical.source) errors.push(`${record.targetPath} does not match the canonical Primitive source`);
      } catch (error) {
        errors.push(`${record.targetPath} cannot be read or parsed: ${error.message}`);
      }
    }
  }
  try {
    const publishedEntries = await readdir(path.join(root, 'agents'), { withFileTypes: true });
    for (const entry of publishedEntries) {
      if (entry.isFile() && entry.name.endsWith('.agent.md')) {
        const targetPath = `agents/${entry.name}`;
        if (!paths.has(targetPath)) errors.push(`${targetPath} is not declared in provenance/agents.lock.json`);
      }
    }
  } catch (error) {
    errors.push(`agents directory cannot be read: ${error.message}`);
  }
  checkSecrets(JSON.stringify(lock ?? {}), 'provenance/agents.lock.json', errors);
  if (errors.length > 0) throw new PublishedAgentValidationError(`${errors.map((error) => `Published-agent check: ${error}`).join('\n')}\nPublished-agent check failed with ${errors.length} error(s).`);
  return { agents: lock.agents.length, root };
}

const isMainModule = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMainModule) {
  try {
    const args = process.argv.slice(2);
    let publicationRoot;
    let primitiveRoot;
    for (let index = 0; index < args.length; index += 1) {
      const arg = args[index];
      if (arg === '--require-surface') continue;
      if (arg === '--primitive-root') {
        primitiveRoot = args[++index];
        continue;
      }
      if (!arg.startsWith('--') && publicationRoot === undefined) publicationRoot = arg;
    }
    const result = await validatePublishedAgents({ publicationRoot, primitiveRoot, requireSurface: args.includes('--require-surface') });
    process.stdout.write(`Published-agent check passed: ${result.agents} agent projection(s).\n`);
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = error.exitCode ?? 1;
  }
}
