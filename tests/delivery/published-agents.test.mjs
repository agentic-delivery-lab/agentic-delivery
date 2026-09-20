import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import { validatePublishedAgents } from '../../scripts/validate-published-agents.mjs';

function sha256(source) { return createHash('sha256').update(source).digest('hex'); }

async function fixture(t, { secret = false, badTool = false } = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'agentic-delivery-published-agents-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, 'agents'), { recursive: true });
  await mkdir(path.join(root, 'provenance'), { recursive: true });
  await mkdir(path.join(root, '.git'), { recursive: true });
  await writeFile(path.join(root, '.gitignore'), '# repository-local credentials and caches\n');
  const tool = badTool ? "'*'" : 'codebase';
  const source = `---\nname: example-reviewer\ndescription: Read-only example reviewer\ntools: [${tool}]\n---\n\nReview the approved change.\n${secret ? 'token: ghp_12345678901234567890\n' : ''}`;
  await writeFile(path.join(root, 'agents/example-reviewer.agent.md'), source);
  await writeFile(path.join(root, 'provenance/agents.lock.json'), JSON.stringify({
    schemaVersion: 1,
    canonicalRepository: 'agentic-delivery-lab/agentic-delivery-primitives',
    agents: [{
      primitiveId: 'urn:agentic-delivery:primitive:example-reviewer',
      agentId: 'example-reviewer',
      targetPath: 'agents/example-reviewer.agent.md',
      sourceRepository: 'agentic-delivery-lab/agentic-delivery-primitives',
      sourceCommit: '0123456789abcdef0123456789abcdef01234567',
      sourceRef: 'refs/tags/v1.0.0',
      contentSha256: sha256(source),
      governingAdrs: ['urn:agentic-delivery:adr:0018'],
      toolPolicyVersion: '1.0.0',
      promotionRelease: 'v1.0.0',
      promotedAt: '2026-09-20T12:00:00Z',
      compatibilityTargets: ['github-copilot'],
    }],
  }, null, 2));
  return root;
}

test('validates a promoted agent projection against its lock and explicit tool policy', async (t) => {
  const root = await fixture(t);
  assert.deepEqual((await validatePublishedAgents({ publicationRoot: root })).agents, 1);
});

test('rejects wildcard tools and secret-like publication content', async (t) => {
  const wildcard = await fixture(t, { badTool: true });
  await assert.rejects(validatePublishedAgents({ publicationRoot: wildcard }), /unapproved tool/);
  const secret = await fixture(t, { secret: true });
  await assert.rejects(validatePublishedAgents({ publicationRoot: secret }), /secret or credential/);
});
