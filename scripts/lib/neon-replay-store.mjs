import { randomUUID } from 'node:crypto';
import { neon } from '@neondatabase/serverless';

import { DEFAULT_REPLAY_WINDOW_MS, ReplayProtectionError } from './replay-protection.mjs';

export const REPLAY_CLEANUP_BATCH_SIZE = 100;
export const DEFAULT_DISPATCH_LEASE_MS = 30_000;
export const DEFAULT_CONTROLLER_LEASE_MS = 6 * 60 * 60 * 1000;
export const CONTROLLER_RECEIPT_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
export const CONTROLLER_PENDING_GRACE_MS = 15 * 60 * 1000;
export const CONTROLLER_MAX_ATTEMPTS = 8;
export const REDELIVERY_COOLDOWN_MS = 15 * 60 * 1000;

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
INSERT INTO public.webhook_replay_claims AS stored
  (replay_key, expires_at, dispatch_status, dispatch_lease_expires_at, dispatch_lease_token)
VALUES (
  $1,
  clock_timestamp() + ($3::double precision * INTERVAL '1 millisecond'),
  'dispatching',
  clock_timestamp() + ($4::double precision * INTERVAL '1 millisecond'),
  $5
)
ON CONFLICT (replay_key) DO UPDATE
SET expires_at = clock_timestamp() + ($3::double precision * INTERVAL '1 millisecond'),
    dispatch_status = 'dispatching',
    dispatch_lease_expires_at = clock_timestamp() + ($4::double precision * INTERVAL '1 millisecond'),
    dispatch_lease_token = $5
WHERE stored.expires_at <= clock_timestamp()
   OR (stored.dispatch_status = 'dispatching' AND stored.dispatch_lease_expires_at <= clock_timestamp())
RETURNING stored.replay_key`;

const RELEASE_SQL = `
DELETE FROM public.webhook_replay_claims
WHERE replay_key = $1`;

const MARK_DISPATCHED_SQL = `
UPDATE public.webhook_replay_claims
SET dispatch_status = 'dispatched', dispatch_lease_expires_at = NULL, dispatch_lease_token = NULL
WHERE replay_key = $1 AND dispatch_status = 'dispatching' AND dispatch_lease_token = $2
RETURNING replay_key`;

const ENSURE_RECEIPT_SQL = `
WITH expired_receipts AS (
  SELECT replay_key
  FROM public.webhook_controller_receipts
  WHERE expires_at <= clock_timestamp() AND replay_key <> $1
  ORDER BY expires_at ASC
  LIMIT ${REPLAY_CLEANUP_BATCH_SIZE}
  FOR UPDATE SKIP LOCKED
), deleted_receipts AS (
  DELETE FROM public.webhook_controller_receipts AS receipts
  USING expired_receipts
  WHERE receipts.replay_key = expired_receipts.replay_key
  RETURNING receipts.replay_key
)
INSERT INTO public.webhook_controller_receipts
  (replay_key, status, next_attempt_at, created_at, expires_at)
VALUES (
  $1,
  'pending',
  clock_timestamp(),
  clock_timestamp(),
  clock_timestamp() + ($2::double precision * INTERVAL '1 millisecond')
)
ON CONFLICT (replay_key) DO UPDATE
SET status = CASE
      WHEN webhook_controller_receipts.expires_at <= clock_timestamp() THEN 'pending'
      ELSE webhook_controller_receipts.status
    END,
    lease_expires_at = CASE
      WHEN webhook_controller_receipts.expires_at <= clock_timestamp() THEN NULL
      ELSE webhook_controller_receipts.lease_expires_at
    END,
    lease_token = CASE
      WHEN webhook_controller_receipts.expires_at <= clock_timestamp() THEN NULL
      ELSE webhook_controller_receipts.lease_token
    END,
    next_attempt_at = CASE
      WHEN webhook_controller_receipts.expires_at <= clock_timestamp() THEN clock_timestamp()
      ELSE webhook_controller_receipts.next_attempt_at
    END,
    attempt_count = CASE
      WHEN webhook_controller_receipts.expires_at <= clock_timestamp() THEN 0
      ELSE webhook_controller_receipts.attempt_count
    END,
    created_at = CASE
      WHEN webhook_controller_receipts.expires_at <= clock_timestamp() THEN clock_timestamp()
      ELSE webhook_controller_receipts.created_at
    END,
    expires_at = clock_timestamp() + ($2::double precision * INTERVAL '1 millisecond')
RETURNING replay_key`;

const CLAIM_CONTROLLER_SQL = `
INSERT INTO public.webhook_controller_receipts AS stored
  (replay_key, status, lease_expires_at, lease_token, next_attempt_at, attempt_count, created_at, expires_at)
VALUES (
  $1,
  'running',
  clock_timestamp() + ($2::double precision * INTERVAL '1 millisecond'),
  $4,
  clock_timestamp(),
  1,
  clock_timestamp(),
  clock_timestamp() + ($3::double precision * INTERVAL '1 millisecond')
)
ON CONFLICT (replay_key) DO UPDATE
SET status = 'running',
    lease_expires_at = clock_timestamp() + ($2::double precision * INTERVAL '1 millisecond'),
    lease_token = $4,
    next_attempt_at = clock_timestamp(),
    attempt_count = stored.attempt_count + 1,
    expires_at = clock_timestamp() + ($3::double precision * INTERVAL '1 millisecond')
WHERE stored.status <> 'completed'
  AND stored.status <> 'exhausted'
  AND stored.next_attempt_at <= clock_timestamp()
  AND (stored.status <> 'running' OR stored.lease_expires_at <= clock_timestamp())
RETURNING replay_key`;

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

function validKey(key) {
  if (typeof key !== 'string' || key.length === 0) throw new ReplayProtectionError('The replay key is invalid.');
}

function positiveDuration(value, message) {
  if (!Number.isFinite(value) || value <= 0) throw new ReplayProtectionError(message);
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

  async #query(statement, values) {
    try {
      const rows = await this.client.query(statement, values);
      if (!Array.isArray(rows)) throw storageError();
      return rows;
    } catch {
      throw storageError();
    }
  }

  async claim(key, {
    ttlMs = DEFAULT_REPLAY_WINDOW_MS,
    leaseMs = DEFAULT_DISPATCH_LEASE_MS,
  } = {}) {
    validKey(key);
    positiveDuration(ttlMs, 'The replay window must be positive.');
    positiveDuration(leaseMs, 'The dispatch lease must be positive.');
    const result = await this.claimWithLease(key, { ttlMs, leaseMs });
    return result.claimed;
  }

  async claimWithLease(key, {
    ttlMs = DEFAULT_REPLAY_WINDOW_MS,
    leaseMs = DEFAULT_DISPATCH_LEASE_MS,
  } = {}) {
    validKey(key);
    positiveDuration(ttlMs, 'The replay window must be positive.');
    positiveDuration(leaseMs, 'The dispatch lease must be positive.');
    const leaseToken = randomUUID();
    const rows = await this.#query(CLAIM_SQL, [key, REPLAY_CLEANUP_BATCH_SIZE, ttlMs, leaseMs, leaseToken]);
    return { claimed: rows.length === 1, leaseToken: rows.length === 1 ? leaseToken : null };
  }

  async markDispatched(key, leaseToken) {
    validKey(key);
    if (typeof leaseToken !== 'string' || !/^[0-9a-f-]{36}$/i.test(leaseToken)) throw new ReplayProtectionError('The dispatch lease is invalid.');
    const rows = await this.#query(MARK_DISPATCHED_SQL, [key, leaseToken]);
    if (rows.length !== 1) throw storageError();
  }

  async releaseClaim(key, leaseToken) {
    validKey(key);
    if (typeof leaseToken !== 'string' || !/^[0-9a-f-]{36}$/i.test(leaseToken)) throw new ReplayProtectionError('The dispatch lease is invalid.');
    await this.#query('DELETE FROM public.webhook_replay_claims WHERE replay_key = $1 AND dispatch_lease_token = $2', [key, leaseToken]);
  }

  async release(key) {
    validKey(key);
    await this.#query(RELEASE_SQL, [key]);
  }

  async ensureControllerReceipt(key, { retentionMs = CONTROLLER_RECEIPT_RETENTION_MS } = {}) {
    validKey(key);
    positiveDuration(retentionMs, 'The controller receipt retention must be positive.');
    const rows = await this.#query(ENSURE_RECEIPT_SQL, [key, retentionMs]);
    if (rows.length !== 1) throw storageError();
  }

  async controllerReceipt(key) {
    validKey(key);
    const rows = await this.#query(
      'SELECT status, lease_expires_at, lease_token, next_attempt_at, github_delivery_id, attempt_count FROM public.webhook_controller_receipts WHERE replay_key = $1',
      [key],
    );
    return rows[0] ?? null;
  }

  async claimController(key, { leaseMs = DEFAULT_CONTROLLER_LEASE_MS, retentionMs = CONTROLLER_RECEIPT_RETENTION_MS, leaseToken } = {}) {
    validKey(key);
    positiveDuration(leaseMs, 'The controller lease must be positive.');
    positiveDuration(retentionMs, 'The controller receipt retention must be positive.');
    if (typeof leaseToken !== 'string' || !/^[A-Za-z0-9:._-]{1,128}$/.test(leaseToken)) throw new ReplayProtectionError('The controller lease owner is invalid.');
    const rows = await this.#query(CLAIM_CONTROLLER_SQL, [key, leaseMs, retentionMs, leaseToken]);
    if (rows.length === 1) return { status: 'claimed' };
    const current = await this.controllerReceipt(key);
    if (!current || current.status === 'pending' || current.status === 'retryable') return { status: 'waiting' };
    if (current.status === 'completed' || current.status === 'exhausted') return { status: current.status };
    return { status: 'busy' };
  }

  async completeController(key, { leaseToken } = {}) {
    validKey(key);
    if (typeof leaseToken !== 'string' || !/^[A-Za-z0-9:._-]{1,128}$/.test(leaseToken)) throw new ReplayProtectionError('The controller lease owner is invalid.');
    const rows = await this.#query(
      `UPDATE public.webhook_controller_receipts
       SET status = 'completed', lease_expires_at = NULL, lease_token = NULL, next_attempt_at = clock_timestamp()
       WHERE replay_key = $1 AND status = 'running' AND lease_token = $2
       RETURNING replay_key`,
      [key, leaseToken],
    );
    if (rows.length !== 1) throw storageError();
  }

  async retryController(key, { maxAttempts = CONTROLLER_MAX_ATTEMPTS, baseDelayMs = 60_000, maxDelayMs = 6 * 60 * 60 * 1000, leaseToken } = {}) {
    validKey(key);
    if (typeof leaseToken !== 'string' || !/^[A-Za-z0-9:._-]{1,128}$/.test(leaseToken)) throw new ReplayProtectionError('The controller lease owner is invalid.');
    const rows = await this.#query(
      `UPDATE public.webhook_controller_receipts
       SET status = CASE WHEN attempt_count >= $2 THEN 'exhausted' ELSE 'retryable' END,
           lease_expires_at = NULL,
           lease_token = NULL,
           next_attempt_at = clock_timestamp() + (
             LEAST($4::double precision, $3::double precision * POWER(2, GREATEST(attempt_count - 1, 0)))
             * INTERVAL '1 millisecond'
           )
       WHERE replay_key = $1 AND status = 'running' AND lease_token = $5
       RETURNING replay_key`,
      [key, maxAttempts, baseDelayMs, maxDelayMs, leaseToken],
    );
    if (rows.length !== 1) throw storageError();
  }

  async dueControllerReceipts({ limit = 100, pendingGraceMs = CONTROLLER_PENDING_GRACE_MS } = {}) {
    const rows = await this.#query(
      `SELECT replay_key, status, github_delivery_id, attempt_count
       FROM public.webhook_controller_receipts
       WHERE expires_at > clock_timestamp()
         AND (
           (status = 'pending' AND created_at <= clock_timestamp() - ($2::double precision * INTERVAL '1 millisecond'))
           OR (status = 'retryable' AND next_attempt_at <= clock_timestamp())
           OR (status = 'running' AND lease_expires_at <= clock_timestamp())
         )
       ORDER BY next_attempt_at ASC, created_at ASC
       LIMIT $1`,
      [limit, pendingGraceMs],
    );
    return rows;
  }

  async linkGithubDelivery(key, githubDeliveryId) {
    validKey(key);
    if (!/^[1-9][0-9]*$/.test(String(githubDeliveryId ?? ''))) throw new ReplayProtectionError('The GitHub delivery ID is invalid.');
    await this.#query(
      'UPDATE public.webhook_controller_receipts SET github_delivery_id = $2 WHERE replay_key = $1',
      [key, String(githubDeliveryId)],
    );
  }

  async reconcilerCheckpoint() {
    const rows = await this.#query(
      `SELECT checkpoint_at, checkpoint_delivery_id
       FROM public.webhook_reconciler_state
       WHERE state_key = 'github-app-deliveries'`,
      [],
    );
    return rows[0] ?? null;
  }

  async advanceReconcilerCheckpoint({ deliveredAt, deliveryId }) {
    if (!Number.isFinite(Date.parse(String(deliveredAt ?? ''))) || !/^[1-9][0-9]*$/.test(String(deliveryId ?? ''))) {
      throw new ReplayProtectionError('The reconciler checkpoint is invalid.');
    }
    await this.#query(
      `INSERT INTO public.webhook_reconciler_state
         (state_key, checkpoint_at, checkpoint_delivery_id, updated_at)
       VALUES ('github-app-deliveries', $1::timestamptz, $2, clock_timestamp())
       ON CONFLICT (state_key) DO UPDATE
       SET checkpoint_at = EXCLUDED.checkpoint_at,
           checkpoint_delivery_id = EXCLUDED.checkpoint_delivery_id,
           updated_at = clock_timestamp()
       WHERE (webhook_reconciler_state.checkpoint_at, webhook_reconciler_state.checkpoint_delivery_id)
         <= (EXCLUDED.checkpoint_at, EXCLUDED.checkpoint_delivery_id)`,
      [new Date(deliveredAt).toISOString(), String(deliveryId)],
    );
  }

  async claimRedeliveryRequest(guid, githubDeliveryId, { cooldownMs = REDELIVERY_COOLDOWN_MS } = {}) {
    if (typeof guid !== 'string' || !/^[0-9a-f-]{20,}$/i.test(guid)) throw new ReplayProtectionError('The delivery GUID is invalid.');
    if (!/^[1-9][0-9]*$/.test(String(githubDeliveryId ?? ''))) throw new ReplayProtectionError('The GitHub delivery ID is invalid.');
    positiveDuration(cooldownMs, 'The redelivery cooldown must be positive.');
    const rows = await this.#query(
      `WITH expired_requests AS (
         SELECT delivery_guid
         FROM public.webhook_redelivery_requests
         WHERE requested_at <= clock_timestamp() - INTERVAL '30 days'
           AND delivery_guid <> $1
         ORDER BY requested_at ASC
         LIMIT ${REPLAY_CLEANUP_BATCH_SIZE}
         FOR UPDATE SKIP LOCKED
       ), deleted_requests AS (
         DELETE FROM public.webhook_redelivery_requests AS requests
         USING expired_requests
         WHERE requests.delivery_guid = expired_requests.delivery_guid
         RETURNING requests.delivery_guid
       )
       INSERT INTO public.webhook_redelivery_requests AS stored
         (delivery_guid, requested_at, request_status, github_delivery_id, attempt_count)
       VALUES ($1, clock_timestamp(), 'requesting', $3, 1)
       ON CONFLICT (delivery_guid) DO UPDATE
       SET requested_at = clock_timestamp(), request_status = 'requesting', github_delivery_id = $3,
           attempt_count = stored.attempt_count + 1
       WHERE stored.requested_at <= clock_timestamp() - ($2::double precision * INTERVAL '1 millisecond')
         AND stored.request_status <> 'exhausted'
         AND stored.attempt_count < $4
       RETURNING delivery_guid`,
      [guid.toLowerCase(), cooldownMs, String(githubDeliveryId), CONTROLLER_MAX_ATTEMPTS],
    );
    if (rows.length === 1) return { claimed: true };
    await this.#query(
      `UPDATE public.webhook_redelivery_requests
       SET request_status = 'exhausted'
       WHERE delivery_guid = $1 AND request_status = 'requesting' AND attempt_count >= $2`,
      [guid.toLowerCase(), CONTROLLER_MAX_ATTEMPTS],
    );
    const current = await this.#query(
      'SELECT request_status FROM public.webhook_redelivery_requests WHERE delivery_guid = $1',
      [guid.toLowerCase()],
    );
    return { claimed: false, status: current[0]?.request_status ?? 'unknown' };
  }

  async markRedeliveryAccepted(guid, githubDeliveryId) {
    if (typeof guid !== 'string' || !/^[0-9a-f-]{20,}$/i.test(guid)) throw new ReplayProtectionError('The delivery GUID is invalid.');
    const rows = await this.#query(
      `UPDATE public.webhook_redelivery_requests
       SET request_status = CASE WHEN attempt_count >= $3 THEN 'exhausted' ELSE 'accepted' END,
           requested_at = clock_timestamp(), github_delivery_id = $2
       WHERE delivery_guid = $1 AND request_status = 'requesting'
       RETURNING delivery_guid`,
      [guid.toLowerCase(), String(githubDeliveryId), CONTROLLER_MAX_ATTEMPTS],
    );
    if (rows.length !== 1) throw storageError();
  }

  async dueRedeliveryRequests({ limit = 100 } = {}) {
    return this.#query(
      `SELECT delivery_guid, github_delivery_id, attempt_count
       FROM public.webhook_redelivery_requests
       WHERE request_status = 'accepted'
         AND attempt_count < $2
         AND requested_at <= clock_timestamp() - ($3::double precision * INTERVAL '1 millisecond')
       ORDER BY requested_at ASC
       LIMIT $1`,
      [limit, CONTROLLER_MAX_ATTEMPTS, REDELIVERY_COOLDOWN_MS],
    );
  }

  async completeRedelivery(guid) {
    if (typeof guid !== 'string' || !/^[0-9a-f-]{20,}$/i.test(guid)) throw new ReplayProtectionError('The delivery GUID is invalid.');
    await this.#query('DELETE FROM public.webhook_redelivery_requests WHERE delivery_guid = $1', [guid.toLowerCase()]);
  }

  async releaseRedeliveryRequest(guid) {
    if (typeof guid !== 'string' || !/^[0-9a-f-]{20,}$/i.test(guid)) throw new ReplayProtectionError('The delivery GUID is invalid.');
    await this.#query('DELETE FROM public.webhook_redelivery_requests WHERE delivery_guid = $1', [guid.toLowerCase()]);
  }
}
