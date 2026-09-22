import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';

import { parseRepositoryYaml } from '../../scripts/lib/yaml.mjs';
import {
  availableCapabilities,
  selectOrchestration,
  validateOrchestrationPolicy,
  validateOrchestrationProposal,
} from '../../scripts/lib/orchestration-policy.mjs';

const repositoryRoot = path.resolve(import.meta.dirname, '../..');
const policy = parseRepositoryYaml(
  await readFile(path.join(repositoryRoot, 'config/orchestration-policy.yml'), 'utf8'),
  'orchestration policy',
);

const context = (overrides = {}) => ({
  issueType: 'implementation',
  lifecycleStage: 'planning',
  readiness: 'ready',
  governance: [],
  trigger: 'issue',
  lineage: { isRoot: true, parent: null, children: [] },
  plan: { exists: false, valid: false, digest: null },
  session: { exists: false, resumable: false, id: null },
  execution: { status: 'idle', operation: null },
  capabilities: ['repository-read', 'repository-write', 'deterministic-validation'],
  mcp: [],
  skills: Object.keys(policy.skills),
  ...overrides,
});

test('orchestration policy is versioned and every profile declares least-privilege requirements', () => {
  assert.deepEqual(validateOrchestrationPolicy(policy), { valid: true, errors: [] });
  assert.equal(policy.version, 1);
  for (const profile of Object.values(policy.profiles)) {
    assert.equal(typeof profile.model, 'string');
    assert.equal(typeof profile.reasoning, 'string');
    assert.equal(typeof profile.mode, 'string');
    assert.equal(typeof profile.permissions, 'string');
    assert.ok(Array.isArray(profile.skills));
    assert.ok(Array.isArray(profile.capabilities));
    assert.ok(Array.isArray(profile.mcp));
  }
});

test('fresh implementation plans, valid existing plans, and exact continuation select different patterns', () => {
  assert.equal(selectOrchestration({ policy, context: context() }).pattern, 'implementation-fresh');
  assert.equal(selectOrchestration({
    policy,
    context: context({ lifecycleStage: 'execution', plan: { exists: true, valid: true, digest: 'a'.repeat(64) } }),
  }).pattern, 'implementation-existing-plan');
  assert.equal(selectOrchestration({
    policy,
    context: context({
      lifecycleStage: 'execution', trigger: 'comment',
      plan: { exists: true, valid: true, digest: 'a'.repeat(64) },
      session: { exists: true, resumable: true, id: '019fb023-24b8-7881-9119-509f078b610e' },
    }),
  }).pattern, 'implementation-continuation');
});

test('an explicit agent invocation uses the same deterministic continuation policy', () => {
  const result = selectOrchestration({
    policy,
    context: context({
      lifecycleStage: 'execution',
      trigger: 'agent-invocation',
      plan: { exists: true, valid: true, digest: 'a'.repeat(64) },
      session: { exists: true, resumable: true, id: '019fb023-24b8-7881-9119-509f078b610e' },
    }),
  });
  assert.equal(result.status, 'authorized');
  assert.equal(result.pattern, 'implementation-continuation');
});

test('research, architecture, validation, and lineage roots do not default to implementation', () => {
  assert.equal(selectOrchestration({ policy, context: context({ issueType: 'research', lifecycleStage: 'discovery' }) }).pattern, 'research-only');
  assert.equal(selectOrchestration({ policy, context: context({ issueType: 'architecture', lifecycleStage: 'decision' }) }).pattern, 'architecture-decision');
  assert.equal(selectOrchestration({ policy, context: context({ issueType: 'validation', lifecycleStage: 'validation' }) }).pattern, 'validation-only');
  assert.equal(selectOrchestration({ policy, context: context({ issueType: 'feature', lifecycleStage: 'acceptance', lineage: { isRoot: true, parent: null, children: [{ state: 'in-progress' }] } }) }).pattern, 'parent-coordination');
});

test('unavailable web research is an explicit degraded route', () => {
  const result = selectOrchestration({
    policy,
    context: context({ issueType: 'research', lifecycleStage: 'discovery', governance: ['external-evidence-required'], capabilities: ['repository-read'], mcp: [] }),
  });
  assert.equal(result.pattern, null);
  assert.equal(result.status, 'degraded');
  assert.match(result.reason, /web-research|MCP/i);
});

test('non-optional capabilities declared by selected profiles are required', () => {
  const result = selectOrchestration({
    policy,
    context: context({ capabilities: [] }),
  });
  assert.equal(result.status, 'degraded');
  assert.deepEqual(result.missingCapabilities, ['deterministic-validation', 'repository-read', 'repository-write']);
});

test('capability inventory normalizes only explicitly available capabilities', () => {
  assert.deepEqual(availableCapabilities({ capabilities: ['repository-read'], mcp: [{ name: 'firecrawl', available: false }] }), {
    capabilities: ['repository-read'], mcp: [], degraded: ['firecrawl'], skills: [],
  });
});

test('model proposals cannot invent patterns, profiles, capabilities, or MCP servers', () => {
  const invalid = validateOrchestrationProposal({
    policy,
    context: context(),
    proposal: { pattern: 'invented-agent-chain', profile: 'unknown', capabilities: ['root-shell'], mcp: ['unknown-server'] },
  });
  assert.equal(invalid.allowed, false);
  assert.match(invalid.reasons.join(' '), /approved|unknown|unsupported/i);
  const valid = validateOrchestrationProposal({
    policy,
    context: context(),
    proposal: { pattern: 'implementation-fresh', profile: 'planner', capabilities: ['repository-read'], mcp: [] },
  });
  assert.equal(valid.allowed, true);
});
