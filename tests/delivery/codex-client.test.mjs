import assert from 'node:assert/strict';
import { test } from 'node:test';
import { quotaBoundary, verifyModels, modelEnvironment, deliveryPermissions } from '../../scripts/lib/codex-client.mjs';

const now = 1_800_000_000;
const window = (usedPercent, windowDurationMins = 300) => ({ usedPercent, windowDurationMins, resetsAt: now + 100 });
const quota = (used = 30, weekly = 20) => ({ rateLimits: { limitId: 'codex', primary: window(used), secondary: window(weekly, 10080) } });

test('leaves a small finalization reserve in both usage windows', () => {
  assert.equal(quotaBoundary(quota(97), now).stop, false);
  assert.equal(quotaBoundary(quota(98), now).stop, true);
  assert.equal(quotaBoundary(quota(20, 98), now).stop, true);
  assert.equal(quotaBoundary(quota(100), now).resetsAt, now + 100);
});

test('quota telemetry fails closed on missing, invalid, or expired windows', () => {
  for (const value of [{}, {rateLimits:{}}, quota(NaN), quota(-1), quota('20'), quota(101)]) {
    assert.equal(quotaBoundary(value, now).stop, true);
  }
  assert.equal(quotaBoundary(quota(), now + 101).stop, true);
  const value = quota();
  value.rateLimits.primary.windowDurationMins = 15;
  assert.equal(quotaBoundary(value, now).stop, true);
});

test('checks every returned bucket and explicit server limits', () => {
  const value = quota();
  value.rateLimitsByLimitId = { codex: value.rateLimits, other: { primary: window(99, 60) } };
  assert.equal(quotaBoundary(value, now).stop, true);
  assert.equal(quotaBoundary({rateLimits:{...quota().rateLimits, spendControlReached:true}}, now).stop, true);
});

test('requires the exact requested models and reasoning efforts', () => {
  const models = [
    {id:'gpt-5.6-sol', supportedReasoningEfforts:[{reasoningEffort:'high'}]},
    {id:'gpt-5.6-luna', supportedReasoningEfforts:[{reasoningEffort:'max'}]},
  ];
  verifyModels(models);
  assert.throws(() => verifyModels(models.slice(0, 1)), /gpt-5.6-luna/);
  models[1].supportedReasoningEfforts = [{reasoningEffort:'high'}];
  assert.throws(() => verifyModels(models), /max/);
});

test('model processes do not inherit publishing, API, or Actions credentials', () => {
  const env = modelEnvironment({PATH:'/bin', HOME:'/example', GH_TOKEN:'secret', OPENAI_API_KEY:'secret', ACTIONS_RUNTIME_TOKEN:'secret', NODE_OPTIONS:'--import=/malicious.mjs'});
  assert.deepEqual(env, {PATH:'/bin', HOME:'/example'});
});

test('planning and implementation restrict reads and deny tool network access', () => {
  const profiles = deliveryPermissions();
  assert.equal(profiles['delivery-plan'].filesystem[':root'], 'deny');
  assert.equal(profiles['delivery-plan'].filesystem[':workspace_roots']['.'], 'read');
  assert.equal(profiles['delivery-edit'].filesystem[':workspace_roots']['.'], 'write');
  assert.equal(profiles['delivery-edit'].filesystem[':workspace_roots']['.git'], 'read');
  assert.equal(profiles['delivery-edit'].network.enabled, false);
});
