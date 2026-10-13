import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  ACTIVE_TIME_LIMIT_MS,
  createActiveTimeAllowance,
  remainingActiveTime,
  reserveActiveTime,
  settleActiveTime,
} from '../../scripts/lib/operation-active-time.mjs';

test('active time accumulates across settled attempts while clarification waiting is excluded', () => {
  let allowance = createActiveTimeAllowance();
  allowance = reserveActiveTime(allowance, { owner: '1:1', nowMs: 100 });
  allowance = settleActiveTime(allowance, { owner: '1:1', nowMs: 1100 });
  assert.equal(allowance.spentMs, 1000);
  allowance = reserveActiveTime(JSON.parse(JSON.stringify(allowance)), { owner: '2:1', nowMs: 10_000_000 });
  assert.equal(remainingActiveTime(allowance, { owner: '2:1', nowMs: 10_000_100 }), ACTIVE_TIME_LIMIT_MS - 1100);
  allowance = settleActiveTime(allowance, { owner: '2:1', nowMs: 10_000_200 });
  assert.equal(allowance.spentMs, 1200);
});

test('a serialized unsettled reservation prevents another active segment', () => {
  const allowance = reserveActiveTime(createActiveTimeAllowance(), { owner: '1:1', nowMs: 100 });
  const restarted = JSON.parse(JSON.stringify(allowance));
  assert.throws(() => reserveActiveTime(restarted, { owner: '2:1', nowMs: 200 }), /unsettled/);
  assert.throws(() => settleActiveTime(restarted, { owner: '2:1', nowMs: 200 }), /owner/);
  assert.deepEqual(restarted, allowance);
});

test('exact and over-limit consumption remain exhausted without hiding elapsed overage', () => {
  for (const overage of [0, 1]) {
    let allowance = reserveActiveTime(createActiveTimeAllowance(), { owner: '1:1', nowMs: 100 });
    assert.equal(remainingActiveTime(allowance, { owner: '1:1', nowMs: 100 + ACTIVE_TIME_LIMIT_MS + overage }), 0);
    allowance = settleActiveTime(allowance, { owner: '1:1', nowMs: 100 + ACTIVE_TIME_LIMIT_MS + overage });
    assert.equal(allowance.spentMs, ACTIVE_TIME_LIMIT_MS + overage);
    assert.throws(() => reserveActiveTime(allowance, { owner: '2:1', nowMs: 10_000_000 }), /exhausted/);
  }
});

test('unknown, malformed, changed-limit and backwards-clock evidence fails closed', () => {
  for (const allowance of [null, {}, { ...createActiveTimeAllowance(), limitMs: ACTIVE_TIME_LIMIT_MS + 1 }, { ...createActiveTimeAllowance(), spentMs: -1 }]) {
    assert.throws(() => reserveActiveTime(allowance, { owner: '1:1', nowMs: 100 }));
  }
  const allowance = reserveActiveTime(createActiveTimeAllowance(), { owner: '1:1', nowMs: 100 });
  assert.throws(() => remainingActiveTime(allowance, { owner: '1:1', nowMs: 99 }), /clock/);
  assert.throws(() => settleActiveTime(allowance, { owner: '1:1', nowMs: 99 }), /clock/);
  assert.equal(allowance.reservation.startedAtMs, 100);
});
