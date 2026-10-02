import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { createReadStream } from 'node:fs';
import { appendFile, lstat, mkdir, mkdtemp, readFile, readdir, readlink, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

// Reviewed official Linux package, including its sandbox and search helpers.
export const RELEASE = Object.freeze({
  version: '0.159.3',
  url: 'https://github.com/openai/codex/releases/download/rust-v0.159.3/codex-package-x86_64-unknown-linux-musl.tar.gz',
  sha256: '3930f31ac5fca861ea3e444e2683f261190d96b63fba58e0a40a879174369cdf',
  packageTreeSha256: '8af4c5622e5aafbf16901f09a6e1eb42bd6626d6e8db2e093e23cd50f5e66e1b',
});

export function verifyArchive(bytes, expected = RELEASE.sha256) {
  if (createHash('sha256').update(bytes).digest('hex') !== expected) throw new Error('Codex release checksum mismatch.');
}

async function fileSha256(filePath) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(filePath)) hash.update(chunk);
  return hash.digest('hex');
}

function addDigestField(hash, value) {
  const bytes = Buffer.from(value, 'utf8');
  const length = Buffer.alloc(8);
  length.writeBigUInt64BE(BigInt(bytes.length));
  hash.update(length);
  hash.update(bytes);
}

export async function packageTreeSha256(root) {
  const absoluteRoot = path.resolve(root);
  const entries = [];

  async function visit(relativeDirectory = '') {
    const directory = relativeDirectory
      ? path.join(absoluteRoot, ...relativeDirectory.split('/'))
      : absoluteRoot;
    const names = await readdir(directory);
    names.sort((left, right) => Buffer.compare(Buffer.from(left), Buffer.from(right)));
    for (const name of names) {
      const relativePath = relativeDirectory ? `${relativeDirectory}/${name}` : name;
      if (relativePath === '.release-sha256') continue;
      const entryPath = path.join(absoluteRoot, ...relativePath.split('/'));
      const stats = await lstat(entryPath);
      if (stats.isDirectory()) {
        entries.push({ type: 'directory', path: relativePath, mode: stats.mode & 0o7777 });
        await visit(relativePath);
      } else if (stats.isFile()) {
        entries.push({ type: 'file', path: relativePath, mode: stats.mode & 0o7777, sha256: await fileSha256(entryPath) });
      } else if (stats.isSymbolicLink()) {
        entries.push({ type: 'symlink', path: relativePath, mode: stats.mode & 0o7777, target: await readlink(entryPath) });
      } else {
        throw new Error(`Codex package contains an unsupported filesystem entry: ${relativePath}`);
      }
    }
  }

  await visit();
  entries.sort((left, right) => Buffer.compare(Buffer.from(left.path), Buffer.from(right.path)));
  const digest = createHash('sha256');
  for (const entry of entries) {
    addDigestField(digest, entry.type);
    addDigestField(digest, entry.path);
    addDigestField(digest, entry.mode.toString(8));
    if (entry.sha256) addDigestField(digest, entry.sha256);
    if (entry.target) addDigestField(digest, entry.target);
  }
  return digest.digest('hex');
}

export async function packageTreeSha256FromArchive(bytes) {
  const staging = await mkdtemp(path.join(tmpdir(), 'codex-package-digest-'));
  const archive = path.join(staging, 'release.tar.gz');
  const extracted = path.join(staging, 'package');
  try {
    await writeFile(archive, bytes, { mode: 0o600 });
    await mkdir(extracted);
    await promisify(execFile)('tar', ['-xzf', archive, '-C', extracted, '--no-same-owner'], { timeout: 120_000 });
    return await packageTreeSha256(extracted);
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}

export function setupTarget(cache, platform = process.platform, arch = process.arch) {
  if (platform !== 'linux' || arch !== 'x64') throw new Error('Codex runner setup requires Linux x64.');
  if (!cache || !path.posix.isAbsolute(cache)) throw new Error('RUNNER_TOOL_CACHE must be an absolute directory.');
  if (path.posix.parse(cache).root === path.posix.resolve(cache)) throw new Error('Use a dedicated runner tool cache.');
  return path.posix.join(cache, 'codex-delivery', RELEASE.version);
}

export async function setupCodex(env = process.env) {
  const target = setupTarget(env.RUNNER_TOOL_CACHE);
  let packageTreeVerified = false;
  let installed;
  try { installed = await readFile(path.join(target, '.release-sha256'), 'utf8'); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (installed !== RELEASE.sha256) {
    await mkdir(path.dirname(target), { recursive: true });
    const staging = await mkdtemp(path.join(path.dirname(target), 'download-'));
    const response = await fetch(RELEASE.url, { signal: AbortSignal.timeout(120_000) });
    if (!response.ok) throw new Error(`Codex download failed (${response.status}).`);
    const bytes = Buffer.from(await response.arrayBuffer());
    verifyArchive(bytes);
    const archive = path.join(staging, 'release.tar.gz');
    const extracted = path.join(staging, 'package');
    await writeFile(archive, bytes, { mode: 0o600 });
    await mkdir(extracted);
    await promisify(execFile)('tar', ['-xzf', archive, '-C', extracted, '--no-same-owner'], { timeout: 60_000 });
    if (await packageTreeSha256(extracted) !== RELEASE.packageTreeSha256) {
      throw new Error('Extracted Codex package contents do not match the pinned package digest.');
    }
    packageTreeVerified = true;
    await writeFile(path.join(extracted, '.release-sha256'), RELEASE.sha256);
    // Never overwrite an unknown existing installation. Failed downloads remain
    // in their exact staging directory for operator inspection.
    await rename(extracted, target);
  }
  if (!packageTreeVerified && await packageTreeSha256(target) !== RELEASE.packageTreeSha256) {
    throw new Error('Installed Codex package contents do not match the pinned package digest.');
  }
  const bin = path.join(target, 'bin');
  const { stdout } = await promisify(execFile)(path.join(bin, 'codex'), ['--version'], { timeout: 30_000 });
  if (stdout.trim() !== `codex-cli ${RELEASE.version}`) throw new Error('Installed Codex version does not match the release pin.');
  if (env.GITHUB_PATH) await appendFile(env.GITHUB_PATH, `${bin}\n`);
  console.log(`Codex ${RELEASE.version} ready at ${bin}; authentication is unchanged.`);
  return bin;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { await setupCodex(); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
