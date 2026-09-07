import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { appendFile, mkdir, mkdtemp, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

// Reviewed official Linux package, including its sandbox and search helpers.
export const RELEASE = Object.freeze({
  version: '0.153.4',
  url: 'https://github.com/openai/codex/releases/download/rust-v0.153.4/codex-package-x86_64-unknown-linux-musl.tar.gz',
  sha256: 'a822187e1a2420c61c5926721bfbd878701ed95547c9bb0d4de4498a16ba1821',
});

export function verifyArchive(bytes, expected = RELEASE.sha256) {
  if (createHash('sha256').update(bytes).digest('hex') !== expected) throw new Error('Codex release checksum mismatch.');
}

export function setupTarget(cache, platform = process.platform, arch = process.arch) {
  if (platform !== 'linux' || arch !== 'x64') throw new Error('Codex runner setup requires Linux x64.');
  if (!cache || !path.isAbsolute(cache)) throw new Error('RUNNER_TOOL_CACHE must be an absolute directory.');
  if (path.parse(cache).root === path.resolve(cache)) throw new Error('Use a dedicated runner tool cache.');
  return path.join(cache, 'codex-delivery', RELEASE.version);
}

export async function setupCodex(env = process.env) {
  const target = setupTarget(env.RUNNER_TOOL_CACHE);
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
    await writeFile(path.join(extracted, '.release-sha256'), RELEASE.sha256);
    // Never overwrite an unknown existing installation. Failed downloads remain
    // in their exact staging directory for operator inspection.
    await rename(extracted, target);
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
