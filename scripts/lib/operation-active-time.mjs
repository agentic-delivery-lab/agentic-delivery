// agentic-primitive: {"id":"operation-active-time-allowance","kind":"validator","enforcement":"deterministic","adrs":["ADR-0009","ADR-0018"],"domains":["agentic-delivery-governance","agentic-delivery-control-plane"]}

// Proposed initial bound. This record is not policy admission or proof that a
// runtime can interrupt every protected action at its deadline.
export const ACTIVE_TIME_LIMIT_MS = 30 * 60_000;

const ownerPattern = /^[1-9][0-9]*:[1-9][0-9]*$/;
const milliseconds = (value) => Number.isSafeInteger(value) && value >= 0;
const ownerIdentity = (value) => typeof value === 'string' && value.length <= 128 && ownerPattern.test(value);
const objectWithKeys = (value, keys) => value !== null && typeof value === 'object'
  && Object.getPrototypeOf(value) === Object.prototype
  && Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));

export function validateActiveTimeAllowance(value) {
  if (!objectWithKeys(value, ['version', 'limitMs', 'spentMs', 'reservation'])
    || value.version !== 1 || value.limitMs !== ACTIVE_TIME_LIMIT_MS || !milliseconds(value.spentMs)
    || (value.reservation !== null && (!objectWithKeys(value.reservation, ['owner', 'startedAtMs'])
      || !ownerIdentity(value.reservation.owner) || !milliseconds(value.reservation.startedAtMs)))) {
    throw new Error('Active time consumption is unknown or invalid; preserve the operation for owner inspection.');
  }
  return value;
}

function validateOwnerAndClock({ owner, nowMs }) {
  if (!ownerIdentity(owner) || !milliseconds(nowMs)) throw new Error('Active time owner or clock evidence is invalid.');
}

function elapsedTime(allowance, { owner, nowMs }) {
  validateOwnerAndClock({ owner, nowMs });
  if (!allowance.reservation || allowance.reservation.owner !== owner) {
    throw new Error('The active time reservation does not match its owner.');
  }
  if (nowMs < allowance.reservation.startedAtMs) throw new Error('Active time clock moved backwards; preserve the reservation for inspection.');
  return nowMs - allowance.reservation.startedAtMs;
}

export function createActiveTimeAllowance() {
  return { version: 1, limitMs: ACTIVE_TIME_LIMIT_MS, spentMs: 0, reservation: null };
}

// The controller must persist this reservation under its exclusive operation
// ownership before starting work. A prior unsettled segment is never replaced.
export function reserveActiveTime(value, { owner, nowMs }) {
  const allowance = validateActiveTimeAllowance(value);
  validateOwnerAndClock({ owner, nowMs });
  if (allowance.reservation) throw new Error('Active time reservation is unsettled; preserve the operation for owner inspection.');
  if (allowance.spentMs >= allowance.limitMs) throw new Error('The operation active time allowance is exhausted.');
  return { ...allowance, reservation: { owner, startedAtMs: nowMs } };
}

export function remainingActiveTime(value, { owner, nowMs }) {
  const allowance = validateActiveTimeAllowance(value);
  validateOwnerAndClock({ owner, nowMs });
  const elapsedMs = allowance.reservation ? elapsedTime(allowance, { owner, nowMs }) : 0;
  return Math.max(0, allowance.limitMs - allowance.spentMs - elapsedMs);
}

// Call only after owned execution has stopped. An uncertain shutdown leaves the
// reservation intact. Real elapsed overage remains visible in the receipt.
export function settleActiveTime(value, { owner, nowMs }) {
  const allowance = validateActiveTimeAllowance(value);
  const spentMs = allowance.spentMs + elapsedTime(allowance, { owner, nowMs });
  if (!milliseconds(spentMs)) throw new Error('Active time consumption overflowed; preserve the reservation for inspection.');
  return { ...allowance, spentMs, reservation: null };
}
