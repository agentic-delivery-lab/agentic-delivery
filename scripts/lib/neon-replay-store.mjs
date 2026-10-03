import { neon } from '@neondatabase/serverless';

import { DEFAULT_REPLAY_WINDOW_MS, ReplayProtectionError } from './replay-protection.mjs';

export const REPLAY_CLEANUP_BATCH_SIZE = 100;

// Leave the current key to the upsert so expiry reclaim stays atomic with its claim.
const CLAIM_SQL = `
WITH expired_claims AS (
  SELECT replay_key
  FROM public.webhook_replay_claims
  WHERE expires_at <= clock_timestamp()
    AND replay_key <> $1
  ORDER BY expires_at ASC
  LIMIT $2
  FOR UPDATE SKIP LOCKED
), deleted_claims AS (
  DELETE FROM public.webhook_replay_claims AS claims
  USING expired_claims
  WHERE claims.replay_key = expired_claims.replay_key
  RETURNING claims.replay_key
)
INSERT INTO public.webhook_replay_claims AS stored (replay_key, expires_at)
VALUES ($1, clock_timestamp() + ($3::double precision * INTERVAL '1 millisecond'))
ON CONFLICT (replay_key) DO UPDATE
SET expires_at = clock_timestamp() + ($3::double precision * INTERVAL '1 millisecond')
WHERE stored.expires_at <= clock_timestamp()
RETURNING stored.replay_key`;

const RELEASE_SQL = `
DELETE FROM public.webhook_replay_claims
WHERE replay_key = $1`;

function isPooledNeonConnectionString(value) {
  try {
    const url = new URL(value);
    const hostname = url.hostname.toLowerCase();
    const endpoint = hostname.split('.')[0];
    return ['postgres:', 'postgresql:'].includes(url.protocol)
      && ['.neon.tech', '.neon.com'].some((domain) => hostname.endsWith(domain))
      && endpoint.endsWith('-pooler')
      && Boolean(url.username && url.password);
  } catch {
    return false;
  }
}

function storageError() {
  return new ReplayProtectionError('The durable replay database operation failed.');
}

export class NeonReplayStore {
  constructor({ connectionString, client } = {}) {
    if (client) {
      if (typeof client.query !== 'function') throw new ReplayProtectionError('The replay database client is invalid.', 2);
      this.client = client;
      return;
    }
    if (!isPooledNeonConnectionString(connectionString)) {
      throw new ReplayProtectionError('A pooled Neon replay database connection is required.', 2);
    }
    try {
      this.client = neon(connectionString);
    } catch {
      throw new ReplayProtectionError('The pooled Neon replay database configuration is invalid.', 2);
    }
  }

  async claim(key, { ttlMs = DEFAULT_REPLAY_WINDOW_MS } = {}) {
    if (typeof key !== 'string' || key.length === 0) throw new ReplayProtectionError('The replay key is invalid.');
    if (!Number.isFinite(ttlMs) || ttlMs <= 0) throw new ReplayProtectionError('The replay window must be positive.');
    let rows;
    try {
      rows = await this.client.query(CLAIM_SQL, [key, REPLAY_CLEANUP_BATCH_SIZE, ttlMs]);
    } catch {
      throw storageError();
    }
    if (!Array.isArray(rows)) throw storageError();
    return rows.length === 1;
  }

  async release(key) {
    if (typeof key !== 'string' || key.length === 0) throw new ReplayProtectionError('The replay key is invalid.');
    let rows;
    try {
      rows = await this.client.query(RELEASE_SQL, [key]);
    } catch {
      throw storageError();
    }
    if (!Array.isArray(rows)) throw storageError();
  }
}
