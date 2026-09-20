const DELIVERY_ID = /^[0-9a-f-]{20,}$/i;
const RFC3339 = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/;

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

export class InMemoryReplayStore {
  #entries = new Map();

  constructor({ now = () => Date.now() } = {}) {
    this.now = now;
  }

  #purge(now) {
    for (const [key, expiresAt] of this.#entries) if (expiresAt <= now) this.#entries.delete(key);
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
    const safeKey = key.replace(/[^A-Za-z0-9_.:-]/g, '_');
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
    const safeKey = key.replace(/[^A-Za-z0-9_.:-]/g, '_');
    try { await unlink(path.join(this.directory, `${safeKey}.json`)); } catch (error) { if (error.code !== 'ENOENT') throw error; }
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

export async function releaseDelivery(store, { installationId, deliveryId } = {}) {
  if (!store || typeof store.release !== 'function') return;
  return store.release(replayKey({ installationId, deliveryId }));
}
