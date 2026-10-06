import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import {
  normalizeRepositoryDispatchEvent,
  normalizeRepositoryDispatchEventFile,
} from '../../scripts/normalize-repository-dispatch-event.mjs';
import {
  dispatchEnvelopeSignature,
  packRepositoryDispatchClientPayload,
  validateDispatchEnvelopeSignature,
} from '../../scripts/lib/agent-invocation.mjs';

test('dispatch normalizer restores the direct payload shape without changing its envelope', () => {
  const unsignedEnvelope = {
    version: 1,
    delivery_id: '12345678-1234-4234-8234-123456789012',
    repository_id: '1358455028',
    event: 'issue_comment',
    dispatch_timestamp: String(Date.now()),
  };
  const secret = 'dispatch-secret';
  const envelope = {
    ...unsignedEnvelope,
    dispatch_signature: dispatchEnvelopeSignature({ secret, envelope: unsignedEnvelope }),
  };
  const event = {
    repository: { full_name: 'agentic-delivery-lab/agentic-delivery', id: 1358455028 },
    client_payload: packRepositoryDispatchClientPayload(envelope),
  };

  assert.deepEqual(normalizeRepositoryDispatchEvent(event), {
    ...event,
    client_payload: envelope,
  });
  assert.equal(validateDispatchEnvelopeSignature({ secret, envelope, now: Number(envelope.dispatch_timestamp) }).valid, true);
});

test('dispatch normalizer preserves legacy direct events and rejects malformed wrappers', () => {
  const legacy = { client_payload: { version: 1, delivery_id: '12345678-1234-4234-8234-123456789012' } };
  assert.equal(normalizeRepositoryDispatchEvent(legacy), legacy);
  assert.throws(
    () => normalizeRepositoryDispatchEvent({ client_payload: { envelope: {}, extra: true } }),
    /wrapped repository dispatch envelope is malformed/,
  );
  assert.throws(
    () => normalizeRepositoryDispatchEvent({ client_payload: { envelope: null } }),
    /wrapped repository dispatch envelope is malformed/,
  );
});

test('dispatch normalizer writes a separate event file for pinned readers', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'agentic-delivery-dispatch-normalizer-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const sourcePath = path.join(root, 'source.json');
  const targetPath = path.join(root, 'normalized.json');
  const unsignedEnvelope = {
    version: 1,
    delivery_id: '12345678-1234-4234-8234-123456789012',
    repository_id: '1358455028',
    dispatch_timestamp: String(Date.now()),
  };
  const secret = 'dispatch-secret';
  const envelope = {
    ...unsignedEnvelope,
    dispatch_signature: dispatchEnvelopeSignature({ secret, envelope: unsignedEnvelope }),
  };
  const event = { client_payload: packRepositoryDispatchClientPayload(envelope) };
  await writeFile(sourcePath, JSON.stringify(event));

  assert.equal(await normalizeRepositoryDispatchEventFile(sourcePath, targetPath), targetPath);
  assert.deepEqual(JSON.parse(await readFile(sourcePath, 'utf8')), event);
  const normalized = JSON.parse(await readFile(targetPath, 'utf8'));
  assert.deepEqual(normalized, { client_payload: envelope });
  assert.equal(validateDispatchEnvelopeSignature({ secret, envelope: normalized.client_payload, now: Number(envelope.dispatch_timestamp) }).valid, true);
  await assert.rejects(normalizeRepositoryDispatchEventFile(sourcePath, targetPath), /EEXIST/);
});
