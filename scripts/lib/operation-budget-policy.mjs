// agentic-primitive: {"id":"operation-budget-policy-identity","kind":"validator","enforcement":"deterministic","adrs":["ADR-0009","ADR-0018"],"domains":["agentic-delivery-governance","agentic-delivery-control-plane"]}
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { ACTIVE_TIME_LIMIT_MS } from './operation-active-time.mjs';

// A proposal fingerprint is identity, not approval or evidence of enforcement.
// Tool, child, transport and concurrency admission remains separate work.
export const INITIAL_OPERATION_LIMITS = Object.freeze({
  activeTimeMs: ACTIVE_TIME_LIMIT_MS,
  modelTurns: 8,
  validationAttempts: 3,
  toolInvocations: 100,
  childImplementations: 0,
  recursionDepth: 0,
  transportAttempts: 8,
  controllerAttempts: 8,
  concurrentImplementations: 1,
  automaticBillingOrModelFallback: false,
});

const sourceRoot = path.resolve(import.meta.dirname, '../..');
const implementations = [
  'scripts/codex-delivery.mjs',
  'scripts/lib/codex-client.mjs',
  'scripts/lib/codex-loop.mjs',
  'scripts/lib/operation-active-time.mjs',
  'scripts/lib/operation-budget-policy.mjs',
].map((file) => ({ file, sha256: createHash('sha256').update(readFileSync(path.join(sourceRoot, file))).digest('hex') }));
const reference = Object.freeze({
  id: 'factory-initial-operation-budget',
  version: '1.0.0-proposed.1',
  sha256: createHash('sha256').update(JSON.stringify({ status: 'proposed', limits: INITIAL_OPERATION_LIMITS, implementations })).digest('hex'),
});

export function currentOperationPolicyReference() {
  return { ...reference };
}

export function matchesCurrentOperationPolicy(value) {
  return value !== null && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype
    && Object.keys(value).length === 3
    && value.id === reference.id && value.version === reference.version && value.sha256 === reference.sha256;
}
