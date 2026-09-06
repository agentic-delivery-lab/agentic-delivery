import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { runToolchainPreflight } from './lib/toolchain.mjs';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, '..');

if (process.argv.length > 3) {
  process.stderr.write('Usage: validate-toolchain.mjs [repository root]\n');
  process.exitCode = 2;
} else {
  const requestedRoot = process.argv[2] ? path.resolve(process.argv[2]) : repositoryRoot;
  try {
    const result = await runToolchainPreflight({ repositoryRoot: requestedRoot });
    process.stdout.write(`Toolchain check passed: pnpm ${result.pnpmVersion}.\n`);
  } catch (error) {
    process.stderr.write(`Toolchain check: ${error.message}\n`);
    process.exitCode = 2;
  }
}
