import path from 'node:path';
import { randomUUID } from 'node:crypto';

const DELIVERY_ID = /^[0-9a-f-]{20,}$/i;
const RFC3339 = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/;

function replayFileKey(key) {
  return Buffer.from(String(key), 'utf8').toString('base64url');
}

export const DEFAULT_REPLAY_WINDOW_MS = 5 * 60 * 1000;
export const DEFAULT_FUTURE_SKEW_MS = 30 * 1000;

export class ReplayProtectionError extends Error {
  constructor(message, exitCode = 1) {
    super(message);
    this.name = 'ReplayProtectionError';
    this.exitCode = exitCode;
  }
}

export function validateReceivedAt(receivedAt, {
  now = Date.now(),
  maxAgeMs = DEFAULT_REPLAY_WINDOW_MS,
  maxFutureSkewMs = DEFAULT_FUTURE_SKEW_MS,
} = {}) {
  const value = String(receivedAt ?? '');
  const timestamp = Date.parse(value);
  if (!RFC3339.test(value) || !Number.isFinite(timestamp)) return { valid: false, reason: 'received_at must be an RFC3339 timestamp.' };
  if (!Number.isFinite(now) || !Number.isFinite(maxAgeMs) || maxAgeMs < 0 || !Number.isFinite(maxFutureSkewMs) || maxFutureSkewMs < 0) {
    return { valid: false, reason: 'replay protection timing configuration is invalid.' };
  }
  if (timestamp < now - maxAgeMs) return { valid: false, reason: 'the event envelope is older than the replay window.' };
  if (timestamp > now + maxFutureSkewMs) return { valid: false, reason: 'the event envelope timestamp is too far in the future.' };
  return { valid: true, timestamp };
}

export function replayKey({ installationId, deliveryId } = {}) {
  const installation = String(installationId ?? '');
  const delivery = String(deliveryId ?? '');
  if (!DELIVERY_ID.test(delivery)) throw new ReplayProtectionError('The delivery ID is invalid.');
  if (installation && !/^[1-9][0-9]*$/.test(installation)) throw new ReplayProtectionError('The installation ID is invalid.');
  return `${installation || 'unknown'}:${delivery.toLowerCase()}`;
}

export function controllerRunLeaseToken(env = process.env) {
  const runId = String(env.GITHUB_RUN_ID || 'local');
  const attempt = String(env.GITHUB_RUN_ATTEMPT || '1');
  if (!/^(?:local|[1-9][0-9]*)$/.test(runId) || !/^[1-9][0-9]*$/.test(attempt)) {
    throw new ReplayProtectionError('The controller run identity is invalid.');
  }
  return `${runId}:${attempt}`;
}

export class InMemoryReplayStore {
  #entries = new Map();
  #receipts = new Map();

  constructor({ now = () => Date.now() } = {}) {
    this.now = now;
  }

  #purge(now) {
    for (const [key, entry] of this.#entries) {
      const expiresAt = typeof entry === 'number' ? entry : entry.expiresAt;
      if (expiresAt <= now) this.#entries.delete(key);
    }
  }

  async claim(key, { ttlMs = DEFAULT_REPLAY_WINDOW_MS } = {}) {
    const now = this.now();
    this.#purge(now);
    if (this.#entries.has(key)) return false;
    if (!Number.isFinite(ttlMs) || ttlMs <= 0) throw new ReplayProtectionError('The replay window must be positive.');
    this.#entries.set(key, now + ttlMs);
    return true;
  }

  async release(key) {
    this.#entries.delete(key);
  }

  async claimWithLease(key, options) {
    const { ttlMs = DEFAULT_REPLAY_WINDOW_MS, leaseMs = 30_000 } = options ?? {};
    if (!Number.isFinite(ttlMs) || ttlMs <= 0 || !Number.isFinite(leaseMs) || leaseMs <= 0) throw new ReplayProtectionError('The replay lease must be positive.');
    const now = this.now();
    this.#purge(now);
    const existing = this.#entries.get(key);
    const dispatchCanResume = existing && typeof existing === 'object'
      && existing.dispatchStatus === 'dispatching'
      && existing.leaseExpiresAt <= now;
    if (existing && !dispatchCanResume) {
      return {
        claimed: false,
        leaseToken: null,
        status: typeof existing === 'object' ? existing.dispatchStatus : 'unknown',
        leaseActive: typeof existing === 'object' && existing.dispatchStatus === 'dispatching' && existing.leaseExpiresAt > now,
      };
    }
    const leaseToken = randomUUID();
    this.#entries.set(key, {
      expiresAt: now + ttlMs,
      dispatchStatus: 'dispatching',
      leaseExpiresAt: now + leaseMs,
      leaseToken,
    });
    return { claimed: true, leaseToken };
  }

  async markDispatched(key, leaseToken) {
    const entry = this.#entries.get(key);
    if (entry && typeof entry === 'object' && entry.leaseToken === leaseToken) {
      entry.dispatchStatus = 'dispatched';
      entry.leaseExpiresAt = null;
      entry.leaseToken = null;
    }
  }

  async releaseClaim(key, leaseToken) {
    const entry = this.#entries.get(key);
    if (entry && typeof entry === 'object' && entry.leaseToken === leaseToken) this.#entries.delete(key);
  }

  async ensureControllerReceipt(key) {
    if (!this.#receipts.has(key)) this.#receipts.set(key, { status: 'pending', leaseExpiresAt: null, attempts: 0 });
  }

  async controllerReceipt(key) {
    return this.#receipts.get(key) ?? null;
  }

  async claimController(key, { leaseMs = 6 * 60 * 60 * 1000, leaseToken = randomUUID() } = {}) {
    await this.ensureControllerReceipt(key);
    const receipt = this.#receipts.get(key);
    if (receipt.status === 'completed' || receipt.status === 'exhausted') return { status: receipt.status };
    if (receipt.status === 'running' && receipt.leaseExpiresAt > this.now()) return { status: 'busy' };
    if (receipt.nextAttemptAt > this.now()) return { status: 'waiting' };
    receipt.status = 'running';
    receipt.leaseExpiresAt = this.now() + leaseMs;
    receipt.leaseToken = leaseToken;
    receipt.attempts += 1;
    return { status: 'claimed' };
  }

  async completeController(key, { leaseToken } = {}) {
    const receipt = this.#receipts.get(key);
    if (!receipt || receipt.status !== 'running' || (leaseToken && receipt.leaseToken !== leaseToken)) throw new ReplayProtectionError('The controller receipt could not be completed.');
    receipt.status = 'completed';
    receipt.leaseExpiresAt = null;
    receipt.leaseToken = null;
  }

  async retryController(key, { maxAttempts = 8, baseDelayMs = 60_000, maxDelayMs = 6 * 60 * 60 * 1000, leaseToken } = {}) {
    const receipt = this.#receipts.get(key);
    if (!receipt || receipt.status !== 'running' || (leaseToken && receipt.leaseToken !== leaseToken)) throw new ReplayProtectionError('The controller receipt could not be released.');
    receipt.status = receipt.attempts >= maxAttempts ? 'exhausted' : 'retryable';
    receipt.leaseExpiresAt = null;
    receipt.leaseToken = null;
    receipt.nextAttemptAt = this.now() + Math.min(maxDelayMs, baseDelayMs * (2 ** Math.max(0, receipt.attempts - 1)));
  }
}

/**
 * A small, atomic file-backed store for a single gateway process or a shared
 * filesystem. Production deployments with multiple stateless instances must
 * provide an equivalent durable claim store rather than relying on memory.
 */
export class FileReplayStore {
  constructor({ directory, now = () => Date.now() } = {}) {
    if (!directory || typeof directory !== 'string') throw new ReplayProtectionError('A replay state directory is required.', 2);
    this.directory = directory;
    this.now = now;
  }

  async claim(key, { ttlMs = DEFAULT_REPLAY_WINDOW_MS } = {}) {
    if (!Number.isFinite(ttlMs) || ttlMs <= 0) throw new ReplayProtectionError('The replay window must be positive.');
    const { mkdir, open, readFile, unlink } = await import('node:fs/promises');
    const path = await import('node:path');
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    const safeKey = replayFileKey(key);
    const marker = path.join(this.directory, `${safeKey}.json`);
    const expiresAt = this.now() + ttlMs;
    try {
      const handle = await open(marker, 'wx', 0o600);
      try {
        await handle.writeFile(JSON.stringify({ key, expiresAt }));
      } finally {
        await handle.close();
      }
      return true;
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      try {
        const record = JSON.parse(await readFile(marker, 'utf8'));
        if (Number(record.expiresAt) <= this.now()) {
          await unlink(marker);
          return this.claim(key, { ttlMs });
        }
      } catch (readError) {
        if (readError.code === 'ENOENT') return this.claim(key, { ttlMs });
      }
      return false;
    }
  }

  async release(key) {
    const { unlink } = await import('node:fs/promises');
    const path = await import('node:path');
    const safeKey = replayFileKey(key);
    try { await unlink(path.join(this.directory, `${safeKey}.json`)); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }

  async claimWithLease(key, options) {
    const claimed = await this.claim(key, options);
    return { claimed, leaseToken: claimed ? randomUUID() : null };
  }

  async releaseClaim(key) {
    await this.release(key);
  }

  #receiptPath(key) {
    const safeKey = replayFileKey(key);
    return path.join(this.directory, `${safeKey}.receipt.json`);
  }

  async #readReceipt(key) {
    const { readFile } = await import('node:fs/promises');
    try { return JSON.parse(await readFile(this.#receiptPath(key), 'utf8')); }
    catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  }

  async #writeReceipt(key, receipt) {
    const { mkdir, rename, writeFile } = await import('node:fs/promises');
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    const target = this.#receiptPath(key);
    const temporary = path.join(this.directory, `${path.basename(target)}.${process.pid}.${Date.now()}.tmp`);
    await writeFile(temporary, JSON.stringify(receipt), { mode: 0o600 });
    await rename(temporary, target);
  }

  async markDispatched() {}

  async ensureControllerReceipt(key) {
    if (!await this.#readReceipt(key)) {
      await this.#writeReceipt(key, { status: 'pending', leaseExpiresAt: null, attempts: 0, nextAttemptAt: 0 });
    }
  }

  async controllerReceipt(key) {
    return this.#readReceipt(key);
  }

  async claimController(key, { leaseMs = 6 * 60 * 60 * 1000, leaseToken = randomUUID() } = {}) {
    await this.ensureControllerReceipt(key);
    const receipt = await this.#readReceipt(key);
    if (receipt.status === 'completed' || receipt.status === 'exhausted') return { status: receipt.status };
    if (receipt.status === 'running' && Number(receipt.leaseExpiresAt) > this.now()) return { status: 'busy' };
    if (Number(receipt.nextAttemptAt) > this.now()) return { status: 'waiting' };
    receipt.status = 'running';
    receipt.leaseExpiresAt = this.now() + leaseMs;
    receipt.leaseToken = leaseToken;
    receipt.attempts = Number(receipt.attempts ?? 0) + 1;
    await this.#writeReceipt(key, receipt);
    return { status: 'claimed' };
  }

  async completeController(key, { leaseToken } = {}) {
    const receipt = await this.#readReceipt(key);
    if (!receipt || receipt.status !== 'running' || (leaseToken && receipt.leaseToken !== leaseToken)) throw new ReplayProtectionError('The controller receipt could not be completed.');
    receipt.status = 'completed';
    receipt.leaseExpiresAt = null;
    receipt.leaseToken = null;
    await this.#writeReceipt(key, receipt);
  }

  async retryController(key, { maxAttempts = 8, baseDelayMs = 60_000, maxDelayMs = 6 * 60 * 60 * 1000, leaseToken } = {}) {
    const receipt = await this.#readReceipt(key);
    if (!receipt || receipt.status !== 'running' || (leaseToken && receipt.leaseToken !== leaseToken)) throw new ReplayProtectionError('The controller receipt could not be released.');
    receipt.status = Number(receipt.attempts) >= maxAttempts ? 'exhausted' : 'retryable';
    receipt.leaseExpiresAt = null;
    receipt.leaseToken = null;
    receipt.nextAttemptAt = this.now() + Math.min(maxDelayMs, baseDelayMs * (2 ** Math.max(0, Number(receipt.attempts) - 1)));
    await this.#writeReceipt(key, receipt);
  }
}

export async function claimDelivery(store, {
  installationId,
  deliveryId,
  ttlMs = DEFAULT_REPLAY_WINDOW_MS,
} = {}) {
  if (!store || typeof store.claim !== 'function') throw new ReplayProtectionError('A replay claim store is required.', 2);
  return store.claim(replayKey({ installationId, deliveryId }), { ttlMs });
}

export async function releaseDelivery(store, { installationId, deliveryId, leaseToken } = {}) {
  if (!store || typeof store.release !== 'function') return;
  const key = replayKey({ installationId, deliveryId });
  if (leaseToken && typeof store.releaseClaim === 'function') return store.releaseClaim(key, leaseToken);
  return store.release(key);
}
