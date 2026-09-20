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
import { parseParticipantRegistry } from '../../scripts/lib/participant-registry.mjs';
import { InMemoryReplayStore, validateReceivedAt } from '../../scripts/lib/replay-protection.mjs';

const repositoryRoot = path.resolve(import.meta.dirname, '../..');
const testDependencies = {
  architecture: {
    repository: 'agentic-delivery-lab/agentic-delivery-architecture',
    version: '0.1.0-draft.1',
    commit: '0123456789abcdef0123456789abcdef01234567',
    contentSha256: null,
  },
  primitives: {
    repository: 'agentic-delivery-lab/agentic-delivery-primitives',
    version: '0.1.0-draft.1',
    commit: '0123456789abcdef0123456789abcdef01234567',
    contentSha256: null,
  },
};

test('the configured App actor and event catalog are deterministic', async () => {
  assert.equal(AGENT_MENTION, '@agentic-delivery-lab-invoker-7f3a');
  assert.equal(AGENT_BOT_LOGIN, 'agentic-delivery-lab-invoker-7f3a[bot]');
  assert.deepEqual(validateActorCatalog(actorCatalog), { valid: true, errors: [] });
  assert.deepEqual(Object.keys(INVOCATION_EVENTS), ['issues', 'issue_comment', 'pull_request_review', 'pull_request_review_comment']);
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
  assert.equal(invocationEventSupported('issues', 'opened'), true);
  assert.equal(invocationEventSupported('pull_request_review_comment', 'edited'), true);
  assert.equal(invocationEventSupported('repository_dispatch', 'created'), false);
});

function response(status, value = {}) {
  return { ok: status >= 200 && status < 300, status, json: async () => value };
}

function request({ body, event = 'issue_comment', signature, delivery = '12345678-1234-4234-8234-123456789012' }) {
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
    repository: { full_name: 'agentic-delivery-lab/agentic-delivery', id: 1358455028 },
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

test('webhook fails closed when the central controller repository is not configured', async () => {
  const body = JSON.stringify({
    action: 'created',
    repository: { full_name: 'agentic-delivery-lab/agentic-delivery', id: 1358455028 },
    issue: { number: 44 },
    comment: { id: 7, body: '@agentic-delivery-lab-invoker-7f3a continue', user: { login: 'sjefsharp', type: 'User' } },
    sender: { login: 'sjefsharp', type: 'User' },
  });
  const signature = `sha256=${createHmac('sha256', 'test-secret').update(body).digest('hex')}`;
  const output = result();
  await handleWebhook(request({ body, signature }), output, {
    env: { AGENTIC_DELIVERY_WEBHOOK_SECRET: 'test-secret' },
  });
  assert.equal(output.statusCode, 500);
  assert.match(output.body, /central controller repository is not configured/);
});

test('webhook rejects self-authored and unknown bot invocations', async () => {
  for (const login of ['agentic-delivery-lab-invoker-7f3a[bot]', 'unknown-automation[bot]']) {
    const payload = {
      action: 'created',
      repository: { full_name: 'agentic-delivery-lab/agentic-delivery', id: 1358455028 },
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
    repository: { full_name: 'agentic-delivery-lab/agentic-delivery', id: 1358455028 },
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
  assert.deepEqual(dispatch.client_payload.controller, {
    version: '0.2.0',
    commit: 'b160ae8826330ce280c41108e9459550c399e8c6',
  });
  assert.equal(Object.keys(dispatch.client_payload).length, 12);
  assert.match(dispatch.client_payload.received_at, /^\d{4}-\d{2}-\d{2}T/);
});

test('webhook claims a delivery once and releases the claim when dispatch fails', async () => {
  const replayStore = new InMemoryReplayStore();
  const payload = {
    action: 'created',
    repository: { full_name: 'agentic-delivery-lab/agentic-delivery', id: 1358455028 },
    issue: { number: 44 },
    comment: { id: 77, body: '@agentic-delivery-lab-invoker-7f3a continue', user: { login: 'sjefsharp', type: 'User' } },
    sender: { login: 'sjefsharp', type: 'User' },
  };
  const body = JSON.stringify(payload);
  const signature = `sha256=${createHmac('sha256', 'test-secret').update(body).digest('hex')}`;
  const env = {
    AGENTIC_DELIVERY_WEBHOOK_SECRET: 'test-secret',
    AGENTIC_DELIVERY_CONTROLLER_REPOSITORY: 'agentic-delivery-lab/agentic-delivery',
  };
  const requestFor = () => request({ body, signature, delivery: '98765432-1234-4234-8234-123456789012' });
  const output = result();
  let dispatches = 0;
  await handleWebhook(requestFor(), output, {
    env,
    replayStore,
    tokenProvider: { token: async () => 'installation-token' },
    fetchImpl: async (url) => {
      if (url.includes('/permission')) return response(200, { permission: 'write' });
      dispatches += 1;
      return response(204);
    },
  });
  assert.equal(output.statusCode, 202);
  assert.equal(dispatches, 1);

  const duplicate = result();
  await handleWebhook(requestFor(), duplicate, {
    env,
    replayStore,
    tokenProvider: { token: async () => 'installation-token' },
    fetchImpl: async (url) => (url.includes('/permission') ? response(200, { permission: 'write' }) : (() => { throw new Error('duplicate must not dispatch'); })()),
  });
  assert.equal(duplicate.statusCode, 200);
  assert.match(duplicate.body, /"duplicate":true/);

  const failingStore = new InMemoryReplayStore();
  await assert.rejects(handleWebhook(requestFor(), result(), {
    env,
    replayStore: failingStore,
    tokenProvider: { token: async () => 'installation-token' },
    fetchImpl: async (url) => {
      if (url.includes('/permission')) return response(200, { permission: 'write' });
      return response(500);
    },
  }));
  const retried = result();
  await handleWebhook(requestFor(), retried, {
    env,
    replayStore: failingStore,
    tokenProvider: { token: async () => 'installation-token' },
    fetchImpl: async (url) => (url.includes('/permission') ? response(200, { permission: 'write' }) : response(204)),
  });
  assert.equal(retried.statusCode, 202);
});

test('received-at validation rejects stale and future event envelopes', () => {
  const now = Date.parse('2026-09-21T12:00:00.000Z');
  assert.equal(validateReceivedAt('2026-09-21T11:59:00.000Z', { now }).valid, true);
  assert.equal(validateReceivedAt('2026-09-21T11:00:00.000Z', { now }).valid, false);
  assert.equal(validateReceivedAt('2026-09-21T12:01:00.000Z', { now }).valid, false);
});

test('webhook forwards an enrolled issue lifecycle event without requiring an invocation mention', async () => {
  const payload = {
    action: 'opened',
    repository: { full_name: 'agentic-delivery-lab/agentic-delivery', id: 1358455028 },
    issue: { number: 45, body: 'A new delivery goal.', user: { login: 'sjefsharp', type: 'User' } },
    sender: { login: 'sjefsharp', type: 'User' },
  };
  const body = JSON.stringify(payload);
  const signature = `sha256=${createHmac('sha256', 'test-secret').update(body).digest('hex')}`;
  const output = result();
  const calls = [];
  await handleWebhook(request({ body, event: 'issues', signature }), output, {
    env: { AGENTIC_DELIVERY_WEBHOOK_SECRET: 'test-secret', AGENTIC_DELIVERY_REPOSITORY: 'agentic-delivery-lab/agentic-delivery' },
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return url.includes('/permission') ? response(200, { permission: 'write' }) : response(204);
    },
    tokenProvider: { token: async () => 'installation-token' },
  });
  assert.equal(output.statusCode, 202);
  const dispatch = JSON.parse(calls[1].options.body);
  assert.equal(dispatch.client_payload.event, 'issues');
  assert.equal(dispatch.client_payload.source.kind, 'issue');
  assert.equal(dispatch.client_payload.source.issue_number, 45);
});

test('one central webhook accepts a second enrolled repository and dispatches to the controller', async () => {
  const repositoryId = '777777777';
  const repository = 'agentic-delivery-lab/service-a';
  const registry = parseParticipantRegistry({
    version: 1,
    organization: 'agentic-delivery-lab',
    repositories: {
      [repositoryId]: {
        expectedFullName: repository,
        mode: 'active',
        controller: { version: '0.1.0', commit: '0123456789abcdef0123456789abcdef01234567' },
        contracts: { eventEnvelope: 1, lifecycle: '1.0.0', stateMachine: '1.0.0', evidence: '1.0.0' },
        dependencies: testDependencies,
        configurationProfile: 'standard',
        events: ['issue_comment'],
        localIntegration: { workflowBundle: 'none', managedByApp: false },
      },
    },
  });
  const payload = {
    action: 'created',
    repository: { full_name: repository, id: Number(repositoryId) },
    issue: { number: 12 },
    comment: { id: 9, body: '@agentic-delivery-lab-invoker-7f3a continue', user: { login: 'sjefsharp', type: 'User' } },
    sender: { login: 'sjefsharp', type: 'User' },
  };
  const body = JSON.stringify(payload);
  const signature = 'sha256=' + createHmac('sha256', 'test-secret').update(body).digest('hex');
  const output = result();
  const calls = [];
  const tokens = [];
  await handleWebhook(request({ body, signature }), output, {
    env: {
      AGENTIC_DELIVERY_WEBHOOK_SECRET: 'test-secret',
      AGENTIC_DELIVERY_CONTROLLER_REPOSITORY: 'agentic-delivery-lab/agentic-delivery',
    },
    participantRegistry: registry,
    tokenProvider: {
      token: async (options) => {
        tokens.push(options ?? {});
        return 'installation-token';
      },
    },
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return url.includes('/permission') ? response(200, { permission: 'write' }) : response(204);
    },
  });
  assert.equal(output.statusCode, 202);
  assert.equal(calls[0].url, 'https://api.github.com/repos/' + repository + '/collaborators/sjefsharp/permission');
  assert.equal(calls[1].url, 'https://api.github.com/repos/agentic-delivery-lab/agentic-delivery/dispatches');
  assert.equal(JSON.parse(calls[1].options.body).client_payload.repository_id, repositoryId);
  assert.deepEqual(tokens[0], { repositoryIds: [repositoryId] });
  assert.deepEqual(tokens[1], { permissions: { contents: 'write' } });
});

test('agent preflight re-fetches the tagged issue comment and deduplicates deliveries', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'agentic-delivery-invocation-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const eventPath = path.join(root, 'event.json');
  const outputPath = path.join(root, 'output');
  const body = '@agentic-delivery-lab-invoker-7f3a resume the saved plan';
  const deliveryId = '12345678-1234-4234-8234-123456789012';
  await writeFile(eventPath, JSON.stringify({
    repository: { full_name: 'agentic-delivery-lab/agentic-delivery', id: 1358455028 },
    client_payload: {
      version: 1,
      delivery_id: deliveryId,
      event: 'issue_comment',
      action: 'created',
      repository_id: '1358455028',
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
    if (url.endsWith('/issues/comments/7')) return response(200, { id: 7, body, user: { login: 'sjefsharp', type: 'User' }, author_association: 'OWNER' });
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

test('central preflight resolves and revalidates the originating repository from the participant registry', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'agentic-delivery-central-preflight-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const eventPath = path.join(root, 'event.json');
  const outputPath = path.join(root, 'output');
  const originRepository = 'agentic-delivery-lab/service-a';
  const originRepositoryId = '777777777';
  const body = '@agentic-delivery-lab-invoker-7f3a continue the saved plan';
  const deliveryId = '22345678-1234-4234-8234-123456789012';
  const registry = parseParticipantRegistry({
    version: 1,
    organization: 'agentic-delivery-lab',
    repositories: {
      [originRepositoryId]: {
        expectedFullName: originRepository,
        mode: 'active',
        controller: { version: '0.1.0', commit: '0123456789abcdef0123456789abcdef01234567' },
        contracts: { eventEnvelope: 1, lifecycle: '1.0.0', stateMachine: '1.0.0', evidence: '1.0.0' },
        dependencies: testDependencies,
        configurationProfile: 'standard',
        events: ['issue_comment'],
        localIntegration: { workflowBundle: 'none', managedByApp: false },
      },
    },
  });
  await writeFile(eventPath, JSON.stringify({
    repository: { full_name: 'agentic-delivery-lab/agentic-delivery', id: 1358455028 },
    client_payload: {
      version: 1,
      delivery_id: deliveryId,
      event: 'issue_comment',
      action: 'created',
      repository_id: originRepositoryId,
      source: { kind: 'issue_comment', issue_number: 12, comment_id: 9, pull_request_number: null, review_id: null },
      actor: { login: 'sjefsharp', type: 'User' },
      hop: 0,
      body_digest: (await import('../../scripts/lib/agent-invocation.mjs')).bodyDigest(body),
      controller: { version: '0.1.0', commit: '0123456789abcdef0123456789abcdef01234567' },
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
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(url);
    if (url.endsWith('/issues/comments/9')) return response(200, { id: 9, body, user: { login: 'sjefsharp', type: 'User' }, author_association: 'OWNER' });
    if (url.endsWith('/collaborators/sjefsharp/permission')) return response(200, { permission: 'write' });
    throw new Error('Unexpected URL ' + url);
  };
  const accepted = await prepareAgentInvocation({ env: baseEnv, fetchImpl, participantRegistry: registry });
  assert.equal(accepted.accepted, true);
  assert.equal(accepted.sourceIssue, '12');
  assert.equal(accepted.participantMode, 'active');
  assert.equal(accepted.originRepository, originRepository);
  const output = await readFile(outputPath, 'utf8');
  assert.match(output, /controller_commit<<AGENT_INVOCATION_EOF\n0123456789abcdef0123456789abcdef01234567/);
  assert.ok(calls.every((url) => url.includes('/repos/' + originRepository + '/')));
  const normalizedEvent = JSON.parse(await readFile(accepted.normalizedPath, 'utf8'));
  assert.equal(normalizedEvent.repository.full_name, originRepository);
});

test('central preflight rejects a controller pin that differs from the participant registry', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'agentic-delivery-controller-pin-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const eventPath = path.join(root, 'event.json');
  const originRepository = 'agentic-delivery-lab/service-a';
  const originRepositoryId = '777777777';
  const body = '@agentic-delivery-lab-invoker-7f3a continue';
  const registry = parseParticipantRegistry({
    version: 1,
    organization: 'agentic-delivery-lab',
    repositories: {
      [originRepositoryId]: {
        expectedFullName: originRepository,
        mode: 'active',
        controller: { version: '0.1.0', commit: '0123456789abcdef0123456789abcdef01234567' },
        contracts: { eventEnvelope: 1, lifecycle: '1.0.0', stateMachine: '1.0.0', evidence: '1.0.0' },
        dependencies: testDependencies,
        configurationProfile: 'standard',
        events: ['issue_comment'],
        localIntegration: { workflowBundle: 'none', managedByApp: false },
      },
    },
  });
  await writeFile(eventPath, JSON.stringify({
    repository: { full_name: 'agentic-delivery-lab/agentic-delivery', id: 1358455028 },
    client_payload: {
      version: 1,
      delivery_id: '42345678-1234-4234-8234-123456789012',
      event: 'issue_comment',
      action: 'created',
      repository_id: originRepositoryId,
      source: { kind: 'issue_comment', issue_number: 12, comment_id: 9, pull_request_number: null, review_id: null },
      actor: { login: 'sjefsharp', type: 'User' },
      hop: 0,
      body_digest: (await import('../../scripts/lib/agent-invocation.mjs')).bodyDigest(body),
      controller: { version: '0.2.0', commit: 'b160ae8826330ce280c41108e9459550c399e8c6' },
    },
  }));
  await assert.rejects(
    prepareAgentInvocation({
      env: {
        GH_TOKEN: 'token',
        GITHUB_EVENT_PATH: eventPath,
        GITHUB_REPOSITORY: 'agentic-delivery-lab/agentic-delivery',
        GITHUB_OUTPUT: path.join(root, 'output'),
        CODEX_DELIVERY_STATE_DIR: root,
        RUNNER_TEMP: root,
      },
      fetchImpl: async () => { throw new Error('origin API must not be called'); },
      participantRegistry: registry,
    }),
    /controller pin does not match the participant registry/,
  );
});

test('central preflight accepts issue lifecycle envelopes without a comment', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'agentic-delivery-issue-preflight-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const eventPath = path.join(root, 'event.json');
  const outputPath = path.join(root, 'output');
  const originRepository = 'agentic-delivery-lab/service-a';
  const originRepositoryId = '777777777';
  const deliveryId = '32345678-1234-4234-8234-123456789012';
  const registry = parseParticipantRegistry({
    version: 1,
    organization: 'agentic-delivery-lab',
    repositories: {
      [originRepositoryId]: {
        expectedFullName: originRepository,
        mode: 'active',
        controller: { version: '0.1.0', commit: '0123456789abcdef0123456789abcdef01234567' },
        contracts: { eventEnvelope: 1, lifecycle: '1.0.0', stateMachine: '1.0.0', evidence: '1.0.0' },
        dependencies: testDependencies,
        configurationProfile: 'standard',
        events: ['issues'],
        localIntegration: { workflowBundle: 'none', managedByApp: false },
      },
    },
  });
  await writeFile(eventPath, JSON.stringify({
    repository: { full_name: 'agentic-delivery-lab/agentic-delivery', id: 1358455028 },
    client_payload: {
      version: 1,
      delivery_id: deliveryId,
      event: 'issues',
      action: 'opened',
      repository_id: originRepositoryId,
      source: { kind: 'issue', issue_number: 12, comment_id: null, pull_request_number: null, review_id: null },
      actor: { login: 'sjefsharp', type: 'User' },
      hop: 0,
      body_digest: (await import('../../scripts/lib/agent-invocation.mjs')).bodyDigest('A new delivery goal.'),
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
    if (url.endsWith('/collaborators/sjefsharp/permission')) return response(200, { permission: 'write' });
    throw new Error(`Unexpected URL ${url}`);
  };
  const accepted = await prepareAgentInvocation({ env: baseEnv, fetchImpl, participantRegistry: registry });
  assert.equal(accepted.accepted, true);
  assert.equal(accepted.sourceIssue, '12');
  const normalizedEvent = JSON.parse(await readFile(accepted.normalizedPath, 'utf8'));
  assert.equal(normalizedEvent.issue.number, 12);
  assert.equal(normalizedEvent.comment, undefined);
  assert.equal(normalizedEvent.sender.login, 'sjefsharp');
});
