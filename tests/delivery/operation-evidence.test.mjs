import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { parseEvidenceMarker, validateEvidenceRecord } from '../../scripts/lib/architecture-review.mjs';

const schema = JSON.parse(await readFile(new URL('../../docs/architecture/delivery-evidence.schema.json', import.meta.url), 'utf8'));
const ajv = new Ajv2020({ strict: false });
addFormats(ajv);
const validate = ajv.compile(schema);
const evidence = () => ({
  schemaVersion: 2, producer: 'codex-delivery', repository: 'fixture/repo',
  sourceIssue: { number: 7, url: 'https://github.com/fixture/repo/issues/7' },
  deliveryRun: { id: '123', attempt: '1', url: 'https://github.com/fixture/repo/actions/runs/123' },
  revision: { branch: 'feat/issue-7-example', commit: 'a'.repeat(40), tree: 'b'.repeat(40) },
  codexSession: { id: '019fb023-24b8-7881-9119-509f078b610e' }, modelTurns: [],
  architectureContext: { officialAdrs: [], provisionalAdrs: [], affectedAdrs: [], boundedContexts: [] },
  validation: { status: 'passed', summary: 'Candidate passed.' },
  auditCheckpoint: { stateVersion: 5, entryCount: 2, sha256: 'c'.repeat(64) },
  operation: {
    id: '12345678-1234-4234-8234-123456789012', repositoryId: '101',
    budgetPolicy: { id: 'factory-initial-operation-budget', version: '1.0.0-proposed.1', sha256: 'd'.repeat(64), status: 'proposed' },
    consumption: { controllerAttempts: 1, modelTurns: 2, validationAttempts: 1, toolInvocations: null },
    activeTime: { version: 1, limitMs: 1800000, spentMs: 25, reservation: { owner: '123:1', startedAtMs: 100 } },
    phase: 'publication-checkpoint', capturedAt: '2026-10-14T10:00:00.000Z',
  },
});

test('version 2 carries operation provenance without claiming unknown tool use is zero', () => {
  const value = evidence();
  assert.equal(validate(value), true, JSON.stringify(validate.errors));
  assert.equal(validateEvidenceRecord(value).valid, true);
  assert.equal(parseEvidenceMarker(`<!-- codex-delivery-evidence:v2\n${JSON.stringify(value)}\n-->`).operation.id, value.operation.id);
});

test('missing or malformed operation evidence and a version downgrade fail both consumers', () => {
  for (const mutate of [
    (v) => delete v.operation,
    (v) => { v.operation.id = 'not-an-operation'; },
    (v) => { v.operation.consumption.validationAttempts = -1; },
    (v) => { v.operation.consumption.toolInvocations = 0; },
    (v) => { v.operation.budgetPolicy.status = 'approved'; },
    (v) => { v.schemaVersion = 1; delete v.operation; },
  ]) {
    const value = evidence(); mutate(value);
    assert.equal(validate(value), false);
    assert.equal(validateEvidenceRecord(value).valid, false);
  }
});

test('historical version 1 remains readable, but marker and payload versions must agree', () => {
  const value = evidence(); value.schemaVersion = 1; value.auditCheckpoint.stateVersion = 4; delete value.operation;
  assert.equal(validate(value), true);
  assert.equal(validateEvidenceRecord(value).valid, true);
  assert.match(parseEvidenceMarker(`<!-- codex-delivery-evidence:v1\n${JSON.stringify(evidence())}\n-->`).__error, /version/);
});


test('unsupported, malformed or duplicated evidence cannot disappear into a human-created PR classification', () => {
  assert.match(parseEvidenceMarker('<!-- codex-delivery-evidence:v3\n{}\n-->').__error, /unsupported/);
  assert.match(parseEvidenceMarker('<!-- codex-delivery-evidence:v2').__error, /malformed/);
  const marker = `<!-- codex-delivery-evidence:v2\n${JSON.stringify(evidence())}\n-->`;
  assert.match(parseEvidenceMarker(`${marker}\n${marker}`).__error, /Multiple/);
});


test('operation evidence is correlated to native origin and current reservation owner', () => {
  const value = evidence();
  assert.equal(validateEvidenceRecord(value, { repositoryId: 101 }).valid, true);
  assert.match(validateEvidenceRecord(value, { repositoryId: 102 }).errors.join(' '), /repository ID/);
  value.operation.activeTime.reservation.owner = '123:2';
  assert.match(validateEvidenceRecord(value).errors.join(' '), /owner/);
});
