import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { validateManifest, verifyAbsentHistory, recover } from '../../scripts/archive-issue-60-deliveries.mjs';
import { NeonReplayStore } from '../../scripts/lib/neon-replay-store.mjs';

const candidates = [{ delivery_guid: '12345678-1234-4234-8234-123456789012' }];
const response = (items = [], next = null) => ({ ok: true, json: async () => items,
  headers: { get: () => next ? `<${next}>; rel="next"` : '' } });

test('recovery rejects altered or unapproved manifests without printing their contents', () => {
  for (const text of [undefined, '', '[]', 'private operator input']) {
    assert.throws(() => validateManifest(text), /does not match the approved evidence/);
  }
});

test('history audit scans every page and refuses any available archive candidate', async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    return calls.length === 1 ? response([{ guid: 'another-guid' }], 'https://api.github.com/app/hook/deliveries?cursor=next') : response();
  };
  assert.equal((await verifyAbsentHistory(candidates, 'protected-jwt', fetchImpl)).pages, 2);
  assert.equal(calls[1].url, 'https://api.github.com/app/hook/deliveries?cursor=next');
  assert.equal(calls[0].options.headers.Authorization, 'Bearer protected-jwt');
  await assert.rejects(verifyAbsentHistory(candidates, 'protected-jwt', async () => response([{ guid: candidates[0].delivery_guid }])), /available in fresh history/);
});

test('history audit rejects untrusted pagination before forwarding the App credential', async () => {
  for (const next of ['https://attacker.test/app/hook/deliveries',
    'https://api.github.com/repos/another/repository',
    'https://user:password@api.github.com/app/hook/deliveries']) {
    let calls = 0;
    await assert.rejects(verifyAbsentHistory(candidates, 'protected-jwt', async () => {
      calls += 1; return response([], next);
    }), /pagination is invalid/);
    assert.equal(calls, 1);
  }
});

test('history audit fails closed at the bounded page limit and on invalid API results', async () => {
  let calls = 0;
  await assert.rejects(verifyAbsentHistory(candidates, 'protected-jwt', async () => {
    calls += 1; return response([], 'https://api.github.com/app/hook/deliveries?cursor=more');
  }), /incomplete/);
  assert.equal(calls, 20);
  await assert.rejects(verifyAbsentHistory(candidates, 'protected-jwt', async () => ({ ok: false })), /request failed/);
  await assert.rejects(verifyAbsentHistory(candidates, 'protected-jwt', async () => response({})), /history is invalid/);
});

test('recovery is disabled unless an explicit mode and approved manifest are supplied', async () => {
  let calls = 0;
  const sql = { transaction: async () => { calls += 1; } };
  await assert.rejects(recover({ env: {}, sql }), /Select preview or apply explicitly/);
  await assert.rejects(recover({ env: { RECOVERY_MODE: 'apply', RECOVERY_MANIFEST: '[]' }, sql }), /approved evidence/);
  assert.equal(calls, 0);
});

test('archived records are excluded from direct claims, automatic requeue, due selection and checkpoint holds', async () => {
  const calls = [];
  const store = new NeonReplayStore({ client: { query: async (statement, values) => {
    calls.push({ statement, values });
    return statement.startsWith('SELECT request_status') ? [{ request_status: 'archived' }] : [];
  } } });
  assert.deepEqual(await store.claimRedeliveryRequest(candidates[0].delivery_guid, '3847041198202052608'), { claimed: false, status: 'archived' });
  assert.match(calls[0].statement, /stored.request_status IN \('queued', 'requesting', 'accepted'\)/);
  calls.length = 0;
  await store.queueRedeliveryRequests([{ guid: candidates[0].delivery_guid, githubDeliveryId: '3847041198202052608' }]);
  assert.match(calls[0].statement, /WHERE stored.request_status = 'queued'\s+OR \(stored.request_status = 'exhausted'/);
  calls.length = 0;
  await store.dueRedeliveryRequests();
  assert.doesNotMatch(calls[0].statement, /archived/);
  calls.length = 0;
  assert.equal(await store.hasPendingRedeliveryRequests(), false);
  assert.doesNotMatch(calls[0].statement, /archived/);
});

test('recovery workflow keeps protected credentials step-scoped and defaults to disabled', async () => {
  const workflow = await readFile(new URL('../../.github/workflows/self-hosted-runner-smoke.yml', import.meta.url), 'utf8');
  assert.match(workflow, /options: \[disabled, preview, apply\]\s+default: disabled/);
  assert.match(workflow, /permissions:\s+contents: read/);
  assert.match(workflow, /persist-credentials: false/);
  assert.match(workflow, /frozen-lockfile --ignore-scripts/);
  assert.match(workflow, /inputs.reconciliation_recovery != 'disabled' && github.ref == 'refs\/heads\/main'/);
  assert.doesNotMatch(workflow, /secrets: inherit|\$\{\{ inputs.recovery_manifest \}\}.*\n.*run:/);
});

test('approved operator fixture previews without writes and applies one serializable transaction with exact timestamp evidence', {
  skip: !process.env.RECOVERY_MANIFEST_FIXTURE_PATH && 'The exact approved manifest is private operator input; SQL behavior is tested separately in CI.',
}, async () => {
  const text = await readFile(process.env.RECOVERY_MANIFEST_FIXTURE_PATH, 'utf8');
  assert.equal(validateManifest(text).length, 161);
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const env = { RECOVERY_MANIFEST: text, GITHUB_REPOSITORY: 'agentic-delivery-lab/agentic-delivery',
    GITHUB_REF: 'refs/heads/main', GITHUB_SHA: 'a'.repeat(40), GITHUB_RUN_ID: '123', GITHUB_ACTOR: 'operator',
    CODEX_DELIVERY_APP_INSTALLATION_ID: '163255060', CODEX_DELIVERY_APP_ID: '5011055',
    CODEX_DELIVERY_APP_PRIVATE_KEY: privateKey.export({ type: 'pkcs8', format: 'pem' }) };
  const timestamp = '2026-10-06 04:39:05.528123+00';
  for (const mode of ['preview', 'apply']) {
    const transactions = [];
    const sql = (strings, ...values) => ({ statement: strings.join('?'), values });
    sql.query = (statement, values) => ({ statement, values });
    sql.transaction = async (queries, options) => {
      transactions.push({ queries, options });
      return options.readOnly ? [[{ updated_at: timestamp }], [{ request_status: 'exhausted', count: '161' }]]
        : [[], [], [], [], [{ archived: 161 }], [{ archived: '161' }]];
    };
    const result = await recover({ env: { ...env, RECOVERY_MODE: mode }, sql, fetchImpl: async () => response() });
    assert.equal(result.mode, mode);
    assert.equal(transactions[0].options.readOnly, true);
    assert.equal(transactions.length, mode === 'preview' ? 1 : 2);
    if (mode === 'apply') {
      assert.equal(transactions[1].options.isolationLevel, 'Serializable');
      assert.equal(transactions[1].queries[4].values[2], timestamp);
      const audit = JSON.parse(transactions[1].queries[4].values[1]);
      assert.equal(audit.operator, 'operator');
      assert.equal(audit.run_id, '123');
      assert.doesNotMatch(JSON.stringify(transactions), /BEGIN PRIVATE KEY|protected-jwt/);
    }
  }
  await assert.rejects(recover({ env: { ...env, RECOVERY_MODE: 'preview', GITHUB_REF: 'refs/heads/unreviewed' } }), /reviewed implementation on main/);
});
