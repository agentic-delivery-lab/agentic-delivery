import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import { validatePublishedAgents } from '../../scripts/validate-published-agents.mjs';

function sha256(source) { return createHash('sha256').update(source).digest('hex'); }

async function fixture(t, { secret = false, badTool = false, surface = false } = {}) {
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
      sourceRef: '0123456789abcdef0123456789abcdef01234567',
      contentSha256: sha256(source),
      governingAdrs: ['urn:agentic-delivery:adr:0018'],
      toolPolicyVersion: '1.0.0',
      promotionRelease: 'v1.0.0',
      promotedAt: '2026-09-20T12:00:00Z',
      compatibilityTargets: ['github-copilot'],
    }],
  }, null, 2));
  if (surface) {
    await mkdir(path.join(root, 'profile'), { recursive: true });
    await mkdir(path.join(root, '.github/workflows'), { recursive: true });
    await writeFile(path.join(root, 'profile/README.md'), '# Members\n');
    await writeFile(path.join(root, '.github/CODEOWNERS'), '* @maintainers\n');
    await writeFile(path.join(root, '.github/workflows/validate-published-agents.yml'), 'name: validate\n');
    await writeFile(path.join(root, 'provenance/surface.yml'), 'status: pending-entitlement\n');
  }
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

test('rejects an agent file without a provenance record', async (t) => {
  const root = await fixture(t);
  await writeFile(path.join(root, 'agents/unlisted.agent.md'), '---\nname: unlisted\ndescription: Unlisted\ntools: [codebase]\n---\n');
  await assert.rejects(validatePublishedAgents({ publicationRoot: root }), /not declared in provenance/);
});

test('strict publication mode requires the GitHub-supported private surface', async (t) => {
  const root = await fixture(t, { surface: true });
  assert.equal((await validatePublishedAgents({ publicationRoot: root, requireSurface: true })).agents, 1);
  const incomplete = await fixture(t);
  await assert.rejects(
    validatePublishedAgents({ publicationRoot: incomplete, requireSurface: true }),
    /profile\/README\.md cannot be read/,
  );
});

test('optionally reproduces a publication from the pinned Primitive source', async (t) => {
  const publication = await fixture(t);
  const primitiveRoot = await mkdtemp(path.join(os.tmpdir(), 'agentic-delivery-primitive-source-'));
  t.after(() => rm(primitiveRoot, { recursive: true, force: true }));
  await mkdir(path.join(primitiveRoot, 'agents/copilot'), { recursive: true });
  await mkdir(path.join(primitiveRoot, 'manifests'), { recursive: true });
  const source = `---\nname: example-reviewer\ndescription: Read-only example reviewer\ntools: [codebase]\n---\n\n<!-- agentic-primitive: {"id":"example-reviewer","kind":"agent","enforcement":"instructional","adrs":["ADR-0018"]} -->\n\nReview the approved change.\n`;
  await writeFile(path.join(primitiveRoot, 'agents/copilot/example-reviewer.agent.md'), source);
  await writeFile(path.join(primitiveRoot, 'manifests/primitive-release.json'), JSON.stringify({
    schemaVersion: 1,
    releaseId: 'urn:agentic-delivery:primitive-release:1.0.0',
    sourceCommit: '0123456789abcdef0123456789abcdef01234567',
    capabilityPolicyVersion: '1.0.0',
  }));
  await writeFile(path.join(publication, 'agents/example-reviewer.agent.md'), source);
  const lockPath = path.join(publication, 'provenance/agents.lock.json');
  const lock = JSON.parse(await readFile(lockPath, 'utf8'));
  lock.agents[0].contentSha256 = sha256(source);
  lock.agents[0].promotionRelease = 'urn:agentic-delivery:primitive-release:1.0.0';
  lock.agents[0].toolPolicyVersion = '1.0.0';
  await writeFile(lockPath, JSON.stringify(lock, null, 2));
  assert.equal((await validatePublishedAgents({ publicationRoot: publication, primitiveRoot })).agents, 1);
  await writeFile(path.join(publication, 'agents/example-reviewer.agent.md'), `${source}tampered\n`);
  await assert.rejects(
    validatePublishedAgents({ publicationRoot: publication, primitiveRoot }),
    /canonical Primitive source/,
  );
});
