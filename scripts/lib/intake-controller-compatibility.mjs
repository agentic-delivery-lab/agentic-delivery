// agentic-primitive: {"id":"legacy-intake-read-only-compatibility","kind":"validator","enforcement":"deterministic","adrs":["ADR-0018"],"domains":["agentic-delivery-control-plane"]}
import { appendFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export function legacyIntakeControllerMode(readOnlyRun) {
  if (readOnlyRun !== 'true' && readOnlyRun !== 'false') {
    throw new Error('READ_ONLY_RUN must be true or false.');
  }
  return readOnlyRun === 'true' ? 'shadow' : 'active';
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const mode = legacyIntakeControllerMode(process.env.READ_ONLY_RUN);
    if (!process.env.GITHUB_OUTPUT) throw new Error('GITHUB_OUTPUT is required for intake compatibility.');
    await appendFile(process.env.GITHUB_OUTPUT, `control_plane_mode=${mode}\n`);
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}
