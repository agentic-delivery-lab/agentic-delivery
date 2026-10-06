// agentic-primitive: {"id":"repository-dispatch-event-normalizer","kind":"validator","enforcement":"deterministic","adrs":["ADR-0018"],"domains":["agentic-delivery-control-plane"]}
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Restore the version-1 client-payload shape for pinned controller readers.
 * The signed envelope itself is copied without changing any of its fields.
 */
export function normalizeRepositoryDispatchEvent(event) {
  if (!isRecord(event)) throw new Error('A repository dispatch event object is required.');
  const clientPayload = event.client_payload;
  if (!isRecord(clientPayload)) throw new Error('A repository dispatch client payload is required.');
  if (!Object.hasOwn(clientPayload, 'envelope')) return event;
  if (Object.keys(clientPayload).length !== 1 || !isRecord(clientPayload.envelope)) {
    throw new Error('The wrapped repository dispatch envelope is malformed.');
  }
  return { ...event, client_payload: clientPayload.envelope };
}

export async function normalizeRepositoryDispatchEventFile(sourcePath, targetPath) {
  if (!sourcePath || !targetPath) throw new Error('Source and target event paths are required.');
  const event = JSON.parse(await readFile(sourcePath, 'utf8'));
  const normalized = normalizeRepositoryDispatchEvent(event);
  await writeFile(targetPath, JSON.stringify(normalized), { flag: 'wx' });
  return targetPath;
}

const isMainModule = process.argv[1]
  && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMainModule) {
  const [sourcePath, targetPath, ...extra] = process.argv.slice(2);
  if (!sourcePath || !targetPath || extra.length > 0) {
    process.stderr.write(`Usage: ${path.basename(process.argv[1])} <source event path> <target event path>\n`);
    process.exitCode = 2;
  } else {
    try {
      await normalizeRepositoryDispatchEventFile(sourcePath, targetPath);
      process.stdout.write('Repository dispatch event is ready for the pinned controller reader.\n');
    } catch (error) {
      process.stderr.write(`${error.message}\n`);
      process.exitCode = 1;
    }
  }
}
