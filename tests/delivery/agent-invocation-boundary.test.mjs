import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import actorCatalog from '../../.github/agent-actors.json' with { type: 'json' };
import {
  AGENT_BOT_LOGIN,
  AGENT_MENTION,
  INVOCATION_EVENTS,
  constantTimeSignatureValid,
  hasInvocationMention,
  invocationEventSupported,
  validateActorCatalog,
} from '../../scripts/lib/agent-invocation.mjs';
import { handleWebhook } from '../../api/github/webhook.mjs';
import { prepareAgentInvocation } from '../../scripts/prepare-agent-invocation.mjs';

const repositoryRoot = path.resolve(import.meta.dirname, '../..');

test('the configured App actor and event catalog are deterministic', async () => {
  assert.equal(AGENT_MENTION, '@agentic-delivery-lab-invoker-7f3a');
  assert.equal(AGENT_BOT_LOGIN, 'agentic-delivery-lab-invoker-7f3a[bot]');
  assert.deepEqual(validateActorCatalog(actorCatalog), { valid: true, errors: [] });
  assert.deepEqual(Object.keys(INVOCATION_EVENTS), ['issue_comment', 'pull_request_review', 'pull_request_review_comment']);
  assert.ok((await readFile(path.join(repositoryRoot, '.github/agent-actors.json'), 'utf8')).includes('agentic-delivery-lab-invoker-7f3a[bot]'));
});

test('only an explicit first visible line invokes the orchestrator', () => {
  assert.equal(hasInvocationMention('@agentic-delivery-lab-invoker-7f3a please continue'), true);
  assert.equal(hasInvocationMention('\n\n@agentic-delivery-lab-invoker-7f3a\nPlease continue'), true);
  assert.equal(hasInvocationMention('> @agentic-delivery-lab-invoker-7f3a please continue'), false);
  assert.equal(hasInvocationMention('```\n@agentic-delivery-lab-invoker-7f3a please continue\n```'), false);
  assert.equal(hasInvocationMention('`@agentic-delivery-lab-invoker-7f3a` please continue'), false);
  assert.equal(hasInvocationMention('@agentic-delivery-lab-invoker-7f3a-extra please continue'), false);
  assert.equal(hasInvocationMention('@agentic-delivery-lab-invoker-7f3a'), true);
});

test('webhook signatures and event actions require the supported contract', () => {
  const secret = 'test-secret';
  const rawBody = '{"action":"created"}';
  const signature = `sha256=${createHmac('sha256', secret).update(rawBody).digest('hex')}`;
  assert.equal(constantTimeSignatureValid({ secret, rawBody, signature }), true);
  assert.equal(constantTimeSignatureValid({ secret, rawBody, signature: `${signature}0` }), false);
  assert.equal(invocationEventSupported('issue_comment', 'created'), true);
  assert.equal(invocationEventSupported('pull_request_review_comment', 'edited'), true);
  assert.equal(invocationEventSupported('repository_dispatch', 'created'), false);
});

function response(status, value = {}) {
  return { ok: status >= 200 && status < 300, status, json: async () => value };
}

function request({ body, event = 'issue_comment', signature, delivery = 'delivery-12345678901234567890' }) {
  return {
    method: 'POST',
    headers: {
      'x-github-event': event,
      'x-github-delivery': delivery,
      'x-hub-signature-256': signature,
    },
    async *[Symbol.asyncIterator]() { yield Buffer.from(body); },
  };
}

function result() {
  return {
    statusCode: null,
    headers: {},
    body: null,
    setHeader(name, value) { this.headers[name] = value; },
    end(value) { this.body = value ?? null; },
  };
}

test('webhook filters untagged comments before creating a repository dispatch', async () => {
  const body = JSON.stringify({
    action: 'created',
    repository: { full_name: 'agentic-delivery-lab/agentic-delivery', id: 42 },
    issue: { number: 44 },
    comment: { id: 7, body: 'A normal review note.', user: { login: 'sjefsharp', type: 'User' } },
    sender: { login: 'sjefsharp', type: 'User' },
  });
  const signature = `sha256=${createHmac('sha256', 'test-secret').update(body).digest('hex')}`;
  const output = result();
  let calls = 0;
  await handleWebhook(request({ body, signature }), output, {
    env: { AGENTIC_DELIVERY_WEBHOOK_SECRET: 'test-secret', AGENTIC_DELIVERY_REPOSITORY: 'agentic-delivery-lab/agentic-delivery' },
    fetchImpl: async () => { calls += 1; return response(200, { permission: 'write' }); },
    tokenProvider: { token: async () => 'installation-token' },
  });
  assert.equal(output.statusCode, 204);
  assert.equal(calls, 0);
});

test('webhook rejects self-authored and unknown bot invocations', async () => {
  for (const login of ['agentic-delivery-lab-invoker-7f3a[bot]', 'unknown-automation[bot]']) {
    const payload = {
      action: 'created',
      repository: { full_name: 'agentic-delivery-lab/agentic-delivery', id: 42 },
      issue: { number: 44 },
      comment: { id: 7, body: '@agentic-delivery-lab-invoker-7f3a continue', user: { login, type: 'Bot' } },
      sender: { login, type: 'Bot' },
    };
    const body = JSON.stringify(payload);
    const signature = `sha256=${createHmac('sha256', 'test-secret').update(body).digest('hex')}`;
    const output = result();
    await handleWebhook(request({ body, signature }), output, {
      env: { AGENTIC_DELIVERY_WEBHOOK_SECRET: 'test-secret', AGENTIC_DELIVERY_REPOSITORY: 'agentic-delivery-lab/agentic-delivery' },
      fetchImpl: async () => response(500),
      tokenProvider: { token: async () => 'installation-token' },
    });
    assert.equal(output.statusCode, 403, login);
  }
});

test('webhook authorizes a tagged writer and dispatches only immutable metadata', async () => {
  const payload = {
    action: 'created',
    repository: { full_name: 'agentic-delivery-lab/agentic-delivery', id: 42 },
    issue: { number: 44 },
    comment: { id: 7, body: '@agentic-delivery-lab-invoker-7f3a please continue', user: { login: 'sjefsharp', type: 'User' } },
    sender: { login: 'sjefsharp', type: 'User' },
  };
  const body = JSON.stringify(payload);
  const signature = `sha256=${createHmac('sha256', 'test-secret').update(body).digest('hex')}`;
  const output = result();
  const calls = [];
  await handleWebhook(request({ body, signature }), output, {
    env: { AGENTIC_DELIVERY_WEBHOOK_SECRET: 'test-secret', AGENTIC_DELIVERY_REPOSITORY: 'agentic-delivery-lab/agentic-delivery' },
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return url.includes('/permission') ? response(200, { permission: 'write' }) : response(204);
    },
    tokenProvider: { token: async () => 'installation-token' },
  });
  assert.equal(output.statusCode, 202);
  assert.equal(calls.length, 2);
  const dispatch = JSON.parse(calls[1].options.body);
  assert.equal(dispatch.event_type, 'agent_invocation');
  assert.equal(dispatch.client_payload.source.comment_id, 7);
  assert.equal(dispatch.client_payload.actor.login, 'sjefsharp');
  assert.equal(dispatch.client_payload.body_digest.length, 64);
  assert.equal(Object.keys(dispatch.client_payload).length, 10);
});

test('agent preflight re-fetches the tagged issue comment and deduplicates deliveries', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'agentic-delivery-invocation-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const eventPath = path.join(root, 'event.json');
  const outputPath = path.join(root, 'output');
  const body = '@agentic-delivery-lab-invoker-7f3a resume the saved plan';
  const deliveryId = '12345678-1234-4234-8234-123456789012';
  await writeFile(eventPath, JSON.stringify({
    repository: { full_name: 'agentic-delivery-lab/agentic-delivery', id: 42 },
    client_payload: {
      version: 1,
      delivery_id: deliveryId,
      event: 'issue_comment',
      action: 'created',
      repository_id: '42',
      source: { kind: 'issue_comment', issue_number: 44, comment_id: 7, pull_request_number: null, review_id: null },
      actor: { login: 'sjefsharp', type: 'User' },
      hop: 0,
      body_digest: (await import('../../scripts/lib/agent-invocation.mjs')).bodyDigest(body),
    },
  }));
  const baseEnv = {
    GH_TOKEN: 'token',
    GITHUB_EVENT_PATH: eventPath,
    GITHUB_REPOSITORY: 'agentic-delivery-lab/agentic-delivery',
    GITHUB_OUTPUT: outputPath,
    CODEX_DELIVERY_STATE_DIR: root,
    RUNNER_TEMP: root,
  };
  const fetchImpl = async (url) => {
    if (url.endsWith('/issues/44/comments/7')) return response(200, { id: 7, body, user: { login: 'sjefsharp', type: 'User' }, author_association: 'OWNER' });
    if (url.endsWith('/collaborators/sjefsharp/permission')) return response(200, { permission: 'write' });
    throw new Error(`Unexpected URL ${url}`);
  };
  const accepted = await prepareAgentInvocation({ env: baseEnv, fetchImpl });
  assert.equal(accepted.accepted, true);
  assert.equal(accepted.sourceIssue, '44');
  const output = await readFile(outputPath, 'utf8');
  assert.match(output, /accepted<<AGENT_INVOCATION_EOF\ntrue/);

  const duplicate = await prepareAgentInvocation({ env: baseEnv, fetchImpl });
  assert.equal(duplicate.accepted, false);
});
