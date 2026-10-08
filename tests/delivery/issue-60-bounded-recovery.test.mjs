import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { parse } from 'yaml';
import { boundedFetch, inspectRecovery, prepareOneReplay, validateCanaryDelivery, validateRecoveryContext } from '../../scripts/recover-issue-60-reconciliation.mjs';

const guid = '12345678-1234-4234-8234-123456789012';
const id = '3847041198202052608';
const env = { GITHUB_REF: 'refs/heads/main', GITHUB_REPOSITORY_ID: '1358455028', CODEX_DELIVERY_APP_INSTALLATION_ID: '163255060',
  GITHUB_RUN_ID: '123', GITHUB_SHA: 'a'.repeat(40), GITHUB_ACTOR: 'operator', GITHUB_REPOSITORY: 'agentic-delivery-lab/agentic-delivery', CODEX_DELIVERY_APP_ID: '123456' };
const participant = { expectedFullName: env.GITHUB_REPOSITORY, mode: 'shadow', events: ['issue_comment'] };
const registry = { valid: true, participants: new Map([['1358455028', participant], ['2', { ...participant, expectedFullName: 'agentic-delivery-lab/.github' }]]) };
const delivery = { guid, id, installation_id: '163255060', event: 'issue_comment', request: { payload: { issue: { number: 62 }, repository: { id: '1358455028', full_name: env.GITHUB_REPOSITORY } } } };
const validate = (value, selectedRegistry = registry) => validateCanaryDelivery(value, { guid, deliveryId: id, registry: selectedRegistry, centralRepositoryId: env.GITHUB_REPOSITORY_ID });

test('recovery identity requires main, native central repository ID and correct installation', () => {
  for (const mode of ['inspect', 'scan', 'replay_one']) validateRecoveryContext(env, mode);
  for (const change of [{ GITHUB_REF: 'refs/heads/feature' }, { GITHUB_REPOSITORY_ID: '2' }, { CODEX_DELIVERY_APP_INSTALLATION_ID: '2' }]) {
    assert.throws(() => validateRecoveryContext({ ...env, ...change }, 'scan'));
  }
  assert.throws(() => validateRecoveryContext(env, 'apply'));
});

test('fresh delivery identity only admits the exact enrolled recovery canaries', () => {
  validate(delivery);
  validate({ ...delivery, request: { payload: { issue: { number: 11 }, repository: { id: '2', full_name: 'agentic-delivery-lab/.github' } } } });
  for (const change of [{ guid: 'wrong' }, { id: '3847041198202052609' }, { installation_id: '2' }, { event: 'issues' }, { event: 'pull_request' },
    { request: { payload: { pull_request: { number: 62 }, repository: delivery.request.payload.repository } } },
    { request: { payload: { ...delivery.request.payload, issue: { number: 62, pull_request: {} } } } },
    { request: { payload: { ...delivery.request.payload, issue: { number: 60 } } } },
    { request: { payload: { ...delivery.request.payload, repository: { id: '1358455028', full_name: 'another/repo' } } } }]) {
    assert.throws(() => validate({ ...delivery, ...change }));
  }
  assert.throws(() => validate(delivery, { ...registry, valid: false }));
  assert.throws(() => validate(delivery, { ...registry, participants: new Map([['1358455028', { ...participant, mode: 'disabled' }]]) }));
});

test('bounded fetch prohibits scan POSTs, foreign endpoints, wrong targets and a second replay', async () => {
  const calls = [];
  const fetchImpl = async (...args) => { calls.push(args); return { ok: true }; };
  const scan = boundedFetch({ fetchImpl });
  await scan('https://api.github.com/app/hook/deliveries?per_page=100');
  await assert.rejects(scan(`https://api.github.com/app/hook/deliveries/${id}/attempts`, { method: 'POST' }));
  const replay = boundedFetch({ fetchImpl, targetId: id });
  for (const url of ['https://example.com/app/hook/deliveries', 'https://api.github.com/repos/a/b/issues', 'https://user@api.github.com/app/hook/deliveries']) await assert.rejects(replay(url));
  await assert.rejects(replay('https://api.github.com/app/hook/deliveries/1/attempts', { method: 'POST' }));
  await replay(`https://api.github.com/app/hook/deliveries/${id}/attempts`, { method: 'POST' });
  await assert.rejects(replay(`https://api.github.com/app/hook/deliveries/${id}/attempts`, { method: 'POST' }));
  assert.equal(calls.length, 2);
});

function recordingSql(results) {
  const calls = [];
  const sql = (strings, ...values) => { const query = { statement: strings.join('?'), values }; calls.push(query); return Promise.resolve(results ?? [{ id }]); };
  sql.query = (statement, values) => { const query = { statement, values }; calls.push(query); return query; };
  sql.transaction = async (queries, options) => { calls.push({ queries, options }); return [[], [], [], [{ delivery_guid: guid }]]; };
  return { sql, calls };
}

test('one replay preparation preserves exact 64-bit IDs and snapshots before a serializable targeted requeue', async () => {
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048, privateKeyEncoding: { type: 'pkcs8', format: 'pem' }, publicKeyEncoding: { type: 'spki', format: 'pem' } });
  const { sql, calls } = recordingSql();
  const raw = JSON.stringify(delivery).replace(`"id":"${id}"`, `"id":${id}`);
  const chosen = await prepareOneReplay(sql, { ...env, CODEX_DELIVERY_APP_PRIVATE_KEY: privateKey }, guid,
    async (url, options) => { assert.equal(url, `https://api.github.com/app/hook/deliveries/${id}`); assert.notEqual(options.method, 'POST'); return { ok: true, text: async () => raw }; }, async () => registry);
  assert.equal(chosen, id);
  const operation = calls.find((call) => call.statement?.startsWith('WITH candidates'));
  assert.deepEqual(operation.values.slice(0, 4), [`163255060:${guid}`, guid, id, '123']);
  assert.equal(JSON.parse(operation.values[4]).repository_id, '1358455028');
  assert.match(operation.statement, /FOR UPDATE OF q, c/);
  assert.match(operation.statement, /queue_before, receipt_before/);
  assert.equal(calls.at(-1).options.isolationLevel, 'Serializable');
});

test('ineligible or unavailable receipt preparation cannot create audit or reset counters', async () => {
  const { sql, calls } = recordingSql([]);
  await assert.rejects(prepareOneReplay(sql, env, guid, async () => assert.fail('No API expected.')));
  assert.equal(calls.length, 1);
  assert.doesNotMatch(calls[0].statement, /UPDATE|INSERT/);
});

test('independent recovery inspection uses a read-only repeatable snapshot and reports archive guard', async () => {
  const { sql, calls } = recordingSql();
  sql.transaction = async (queries, options) => { assert.equal(options.readOnly, true); assert.equal(options.isolationLevel, 'RepeatableRead'); return [[{ count: '161' }], [], [], [], [{ archive_guard_enabled: true }]]; };
  const inspected = await inspectRecovery(sql);
  assert.equal(inspected.archived, '161');
  assert.equal(inspected.archive_guard_enabled, true);
  assert.equal(calls.length, 5);
  assert.ok(calls.every((call) => call.statement.startsWith('SELECT')));
});

test('all secret-bearing follow-up modes are main-only, mutually exclusive and serialized with archive', async () => {
  const workflow = parse(await readFile(new URL('../../.github/workflows/self-hosted-runner-smoke.yml', import.meta.url), 'utf8'));
  const job = workflow.jobs['reconciliation-followup'];
  assert.match(job.if, /github.ref == 'refs\/heads\/main'/);
  assert.match(job.if, /inputs.reconciliation_recovery == 'disabled'/);
  assert.equal(job.concurrency.group, workflow.jobs['reconciliation-recovery'].concurrency.group);
  assert.equal(workflow.on.workflow_dispatch.inputs.reconciliation_followup.default, 'disabled');
  assert.equal(job.steps.filter((step) => step.env?.CODEX_DELIVERY_APP_PRIVATE_KEY).length, 1);
  assert.ok(job.steps.every((step) => !String(step.run).includes('codex-preflight')));
});
