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
      const sourceEvent = JSON.parse(await readFile(sourcePath, 'utf8'));
      const sourceShape = repositoryDispatchEventShape(sourceEvent);
      await normalizeRepositoryDispatchEventFile(sourcePath, targetPath);
      const normalized = JSON.parse(await readFile(targetPath, 'utf8'));
      process.stdout.write(`Repository dispatch source event shape (values omitted): ${JSON.stringify(sourceShape)}\n`);
      process.stdout.write(`Repository dispatch normalized event shape (values omitted): ${JSON.stringify(repositoryDispatchEventShape(normalized))}\n`);
      process.stdout.write('Repository dispatch event is ready for the pinned controller reader.\n');
    } catch (error) {
      process.stderr.write(`${error.message}\n`);
      process.exitCode = 1;
    }
  }
}
