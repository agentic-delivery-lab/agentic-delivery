import assert from 'node:assert/strict';
import { access, chmod, cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { PNPM_COMMAND } from '../../scripts/lib/toolchain.mjs';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const packageJson = JSON.parse(await readFile(path.join(repositoryRoot, 'package.json'), 'utf8'));

test('supported public commands run the dependency-free toolchain preflight first', () => {
  for (const command of ['test', 'branch:start', 'lint:branch', 'lint:commits']) {
    assert.equal(
      packageJson.scripts[`pre${command}`],
      'node scripts/validate-toolchain.mjs',
      `${command} must run the shared preflight through its lifecycle hook`,
    );
  }
});

test('public command definitions do not use shell chaining for preflight wiring', () => {
  for (const command of ['pretest', 'prebranch:start', 'prelint:branch', 'prelint:commits']) {
    assert.doesNotMatch(packageJson.scripts[command], /&&|\||>|<|node_modules[\\/].*\.bin/);
  }
});

async function findExecutable(command) {
  const candidates = process.platform === 'win32'
    ? [command, ...(process.env.PATHEXT ?? '.COM;.EXE;.BAT;.CMD').split(';').map((extension) => `${command}${extension}`)]
    : [command];
  for (const directory of process.env.PATH.split(path.delimiter)) {
    for (const candidateName of candidates) {
      const candidate = path.join(directory, candidateName);
      try {
        await access(candidate, constants.X_OK);
        return candidate;
      } catch {
        // Continue searching the platform PATH.
      }
    }
  }
  return null;
}

function runPackageScript(repositoryRoot, executable, environment) {
  return new Promise((resolve) => {
    const child = spawn(executable, ['run', 'probe'], {
      cwd: repositoryRoot,
      env: environment,
      windowsHide: true,
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', (error) => resolve({ status: null, stdout, stderr, error }));
    child.on('close', (status) => resolve({ status, stdout, stderr }));
  });
}

test('lifecycle preflight stops a mismatched pnpm before the command body', async (t) => {
  const realPnpm = await findExecutable(PNPM_COMMAND);
  assert.ok(realPnpm, `expected ${PNPM_COMMAND} on PATH`);

  const repositoryRoot = await mkdtemp(path.join(os.tmpdir(), 'agentic-delivery-wiring-'));
  const fakeBin = await mkdtemp(path.join(os.tmpdir(), 'agentic-delivery-fake-pnpm-'));
  t.after(async () => {
    await rm(repositoryRoot, { recursive: true, force: true });
    await rm(fakeBin, { recursive: true, force: true });
  });

  await mkdir(path.join(repositoryRoot, 'scripts', 'lib'), { recursive: true });
  await mkdir(path.join(repositoryRoot, 'scripts'), { recursive: true });
  await cp(path.join(repositoryRootFromTests(), 'scripts', 'validate-toolchain.mjs'), path.join(repositoryRoot, 'scripts', 'validate-toolchain.mjs'));
  await cp(path.join(repositoryRootFromTests(), 'scripts', 'lib', 'toolchain.mjs'), path.join(repositoryRoot, 'scripts', 'lib', 'toolchain.mjs'));
  await writeFile(path.join(repositoryRoot, 'scripts', 'probe.mjs'), "await import('node:fs/promises').then(({ writeFile }) => writeFile('probe-ran', 'yes'));\n");
  await writeFile(path.join(repositoryRoot, 'package.json'), JSON.stringify({
    name: 'wiring-fixture',
    private: true,
    packageManager: 'pnpm@12.3.4',
    scripts: {
      preprobe: 'node scripts/validate-toolchain.mjs',
      probe: 'node scripts/probe.mjs',
    },
  }));
  await writeFile(path.join(repositoryRoot, 'pnpm-workspace.yaml'), [
    'minimumReleaseAge: 2880',
    'minimumReleaseAgeStrict: true',
    'minimumReleaseAgeIgnoreMissingTime: false',
  ].join('\n'));
  await writeFile(path.join(repositoryRoot, 'pnpm-lock.yaml'), 'lockfileVersion: 9.0\n');

  const fakeExecutableName = process.platform === 'win32' ? `${PNPM_COMMAND}.cmd` : PNPM_COMMAND;
  const fakePnpm = path.join(fakeBin, fakeExecutableName);
  if (process.platform === 'win32') {
    await writeFile(fakePnpm, '@echo off\r\necho 11.25.0\r\n');
  } else {
    await writeFile(fakePnpm, '#!/bin/sh\nprintf \'11.25.0\\n\'\n');
    await chmod(fakePnpm, 0o755);
  }

  const environment = {
    ...process.env,
    PATH: `${fakeBin}${path.delimiter}${process.env.PATH}`,
  };
  const result = await runPackageScript(repositoryRoot, realPnpm, environment);

  assert.equal(result.status, 2, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stderr, /pnpm version mismatch: expected 12\.3\.4, found 11\.25\.0/);
  await assert.rejects(access(path.join(repositoryRoot, 'probe-ran')));

  const validResult = await runPackageScript(repositoryRoot, realPnpm, process.env);
  assert.equal(validResult.status, 0, `${validResult.stdout}\n${validResult.stderr}`);
  await access(path.join(repositoryRoot, 'probe-ran'));
});

function repositoryRootFromTests() {
  return repositoryRoot;
}
