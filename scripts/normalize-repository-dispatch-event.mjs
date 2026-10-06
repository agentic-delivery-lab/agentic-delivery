// agentic-primitive: {"id":"repository-dispatch-event-normalizer","kind":"validator","enforcement":"deterministic","adrs":["ADR-0018"],"domains":["agentic-delivery-control-plane"]}
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function valueType(value) {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}

const EVENT_KEYS = new Set(['action', 'client_payload', 'enterprise', 'installation', 'organization', 'repository', 'sender']);
const CLIENT_PAYLOAD_KEYS = new Set([
  'envelope',
  'actor',
  'action',
  'body_digest',
  'client_payload',
  'controller',
  'delivery_id',
  'dispatch_signature',
  'dispatch_timestamp',
  'event',
  'hop',
  'installation_id',
  'organization_id',
  'parent_delivery_id',
  'payload',
  'received_at',
  'repository_full_name',
  'repository_id',
  'source',
  'version',
]);

function knownShape(record, allowedKeys) {
  const entries = Object.entries(record).filter(([key]) => allowedKeys.has(key));
  return {
    keys: entries.map(([key]) => key).sort(),
    unknown_key_count: Object.keys(record).length - entries.length,
    value_types: Object.fromEntries(entries.sort(([left], [right]) => left.localeCompare(right)).map(([key, value]) => [key, valueType(value)])),
  };
}

export function repositoryDispatchEventShape(event) {
  const eventRecord = isRecord(event) ? event : {};
  const clientPayloadPresent = Object.hasOwn(eventRecord, 'client_payload');
  const clientPayload = eventRecord.client_payload;
  const payloadRecord = isRecord(clientPayload) ? clientPayload : {};
  const outerShape = knownShape(eventRecord, EVENT_KEYS);
  const payloadShape = knownShape(payloadRecord, CLIENT_PAYLOAD_KEYS);
  const wrappedEnvelope = payloadRecord.envelope;
  const wrappedEnvelopeRecord = isRecord(wrappedEnvelope) ? wrappedEnvelope : {};
  const envelopeShape = knownShape(wrappedEnvelopeRecord, CLIENT_PAYLOAD_KEYS);
  const nestedClientPayload = payloadRecord.client_payload;
  const nestedPayloadRecord = isRecord(nestedClientPayload) ? nestedClientPayload : {};
  const nestedPayloadShape = knownShape(nestedPayloadRecord, CLIENT_PAYLOAD_KEYS);
  const nestedEnvelope = nestedPayloadRecord.envelope;
  const nestedEnvelopeRecord = isRecord(nestedEnvelope) ? nestedEnvelope : {};
  const nestedEnvelopeShape = knownShape(nestedEnvelopeRecord, CLIENT_PAYLOAD_KEYS);
  return {
    event_keys: outerShape.keys,
    event_unknown_key_count: outerShape.unknown_key_count,
    client_payload_type: clientPayloadPresent ? valueType(clientPayload) : 'missing',
    client_payload_keys: payloadShape.keys,
    client_payload_unknown_key_count: payloadShape.unknown_key_count,
    client_payload_value_types: payloadShape.value_types,
    wrapped_envelope_type: Object.hasOwn(payloadRecord, 'envelope') ? valueType(wrappedEnvelope) : 'missing',
    wrapped_envelope_keys: envelopeShape.keys,
    wrapped_envelope_unknown_key_count: envelopeShape.unknown_key_count,
    wrapped_envelope_value_types: envelopeShape.value_types,
    nested_client_payload_type: Object.hasOwn(payloadRecord, 'client_payload') ? valueType(nestedClientPayload) : 'missing',
    nested_client_payload_keys: nestedPayloadShape.keys,
    nested_client_payload_unknown_key_count: nestedPayloadShape.unknown_key_count,
    nested_client_payload_value_types: nestedPayloadShape.value_types,
    nested_envelope_type: Object.hasOwn(nestedPayloadRecord, 'envelope') ? valueType(nestedEnvelope) : 'missing',
    nested_envelope_keys: nestedEnvelopeShape.keys,
    nested_envelope_unknown_key_count: nestedEnvelopeShape.unknown_key_count,
    nested_envelope_value_types: nestedEnvelopeShape.value_types,
  };
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

async function readRepositoryDispatchEventFile(sourcePath) {
  let source;
  try {
    source = await readFile(sourcePath, 'utf8');
  } catch {
    throw new Error('The repository dispatch source event file could not be read.');
  }
  try {
    return JSON.parse(source);
  } catch {
    throw new Error('The repository dispatch source event is not valid JSON.');
  }
}

async function writeNormalizedRepositoryDispatchEventFile(targetPath, event) {
  try {
    await writeFile(targetPath, JSON.stringify(event), { flag: 'wx' });
  } catch {
    throw new Error('The normalized repository dispatch event file could not be written.');
  }
}

export async function normalizeRepositoryDispatchEventFile(sourcePath, targetPath) {
  if (!sourcePath || !targetPath) throw new Error('Source and target event paths are required.');
  const event = await readRepositoryDispatchEventFile(sourcePath);
  const normalized = normalizeRepositoryDispatchEvent(event);
  await writeNormalizedRepositoryDispatchEventFile(targetPath, normalized);
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
      const sourceEvent = await readRepositoryDispatchEventFile(sourcePath);
      const sourceShape = repositoryDispatchEventShape(sourceEvent);
      process.stdout.write(`Repository dispatch source event shape (values omitted): ${JSON.stringify(sourceShape)}\n`);
      const normalized = normalizeRepositoryDispatchEvent(sourceEvent);
      await writeNormalizedRepositoryDispatchEventFile(targetPath, normalized);
      process.stdout.write(`Repository dispatch normalized event shape (values omitted): ${JSON.stringify(repositoryDispatchEventShape(normalized))}\n`);
      process.stdout.write('Repository dispatch event is ready for the pinned controller reader.\n');
    } catch (error) {
      const safeMessages = new Set([
        'The repository dispatch source event file could not be read.',
        'The repository dispatch source event is not valid JSON.',
        'Source and target event paths are required.',
        'A repository dispatch event object is required.',
        'A repository dispatch client payload is required.',
        'The wrapped repository dispatch envelope is malformed.',
        'The normalized repository dispatch event file could not be written.',
      ]);
      const message = error instanceof Error && safeMessages.has(error.message)
        ? error.message
        : 'Repository dispatch event normalization failed.';
      process.stderr.write(`${message}\n`);
      process.exitCode = 1;
    }
  }
}
