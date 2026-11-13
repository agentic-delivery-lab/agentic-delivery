import { execFile } from 'node:child_process';
import { constants } from 'node:fs';
import { lstat, open, opendir, realpath } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { isDeepStrictEqual, promisify } from 'node:util';

const execute = promisify(execFile);
const repository = 'agentic-delivery-lab/agentic-delivery-agent-customizations';
const sha1 = value => typeof value === 'string' && /^[0-9a-f]{40}$/.test(value);
const sha256 = value => typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const packagePrefix = 'packages/agent-plugin/';
const byteLimit = 2 * 1024 * 1024;
const packageByteLimit = 32 * 1024 * 1024;
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const exact = (value, keys) => record(value) && Object.keys(value).length === keys.length
  && keys.every(key => Object.hasOwn(value, key));
const hold = message => new Error(`Skill resource inventory: ${message}`);

// This closed factory contract is independent of claims in an input inventory.
const skills = ['architecture-decision', 'delivery-workflow', 'plain-language-communication', 'ubiquitous-language'];
const resourcePaths = Object.freeze([...skills.flatMap(name => [`skills/${name}/SKILL.md`, `skills/${name}/agents/openai.yaml`]),
  'references/architecture-authority.md', 'references/consumer-tools.md',
  'validators/workspace-lifecycle/README.md', 'validators/workspace-lifecycle/workspace_guard.py',
  'scripts/start-issue-branch.mjs', 'validators/repository-delivery/validate-branch-name.mjs',
  'validators/repository-delivery/validate-source-issue.mjs', 'schemas/primitive-release.schema.json',
  'manifests/primitive-release.json'].sort());

function supportedPath(value) {
  return typeof value === 'string' && /^[A-Za-z0-9._/-]+$/.test(value)
    && !path.posix.isAbsolute(value) && value.split('/').every(part => part && part !== '.' && part !== '..');
}

async function fileBytes(root, relative) {
  if (!supportedPath(relative)) throw hold('unsupported resource path');
  const parts = relative.split('/'); const parents = [];
  let current = root;
  for (const part of parts.slice(0, -1)) {
    current = path.join(current, part); const stats = await lstat(current);
    if (!stats.isDirectory() || stats.isSymbolicLink()) throw hold('resource parent is not a regular directory');
    parents.push({ current, stats });
  }
  const filename = path.join(root, ...parts); const before = await lstat(filename);
  if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1
    || (before.mode & 0o111) !== 0 || before.size > byteLimit) throw hold('unsupported resource file mode or size');
  const handle = await open(filename, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0));
  try {
    const opened = await handle.stat();
    if (!opened.isFile() || opened.dev !== before.dev || opened.ino !== before.ino) throw hold('resource changed while opening');
    for (const { current: directory, stats } of parents) {
      const now = await lstat(directory);
      if (!now.isDirectory() || now.isSymbolicLink() || now.dev !== stats.dev || now.ino !== stats.ino) {
        throw hold('resource parent changed while opening');
      }
    }
    const buffer = Buffer.alloc(before.size + 1); let offset = 0;
    while (offset < buffer.length) {
      const { bytesRead } = await handle.read(buffer, offset, buffer.length - offset, offset);
      if (!bytesRead) break;
      offset += bytesRead;
    }
    const bytes = buffer.subarray(0, offset); const after = await handle.stat(); const named = await lstat(filename);
    if (bytes.length !== before.size || bytes.length > byteLimit || after.size !== before.size || after.mtimeMs !== before.mtimeMs
      || after.ctimeMs !== before.ctimeMs || named.isSymbolicLink() || named.dev !== before.dev || named.ino !== before.ino) {
      throw hold('resource changed while reading');
    }
    return bytes;
  } finally { await handle.close(); }
}

async function document(root, relative) {
  try { return JSON.parse((await fileBytes(root, relative)).toString('utf8')); }
  catch { throw hold(`cannot read resource metadata ${relative}`); }
}

// Initial selection must use the same safe boundary before the factory version is known.
export async function readDistributionProjectionJson(root, relative) {
  if (!['manifests/workflow-bundle.json', 'manifests/sources.lock.json',
    'manifests/automation-projections.lock.json', 'manifests/capabilities.lock.json',
    'packages/agent-plugin/plugin.json'].includes(relative)) throw hold('unsupported projection metadata path');
  return document(await realpath(root), relative);
}

async function packageFiles(root, allowed, directory = 'packages/agent-plugin', found = new Set()) {
  const stats = await lstat(path.join(root, directory));
  if (!stats.isDirectory() || stats.isSymbolicLink()) throw hold('unsupported package resource directory');
  for await (const entry of await opendir(path.join(root, directory))) {
    const relative = `${directory}/${entry.name}`;
    if (!supportedPath(relative) || entry.isSymbolicLink()) throw hold('unsupported package resource entry');
    if (entry.isDirectory()) {
      if (![...allowed].some(file => file.startsWith(`${relative}/`))) throw hold('unlisted package resource directory');
      await packageFiles(root, allowed, relative, found);
    } else {
      if (!entry.isFile() || !allowed.has(relative)) throw hold('unlisted package resource file');
      found.add(relative);
    }
  }
  return found;
}

/** Read-only byte/provenance check inside the native release graph, not execution admission. */
async function validateResources({ distributionRoot, primitivesRoot,
  primitiveReleaseCommit, primitiveRelease, plugin, automationLock } = {}) {
  if (!sha1(primitiveReleaseCommit) || !sha1(primitiveRelease?.sourceCommit)
    || !sha256(primitiveRelease?.contentSha256) || plugin?.schemaVersion !== 2
    || plugin.resourceInventory !== 'resources.lock.json') throw hold('unsupported selected producer or package');
  const root = await realpath(distributionRoot);
  const packageManifest = await document(root, `${packagePrefix}plugin.json`);
  const { version, ...factory } = plugin;
  if (!exact(packageManifest, ['$schema', 'name', 'version', 'description', 'extensions'])
    || packageManifest.$schema !== 'https://agent-plugins.org/schemas/1.0.0/plugin.schema.json'
    || packageManifest.name !== plugin.id || packageManifest.version !== version
    || typeof packageManifest.description !== 'string' || !packageManifest.description.trim()
    || !exact(packageManifest.extensions, ['io.github.agentic-delivery-lab'])
    || !isDeepStrictEqual(packageManifest.extensions['io.github.agentic-delivery-lab'], factory)) {
    throw hold('package metadata changed or differs from the selected projection');
  }
  const lock = await document(root, `${packagePrefix}resources.lock.json`);
  if (!exact(lock, ['schemaVersion', 'primitiveRepository', 'primitiveRepositoryId', 'primitiveRelease',
    'releaseManifestCommit', 'implementationCommit', 'contentSha256', 'files'])
    || lock.schemaVersion !== 1 || lock.primitiveRepository !== repository || lock.primitiveRepositoryId !== 1380894656
    || lock.primitiveRelease !== primitiveRelease.releaseId || lock.releaseManifestCommit !== primitiveReleaseCommit
    || lock.implementationCommit !== primitiveRelease.sourceCommit || lock.contentSha256 !== primitiveRelease.contentSha256
    || plugin.generatedFrom?.primitiveRepository !== repository
    || plugin.generatedFrom?.primitiveRelease !== primitiveRelease.releaseId
    || plugin.generatedFrom?.primitiveSourceCommit !== primitiveReleaseCommit
    || plugin.generatedFrom?.primitiveImplementationCommit !== primitiveRelease.sourceCommit
    || plugin.generatedFrom?.primitiveContentSha256 !== primitiveRelease.contentSha256
    || !Array.isArray(lock.files) || lock.files.length !== resourcePaths.length) throw hold('header does not match selected producer');
  const byPath = new Map();
  for (const row of lock.files) {
    if (!exact(row, ['sourcePath', 'targetPath', 'sourceCommit', 'contentSha256', 'mode'])
      || !resourcePaths.includes(row.sourcePath) || byPath.has(row.sourcePath)
      || row.targetPath !== `${packagePrefix}${row.sourcePath}` || row.mode !== '100644' || !sha256(row.contentSha256)
      || row.sourceCommit !== (row.sourcePath === 'manifests/primitive-release.json' ? primitiveReleaseCommit : primitiveRelease.sourceCommit)) {
      throw hold('unsupported, duplicate or incorrectly bound resource');
    }
    byPath.set(row.sourcePath, row);
  }
  const automation = await document(root, 'manifests/automation-projections.lock.json');
  if (!Array.isArray(automation.templates) || !isDeepStrictEqual(automation, automationLock)) {
    throw hold('automation resource metadata differs from the selected projection');
  }
  const allowed = new Set([`${packagePrefix}plugin.json`, `${packagePrefix}resources.lock.json`, ...lock.files.map(row => row.targetPath)]);
  for (const entry of automation.templates) {
    if (!/^packages\/agent-plugin\/automations\/[a-z0-9.-]+\.automation\.md$/.test(entry?.targetPath ?? '')
      || allowed.has(entry.targetPath)) throw hold('unsupported or duplicate automation resource');
    allowed.add(entry.targetPath);
  }
  if (allowed.size > 2000) throw hold('package resource count exceeds the supported bound');
  // Reject unknown components and symlinked parents before reading projected content.
  const found = await packageFiles(root, allowed);
  if (found.size !== allowed.size || [...allowed].some(file => !found.has(file))) throw hold('package resource set is incomplete');
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')));
  Object.assign(env, { GIT_NO_REPLACE_OBJECTS: '1', GIT_NO_LAZY_FETCH: '1' });
  const deadline = performance.now() + 30_000;
  const git = async args => {
    const remaining = Math.floor(deadline - performance.now()); if (remaining < 1) throw hold('source observation deadline exceeded');
    try {
      const result = await execute('git', ['--no-replace-objects', '--no-lazy-fetch', '-C', primitivesRoot, ...args], {
        env, encoding: 'buffer', windowsHide: true, timeout: remaining, maxBuffer: byteLimit,
      });
      if (result.stderr.length) throw hold('immutable source returned uncertain diagnostics');
      return result.stdout;
    } catch { throw hold('selected immutable resource could not be reproduced'); }
  };
  let packageBytes = 0;
  for (const sourcePath of resourcePaths) {
    const row = byPath.get(sourcePath);
    const entry = (await git(['ls-tree', '-z', row.sourceCommit, '--', sourcePath])).toString('utf8');
    const match = /^100644 blob ([0-9a-f]{40})\t([^\0]+)\0$/.exec(entry);
    if (!match || match[2] !== sourcePath) throw hold('source resource is not a regular immutable blob');
    const canonical = await git(['cat-file', 'blob', match[1]]);
    const projected = await fileBytes(root, row.targetPath);
    packageBytes += projected.length;
    if (packageBytes > packageByteLimit) throw hold('package resource bytes exceed the supported bound');
    if (hash(canonical) !== row.contentSha256 || !projected.equals(canonical)) throw hold(`resource bytes differ: ${sourcePath}`);
    if (sourcePath === 'manifests/primitive-release.json') {
      const selected = JSON.parse(canonical.toString('utf8'));
      if (!isDeepStrictEqual(selected, primitiveRelease)) throw hold('selected release manifest differs');
    }
  }
  const automationSnapshots = new Map();
  for (const entry of automation.templates) {
    const bytes = await fileBytes(root, entry.targetPath);
    packageBytes += bytes.length;
    if (packageBytes > packageByteLimit) throw hold('package resource bytes exceed the supported bound');
    automationSnapshots.set(entry.targetPath, bytes);
  }
  return { resources: resourcePaths.length, releaseManifestCommit: primitiveReleaseCommit,
    implementationCommit: primitiveRelease.sourceCommit, contentSha256: primitiveRelease.contentSha256, automationSnapshots };
}


export async function validateDistributionSkillResources(options) {
  try { return await validateResources(options); }
  catch (error) {
    if (error.message?.startsWith('Skill resource inventory: ')) throw error;
    throw hold('metadata or resource observation failed');
  }
}
