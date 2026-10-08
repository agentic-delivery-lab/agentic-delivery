import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { parseRepositoryYaml } from '../../scripts/lib/yaml.mjs';

const workflow = parseRepositoryYaml(await readFile(new URL('../../.github/workflows/self-hosted-runner-smoke.yml', import.meta.url), 'utf8'), 'runner smoke');
const job = workflow.jobs['reconciliation-diagnostics'];
const step = job.steps.find((item) => item.name === 'Read protected reconciliation configuration and state');
const body = step.run.split("<<'NODE'\n")[1].replace(/\nNODE\s*$/, '').replace(/^import .*;\n/gm, '');
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;

test('reconciliation diagnostics require manual opt-in and isolate secrets from the runner smoke', () => {
  assert.equal(workflow.on.workflow_dispatch.inputs.reconciliation_diagnostics.default, false);
  assert.equal(job.if, '${{ inputs.reconciliation_diagnostics }}');
  assert.equal(workflow.jobs.smoke.if, '${{ !inputs.reconciliation_diagnostics }}');
  assert.equal(job['runs-on'], 'ubuntu-latest');
  assert.deepEqual(job.permissions, { contents: 'read' });
  assert.ok(step.env.CODEX_DELIVERY_APP_PRIVATE_KEY);
  assert.equal(job.env, undefined);
});

async function exercise({ excessivePermissions = false } = {}) {
  const calls = [], output = [], transactions = [];
  const env = { CODEX_DELIVERY_APP_INSTALLATION_ID: '123', CODEX_DELIVERY_APP_ID: '456', CODEX_DELIVERY_APP_PRIVATE_KEY: 'private-key-fixture', CODEX_DELIVERY_DISPATCH_SECRET: 'secret-fixture-value-with-32-characters', AGENTIC_DELIVERY_REPLAY_DATABASE_URL: 'database-fixture-secret' };
  const processMock = { env };
  const sql = (parts, ...values) => ({ statement: parts.join('?'), values });
  sql.transaction = async (queries, options) => { transactions.push({ queries, options }); return queries.map(() => []); };
  const fetchMock = async (url, options) => {
    const route = new URL(url).pathname;
    calls.push({ route, ...options });
    const data = route.endsWith('/access_tokens') ? { token: 'temporary-token-fixture', permissions: excessivePermissions ? { contents: 'write' } : { metadata: 'read' } }
      : route === '/installation/repositories' ? { repositories: [{ id: 1, full_name: 'agentic-delivery-lab/agentic-delivery' }] }
      : route === '/app/hook/deliveries' ? []
      : { id: 123, app_id: 456, repository_selection: 'selected', suspended_at: null };
    return new Response(options.method === 'DELETE' ? null : JSON.stringify(data), { status: options.method === 'DELETE' ? 204 : 200 });
  };
  await new AsyncFunction('neon', 'createGithubAppJwt', 'loadParticipantRegistry', 'fetch', 'process', 'console', body)(
    () => sql, () => 'jwt-fixture-secret',
    async () => ({ valid: true, participants: new Map([['1', { repositoryId: '1', expectedFullName: 'agentic-delivery-lab/agentic-delivery', mode: 'shadow' }]]) }),
    fetchMock, processMock, { log: (value) => output.push(value), error: (value) => output.push(value) },
  );
  return { calls, output, transactions, processMock, env };
}

test('diagnostics use a metadata-only temporary token and a read-only database transaction', async () => {
  const result = await exercise();
  assert.equal(result.processMock.exitCode, undefined);
  assert.deepEqual(JSON.parse(result.calls.find((item) => item.route.endsWith('/access_tokens')).body), { permissions: { metadata: 'read' } });
  assert.equal(result.calls.at(-1).route, '/installation/token');
  assert.equal(result.calls.at(-1).method, 'DELETE');
  assert.equal(result.transactions.length, 1);
  assert.equal(result.transactions[0].options.readOnly, true);
  assert.equal(result.transactions[0].options.isolationLevel, 'RepeatableRead');
  assert.ok(result.transactions[0].queries.every((item) => /^SELECT /i.test(item.statement)));
  assert.ok(result.calls.every((item) => item.method === 'GET' || item.route.endsWith('/access_tokens') || item.route === '/installation/token'));
  const text = result.output.join('\n');
  for (const secret of [...Object.values(result.env).filter((value) => value.includes('fixture')), 'temporary-token-fixture', 'jwt-fixture-secret']) assert.ok(!text.includes(secret));
  assert.match(text, /selected_with_expected_identity":true/);
});

test('diagnostics reject excessive temporary-token permissions and still revoke it', async () => {
  const result = await exercise({ excessivePermissions: true });
  assert.equal(result.processMock.exitCode, 1);
  assert.equal(result.transactions.length, 0);
  assert.equal(result.calls.at(-1).method, 'DELETE');
  assert.match(result.output.join('\n'), /failed at metadata-token; raw errors and credentials omitted/);
});
