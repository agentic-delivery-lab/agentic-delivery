import assert from 'node:assert/strict';
import { access } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';

import { loadLifecycleConfig } from '../../scripts/issue-intake.mjs';
import { reasonIssueRouting } from '../../scripts/lib/issue-routing-agent.mjs';

const repositoryRoot = path.resolve(import.meta.dirname, '../..');
const config = await loadLifecycleConfig(repositoryRoot);

test('semantic routing uses a closed proposal schema and cleans its isolated runtime', async () => {
  let clientOptions;
  let turnOptions;
  const client = {
    initialize: async () => {},
    capabilities: async () => ({ stop: false }),
    startThread: async () => ({ thread: { id: '00000000-0000-0000-0000-000000000032' } }),
    close: async () => { client.closed = true; },
  };
  const proposal = {
    route: 'resume', workType: 'task', state: 'in-progress', governance: [],
    summary: 'Continue the saved implementation.', message: '',
  };
  const result = await reasonIssueRouting({
    repositoryRoot,
    issue: { number: 32, state: 'open', title: 'Work', body: 'Details', labels: ['type:task', 'state:in-progress'] },
    event: { kind: 'issue_comment', action: 'created', comment: { id: 4, body: 'Go on', user: { login: 'owner' } } },
    config,
    env: { PATH: process.env.PATH, CODEX_AUTH_HOME: '/missing', GH_TOKEN: 'must-not-reach-model-tools' },
    createClient: (options) => { clientOptions = options; return client; },
    performTurn: async (options) => { turnOptions = options; return { status: 'completed', text: JSON.stringify(proposal) }; },
  });
  assert.deepEqual(result, proposal);
  assert.equal(turnOptions.phase, 'route');
  assert.deepEqual(turnOptions.schema.properties.governance.items.enum, config.governance.map((item) => item.label));
  assert.deepEqual(turnOptions.schema.properties.state.enum, config.states.map((item) => item.id));
  assert.equal(clientOptions.env.GH_TOKEN, undefined);
  assert.equal(client.closed, true);
  await assert.rejects(access(clientOptions.cwd));
});
