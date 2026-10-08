import { randomUUID } from 'node:crypto';
import { neon } from '@neondatabase/serverless';

import {
  DEFAULT_CONTROLLER_MAX_ATTEMPTS,
  DEFAULT_REPLAY_WINDOW_MS,
  ReplayProtectionError,
} from './replay-protection.mjs';

export const REPLAY_CLEANUP_BATCH_SIZE = 100;
export const DEFAULT_DISPATCH_LEASE_MS = 30_000;
export const DEFAULT_CONTROLLER_LEASE_MS = 6 * 60 * 60 * 1000;
export const CONTROLLER_RECEIPT_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
export const CONTROLLER_PENDING_GRACE_MS = 15 * 60 * 1000;
export const CONTROLLER_MAX_ATTEMPTS = DEFAULT_CONTROLLER_MAX_ATTEMPTS;
export const REDELIVERY_COOLDOWN_MS = 15 * 60 * 1000;
const MAX_GITHUB_DELIVERY_LINKS = 10_000;

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
SET status = CASE WHEN stored.attempt_count >= $5 THEN 'exhausted' ELSE 'running' END,
    lease_expires_at = CASE
      WHEN stored.attempt_count >= $5 THEN NULL
      ELSE clock_timestamp() + ($2::double precision * INTERVAL '1 millisecond')
    END,
    lease_token = CASE WHEN stored.attempt_count >= $5 THEN NULL ELSE $4 END,
    next_attempt_at = clock_timestamp(),
    attempt_count = CASE
      WHEN stored.attempt_count >= $5 THEN stored.attempt_count
      ELSE stored.attempt_count + 1
    END,
    expires_at = clock_timestamp() + ($3::double precision * INTERVAL '1 millisecond')
WHERE stored.status <> 'completed'
  AND stored.status <> 'exhausted'
  AND stored.next_attempt_at <= clock_timestamp()
  AND (stored.status <> 'running' OR stored.lease_expires_at <= clock_timestamp())
RETURNING stored.status`;

const EXHAUST_EXPIRED_CONTROLLER_RECEIPTS_SQL = `
WITH expired_receipts AS (
  SELECT replay_key
  FROM public.webhook_controller_receipts
  WHERE status = 'running'
    AND lease_expires_at <= clock_timestamp()
    AND attempt_count >= $1
  ORDER BY lease_expires_at ASC
  LIMIT ${REPLAY_CLEANUP_BATCH_SIZE}
  FOR UPDATE SKIP LOCKED
)
UPDATE public.webhook_controller_receipts AS receipts
SET status = 'exhausted', lease_expires_at = NULL, lease_token = NULL, next_attempt_at = clock_timestamp()
FROM expired_receipts
WHERE receipts.replay_key = expired_receipts.replay_key
RETURNING receipts.replay_key`;

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
    if (rows.length === 1) return { claimed: true, leaseToken, status: 'dispatching', leaseActive: true };
    const existing = await this.#query(
      `SELECT dispatch_status,
              dispatch_status = 'dispatching' AND dispatch_lease_expires_at > clock_timestamp() AS lease_active
       FROM public.webhook_replay_claims
       WHERE replay_key = $1`,
      [key],
    );
    return {
      claimed: false,
      leaseToken: null,
      status: existing[0]?.dispatch_status ?? 'unknown',
      leaseActive: existing[0]?.lease_active === true,
    };
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
    const rows = await this.#query(CLAIM_CONTROLLER_SQL, [key, leaseMs, retentionMs, leaseToken, CONTROLLER_MAX_ATTEMPTS]);
    if (rows.length === 1) return { status: rows[0].status === 'exhausted' ? 'exhausted' : 'claimed' };
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
    if (!Number.isSafeInteger(maxAttempts) || maxAttempts < 1) throw new ReplayProtectionError('The controller attempt limit must be a positive integer.');
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
    await this.#query(EXHAUST_EXPIRED_CONTROLLER_RECEIPTS_SQL, [CONTROLLER_MAX_ATTEMPTS]);
    const rows = await this.#query(
      `SELECT replay_key, status, github_delivery_id, attempt_count
       FROM public.webhook_controller_receipts
       WHERE expires_at > clock_timestamp()
         AND github_delivery_id IS NOT NULL
         AND (
           (status = 'pending' AND created_at <= clock_timestamp() - ($2::double precision * INTERVAL '1 millisecond'))
           OR (status = 'retryable' AND next_attempt_at <= clock_timestamp())
           OR (status = 'running' AND lease_expires_at <= clock_timestamp() AND attempt_count < $3)
       )
       ORDER BY next_attempt_at ASC, created_at ASC
       LIMIT $1`,
      [limit, pendingGraceMs, CONTROLLER_MAX_ATTEMPTS],
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

  async linkGithubDeliveries(deliveries) {
    if (!Array.isArray(deliveries) || deliveries.length > MAX_GITHUB_DELIVERY_LINKS) {
      throw new ReplayProtectionError('The GitHub delivery link batch is invalid.');
    }
    const links = deliveries.map((delivery) => {
      const replayKey = delivery?.replayKey;
      const githubDeliveryId = delivery?.githubDeliveryId;
      validKey(replayKey);
      if (!/^[1-9][0-9]*$/.test(String(githubDeliveryId ?? ''))) throw new ReplayProtectionError('The GitHub delivery ID is invalid.');
      return { replay_key: replayKey, github_delivery_id: String(githubDeliveryId) };
    });
    if (links.length === 0) return 0;
    const rows = await this.#query(
      `UPDATE public.webhook_controller_receipts AS receipts
       SET github_delivery_id = deliveries.github_delivery_id
       FROM jsonb_to_recordset($1::jsonb) AS deliveries(replay_key text, github_delivery_id bigint)
       WHERE receipts.replay_key = deliveries.replay_key
         AND receipts.status IN ('pending', 'running', 'retryable')
         AND receipts.github_delivery_id IS DISTINCT FROM deliveries.github_delivery_id
       RETURNING receipts.replay_key`,
      [JSON.stringify(links)],
    );
    return rows.length;
  }

  async reconcilerCheckpoint() {
    const rows = await this.#query(
      `SELECT checkpoint_at, checkpoint_delivery_id, scan_cursor, scan_high_water_at, scan_high_water_delivery_id
       FROM public.webhook_reconciler_state
       WHERE state_key = 'github-app-deliveries'`,
      [],
    );
    return rows[0] ?? null;
  }

  async mergeReconcilerObservations(observations, {
    expectedCursor = null,
    expectedCheckpointAt = null,
    expectedCheckpointDeliveryId = null,
    refreshEqualTimestampDeliveryIds = false,
  } = {}) {
    if (!Array.isArray(observations)) throw new ReplayProtectionError('The webhook scan observations are invalid.');
    if (typeof refreshEqualTimestampDeliveryIds !== 'boolean') throw new ReplayProtectionError('The webhook delivery ID refresh option is invalid.');
    if (observations.length === 0) return 0;
    if (expectedCursor !== null && (typeof expectedCursor !== 'string' || !expectedCursor || expectedCursor.length > 4096 || /[\u0000-\u001f\u007f]/.test(expectedCursor))) {
      throw new ReplayProtectionError('The expected webhook scan cursor is invalid.');
    }
    if ((expectedCheckpointAt === null) !== (expectedCheckpointDeliveryId === null)
      || (expectedCheckpointAt !== null && (!Number.isFinite(Date.parse(String(expectedCheckpointAt))) || !/^[1-9][0-9]*$/.test(String(expectedCheckpointDeliveryId))))) {
      throw new ReplayProtectionError('The expected webhook checkpoint is invalid.');
    }
    const normalized = observations.map((item) => {
      const guid = String(item?.guid ?? '').toLowerCase();
      const deliveryId = String(item?.deliveryId ?? '');
      if (!/^[0-9a-f-]{20,}$/.test(guid)
        || !Number.isFinite(Date.parse(String(item?.deliveredAt ?? '')))
        || !/^[1-9][0-9]*$/.test(deliveryId)
        || typeof item?.hasSuccess !== 'boolean'
        || (item.installationId != null && !/^[1-9][0-9]*$/.test(String(item.installationId)))) {
        throw new ReplayProtectionError('A webhook scan observation is invalid.');
      }
      return {
        guid,
        delivered_at: new Date(item.deliveredAt).toISOString(),
        delivery_id: deliveryId,
        has_success: item.hasSuccess,
        installation_id: item.installationId == null ? null : String(item.installationId),
      };
    });
    const rows = await this.#query(
      `WITH locked_state AS MATERIALIZED (
         SELECT state_key, scan_cursor, checkpoint_at, checkpoint_delivery_id
         FROM public.webhook_reconciler_state
         WHERE state_key = 'github-app-deliveries'
         FOR UPDATE
       ), scan_state AS (
         SELECT state_key
         FROM locked_state
         WHERE scan_cursor IS NOT DISTINCT FROM $2
           AND checkpoint_at IS NOT DISTINCT FROM $3::timestamptz
           AND checkpoint_delivery_id IS NOT DISTINCT FROM $4::bigint
         UNION ALL
         SELECT 'github-app-deliveries'
         WHERE $2::text IS NULL
           AND $3::timestamptz IS NULL
           AND $4::bigint IS NULL
           AND NOT EXISTS (SELECT 1 FROM locked_state)
       ), incoming AS (
         SELECT guid, delivered_at::timestamptz AS delivered_at,
                delivery_id::bigint AS delivery_id, has_success,
                installation_id::bigint AS installation_id
         FROM jsonb_to_recordset($1::jsonb) AS item(
           guid text, delivered_at text, delivery_id text,
           has_success boolean, installation_id text
         )
       ), updated_observations AS (
         INSERT INTO public.webhook_reconciler_observations AS stored
           (delivery_guid, newest_delivery_at, newest_delivery_id, has_success, installation_id)
         SELECT incoming.guid, incoming.delivered_at, incoming.delivery_id,
                incoming.has_success, incoming.installation_id
         FROM incoming CROSS JOIN scan_state
         ON CONFLICT (delivery_guid) DO UPDATE
         SET newest_delivery_at = CASE
               WHEN (stored.newest_delivery_at, stored.newest_delivery_id)
                    < (EXCLUDED.newest_delivery_at, EXCLUDED.newest_delivery_id)
                    OR ($5::boolean
                      AND stored.newest_delivery_at = EXCLUDED.newest_delivery_at
                      AND EXISTS (
                        SELECT 1
                        FROM public.webhook_redelivery_requests AS retry
                        WHERE retry.delivery_guid = stored.delivery_guid
                          AND retry.request_status = 'exhausted'
                          AND retry.github_delivery_id IS DISTINCT FROM EXCLUDED.newest_delivery_id
                          AND retry.attempt_count < $6
                      ))
               THEN EXCLUDED.newest_delivery_at ELSE stored.newest_delivery_at END,
             newest_delivery_id = CASE
               WHEN (stored.newest_delivery_at, stored.newest_delivery_id)
                    < (EXCLUDED.newest_delivery_at, EXCLUDED.newest_delivery_id)
                    OR ($5::boolean
                      AND stored.newest_delivery_at = EXCLUDED.newest_delivery_at
                      AND EXISTS (
                        SELECT 1
                        FROM public.webhook_redelivery_requests AS retry
                        WHERE retry.delivery_guid = stored.delivery_guid
                          AND retry.request_status = 'exhausted'
                          AND retry.github_delivery_id IS DISTINCT FROM EXCLUDED.newest_delivery_id
                          AND retry.attempt_count < $6
                      ))
               THEN EXCLUDED.newest_delivery_id ELSE stored.newest_delivery_id END,
             has_success = stored.has_success OR EXCLUDED.has_success,
             installation_id = COALESCE(stored.installation_id, EXCLUDED.installation_id)
         WHERE stored.installation_id IS NULL
            OR EXCLUDED.installation_id IS NULL
            OR stored.installation_id = EXCLUDED.installation_id
         RETURNING delivery_guid, newest_delivery_at, newest_delivery_id
       ), repaired_requests AS (
         UPDATE public.webhook_redelivery_requests AS retry
         SET request_status = 'queued',
             requested_at = clock_timestamp(),
             github_delivery_id = observed.newest_delivery_id,
             next_attempt_at = clock_timestamp()
         FROM updated_observations AS observed
         WHERE $5::boolean
           AND retry.delivery_guid = observed.delivery_guid
           AND retry.request_status = 'exhausted'
           AND retry.github_delivery_id IS DISTINCT FROM observed.newest_delivery_id
           AND retry.attempt_count < $6
           AND EXISTS (
             SELECT 1
             FROM incoming
             WHERE incoming.guid = observed.delivery_guid
               AND incoming.delivered_at = observed.newest_delivery_at
               AND incoming.delivery_id = observed.newest_delivery_id
           )
         RETURNING retry.delivery_guid
       )
       SELECT observed.delivery_guid
       FROM updated_observations AS observed
       LEFT JOIN repaired_requests USING (delivery_guid)`,
      [JSON.stringify(normalized), expectedCursor, expectedCheckpointAt, expectedCheckpointDeliveryId, refreshEqualTimestampDeliveryIds, CONTROLLER_MAX_ATTEMPTS],
    );
    if (rows.length !== normalized.length) throw storageError();
    return rows.length;
  }

  async reconcilerObservations() {
    return this.#query(
      `SELECT delivery_guid, newest_delivery_at, newest_delivery_id, has_success, installation_id
       FROM public.webhook_reconciler_observations
       ORDER BY delivery_guid`,
      [],
    );
  }

  async saveReconcilerScan({ cursor, highWaterAt, highWaterDeliveryId, expectedCursor = null, expectedCheckpointAt = null, expectedCheckpointDeliveryId = null }) {
    const scanCursor = String(cursor ?? '');
    const highWaterTimestamp = Date.parse(String(highWaterAt ?? ''));
    if (!scanCursor || scanCursor.length > 4096 || /[\u0000-\u001f\u007f]/.test(scanCursor)) {
      throw new ReplayProtectionError('The webhook scan cursor is invalid.');
    }
    if (!Number.isFinite(highWaterTimestamp) || !/^[1-9][0-9]*$/.test(String(highWaterDeliveryId ?? ''))) {
      throw new ReplayProtectionError('The webhook scan high-water mark is invalid.');
    }
    if (expectedCursor !== null && (typeof expectedCursor !== 'string' || !expectedCursor || expectedCursor.length > 4096 || /[\u0000-\u001f\u007f]/.test(expectedCursor))) {
      throw new ReplayProtectionError('The expected webhook scan cursor is invalid.');
    }
    if ((expectedCheckpointAt === null) !== (expectedCheckpointDeliveryId === null)
      || (expectedCheckpointAt !== null && (!Number.isFinite(Date.parse(String(expectedCheckpointAt))) || !/^[1-9][0-9]*$/.test(String(expectedCheckpointDeliveryId))))) {
      throw new ReplayProtectionError('The expected webhook checkpoint is invalid.');
    }
    const rows = await this.#query(
      `INSERT INTO public.webhook_reconciler_state
         (state_key, checkpoint_at, checkpoint_delivery_id, scan_cursor, scan_high_water_at, scan_high_water_delivery_id, updated_at)
       VALUES ('github-app-deliveries', $4::timestamptz, $5::bigint, $1, $2::timestamptz, $3::bigint, clock_timestamp())
       ON CONFLICT (state_key) DO UPDATE
       SET scan_cursor = EXCLUDED.scan_cursor,
           scan_high_water_at = EXCLUDED.scan_high_water_at,
           scan_high_water_delivery_id = EXCLUDED.scan_high_water_delivery_id,
           updated_at = clock_timestamp()
       WHERE webhook_reconciler_state.scan_cursor IS NOT DISTINCT FROM $6
         AND webhook_reconciler_state.checkpoint_at IS NOT DISTINCT FROM $4::timestamptz
         AND webhook_reconciler_state.checkpoint_delivery_id IS NOT DISTINCT FROM $5::bigint
       RETURNING state_key`,
      [scanCursor, new Date(highWaterTimestamp).toISOString(), String(highWaterDeliveryId), expectedCheckpointAt, expectedCheckpointDeliveryId, expectedCursor],
    );
    if (rows.length !== 1) throw storageError();
  }

  async advanceReconcilerCheckpoint({ deliveredAt, deliveryId, expectedCursor = null, expectedCheckpointAt = null, expectedCheckpointDeliveryId = null }) {
    if (!Number.isFinite(Date.parse(String(deliveredAt ?? ''))) || !/^[1-9][0-9]*$/.test(String(deliveryId ?? ''))) {
      throw new ReplayProtectionError('The reconciler checkpoint is invalid.');
    }
    if (expectedCursor !== null && (typeof expectedCursor !== 'string' || !expectedCursor || expectedCursor.length > 4096 || /[\u0000-\u001f\u007f]/.test(expectedCursor))) {
      throw new ReplayProtectionError('The expected webhook scan cursor is invalid.');
    }
    if ((expectedCheckpointAt === null) !== (expectedCheckpointDeliveryId === null)
      || (expectedCheckpointAt !== null && (!Number.isFinite(Date.parse(String(expectedCheckpointAt))) || !/^[1-9][0-9]*$/.test(String(expectedCheckpointDeliveryId))))) {
      throw new ReplayProtectionError('The expected webhook checkpoint is invalid.');
    }
    const rows = await this.#query(
      `WITH advanced AS (
       INSERT INTO public.webhook_reconciler_state
         (state_key, checkpoint_at, checkpoint_delivery_id, updated_at)
       VALUES ('github-app-deliveries', $1::timestamptz, $2, clock_timestamp())
       ON CONFLICT (state_key) DO UPDATE
       SET checkpoint_at = CASE
             WHEN webhook_reconciler_state.checkpoint_at IS NULL
               OR (webhook_reconciler_state.checkpoint_at, webhook_reconciler_state.checkpoint_delivery_id)
                 <= (EXCLUDED.checkpoint_at, EXCLUDED.checkpoint_delivery_id)
             THEN EXCLUDED.checkpoint_at ELSE webhook_reconciler_state.checkpoint_at END,
           checkpoint_delivery_id = CASE
             WHEN webhook_reconciler_state.checkpoint_at IS NULL
               OR (webhook_reconciler_state.checkpoint_at, webhook_reconciler_state.checkpoint_delivery_id)
                 <= (EXCLUDED.checkpoint_at, EXCLUDED.checkpoint_delivery_id)
             THEN EXCLUDED.checkpoint_delivery_id ELSE webhook_reconciler_state.checkpoint_delivery_id END,
           scan_cursor = NULL,
           scan_high_water_at = NULL,
           scan_high_water_delivery_id = NULL,
           updated_at = clock_timestamp()
       WHERE webhook_reconciler_state.scan_cursor IS NOT DISTINCT FROM $3
         AND webhook_reconciler_state.checkpoint_at IS NOT DISTINCT FROM $4::timestamptz
         AND webhook_reconciler_state.checkpoint_delivery_id IS NOT DISTINCT FROM $5::bigint
       RETURNING state_key
       ), cleared AS (
         DELETE FROM public.webhook_reconciler_observations
         WHERE EXISTS (SELECT 1 FROM advanced)
         RETURNING delivery_guid
       )
       SELECT state_key FROM advanced`,
      [new Date(deliveredAt).toISOString(), String(deliveryId), expectedCursor, expectedCheckpointAt, expectedCheckpointDeliveryId],
    );
    if (rows.length !== 1) throw storageError();
  }

  async claimRedeliveryRequest(guid, githubDeliveryId, { cooldownMs = REDELIVERY_COOLDOWN_MS } = {}) {
    if (typeof guid !== 'string' || !/^[0-9a-f-]{20,}$/i.test(guid)) throw new ReplayProtectionError('The delivery GUID is invalid.');
    if (!/^[1-9][0-9]*$/.test(String(githubDeliveryId ?? ''))) throw new ReplayProtectionError('The GitHub delivery ID is invalid.');
    positiveDuration(cooldownMs, 'The redelivery cooldown must be positive.');
    const rows = await this.#query(
      `INSERT INTO public.webhook_redelivery_requests AS stored
         (delivery_guid, requested_at, request_status, github_delivery_id, attempt_count, next_attempt_at)
       VALUES ($1, clock_timestamp(), 'requesting', $3, 1, clock_timestamp() + ($2::double precision * INTERVAL '1 millisecond'))
       ON CONFLICT (delivery_guid) DO UPDATE
       SET requested_at = clock_timestamp(), request_status = 'requesting', github_delivery_id = $3,
           attempt_count = stored.attempt_count + 1,
           next_attempt_at = clock_timestamp() + ($2::double precision * INTERVAL '1 millisecond')
       WHERE (stored.request_status = 'queued' OR stored.next_attempt_at <= clock_timestamp())
         AND stored.request_status IN ('queued', 'requesting', 'accepted')
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
       SET request_status = 'accepted',
           requested_at = clock_timestamp(), github_delivery_id = $2,
           next_attempt_at = clock_timestamp() + ($3::double precision * INTERVAL '1 millisecond')
       WHERE delivery_guid = $1 AND request_status = 'requesting'
       RETURNING delivery_guid`,
      [guid.toLowerCase(), String(githubDeliveryId), REDELIVERY_COOLDOWN_MS],
    );
    if (rows.length !== 1) throw storageError();
  }

  async queueRedeliveryRequests(requests) {
    if (!Array.isArray(requests)) throw new ReplayProtectionError('The redelivery queue batch is invalid.');
    const unique = new Map();
    for (const request of requests) {
      const guid = request?.guid;
      const githubDeliveryId = String(request?.githubDeliveryId ?? '');
      if (typeof guid !== 'string' || !/^[0-9a-f-]{20,}$/i.test(guid)) throw new ReplayProtectionError('The delivery GUID is invalid.');
      if (!/^[1-9][0-9]*$/.test(githubDeliveryId)) throw new ReplayProtectionError('The GitHub delivery ID is invalid.');
      unique.set(guid.toLowerCase(), githubDeliveryId);
    }
    const entries = [...unique.entries()];
    for (let offset = 0; offset < entries.length; offset += 500) {
      const batch = entries.slice(offset, offset + 500);
      await this.#query(
        `INSERT INTO public.webhook_redelivery_requests AS stored
           (delivery_guid, requested_at, request_status, github_delivery_id, attempt_count, next_attempt_at)
         SELECT candidates.delivery_guid, clock_timestamp(), 'queued', candidates.github_delivery_id, 0, clock_timestamp()
         FROM unnest($1::text[], $2::bigint[]) AS candidates(delivery_guid, github_delivery_id)
         ON CONFLICT (delivery_guid) DO UPDATE
         SET request_status = CASE
               WHEN stored.request_status = 'exhausted' THEN 'queued'
               ELSE stored.request_status END,
             requested_at = CASE
               WHEN stored.request_status = 'exhausted' THEN clock_timestamp()
               ELSE stored.requested_at END,
             github_delivery_id = EXCLUDED.github_delivery_id,
             next_attempt_at = CASE
               WHEN stored.request_status = 'exhausted' THEN clock_timestamp()
               ELSE stored.next_attempt_at END
         WHERE stored.request_status = 'queued'
            OR (stored.request_status = 'exhausted'
              AND stored.github_delivery_id IS DISTINCT FROM EXCLUDED.github_delivery_id
              AND stored.attempt_count < $3)`,
        [batch.map(([guid]) => guid), batch.map(([, deliveryId]) => deliveryId), CONTROLLER_MAX_ATTEMPTS],
      );
    }
  }

  async dueRedeliveryRequests({ limit = 100, includeQueued = true } = {}) {
    if (typeof includeQueued !== 'boolean') throw new ReplayProtectionError('The queued redelivery selection option is invalid.');
    return this.#query(
      `SELECT delivery_guid, github_delivery_id, attempt_count
       FROM public.webhook_redelivery_requests
       WHERE (($3::boolean AND request_status = 'queued')
         OR (request_status IN ('accepted', 'requesting') AND next_attempt_at <= clock_timestamp()))
         AND attempt_count < $2
       ORDER BY next_attempt_at ASC, requested_at ASC
       LIMIT $1`,
      [limit, CONTROLLER_MAX_ATTEMPTS, includeQueued],
    );
  }

  async exhaustExpiredRedeliveryRequests() {
    const rows = await this.#query(
      `WITH exhausted_requests AS (
         SELECT delivery_guid
         FROM public.webhook_redelivery_requests
         WHERE request_status IN ('requesting', 'accepted')
           AND attempt_count >= $1
           AND next_attempt_at <= clock_timestamp()
         ORDER BY next_attempt_at ASC
         LIMIT ${REPLAY_CLEANUP_BATCH_SIZE}
         FOR UPDATE SKIP LOCKED
       ), updated_requests AS (
         UPDATE public.webhook_redelivery_requests AS requests
         SET request_status = 'exhausted'
         FROM exhausted_requests
         WHERE requests.delivery_guid = exhausted_requests.delivery_guid
         RETURNING requests.delivery_guid
       )
       SELECT delivery_guid FROM updated_requests`,
      [CONTROLLER_MAX_ATTEMPTS],
    );
    return rows.length;
  }

  async hasPendingRedeliveryRequests() {
    const rows = await this.#query(
      `SELECT delivery_guid
       FROM public.webhook_redelivery_requests
       WHERE request_status IN ('queued', 'requesting', 'exhausted')
          OR (request_status = 'accepted'
            AND attempt_count >= $1
            AND next_attempt_at <= clock_timestamp())
       LIMIT 1`,
      [CONTROLLER_MAX_ATTEMPTS],
    );
    return rows.length > 0;
  }

  async completeRedelivery(guid) {
    if (typeof guid !== 'string' || !/^[0-9a-f-]{20,}$/i.test(guid)) throw new ReplayProtectionError('The delivery GUID is invalid.');
    await this.#query("DELETE FROM public.webhook_redelivery_requests WHERE delivery_guid = $1 AND request_status <> 'archived'", [guid.toLowerCase()]);
  }

  async markRedeliveryRejected(guid, githubDeliveryId) {
    if (typeof guid !== 'string' || !/^[0-9a-f-]{20,}$/i.test(guid)) throw new ReplayProtectionError('The delivery GUID is invalid.');
    if (!/^[1-9][0-9]*$/.test(String(githubDeliveryId ?? ''))) throw new ReplayProtectionError('The GitHub delivery ID is invalid.');
    const rows = await this.#query(
      `UPDATE public.webhook_redelivery_requests
       SET request_status = 'exhausted', requested_at = clock_timestamp(), github_delivery_id = $2
       WHERE delivery_guid = $1 AND request_status = 'requesting'
       RETURNING delivery_guid`,
      [guid.toLowerCase(), String(githubDeliveryId)],
    );
    if (rows.length !== 1) throw storageError();
  }

  async deferRedeliveryRequest(guid, githubDeliveryId, retryAfterAt = null) {
    if (typeof guid !== 'string' || !/^[0-9a-f-]{20,}$/i.test(guid)) throw new ReplayProtectionError('The delivery GUID is invalid.');
    if (!/^[1-9][0-9]*$/.test(String(githubDeliveryId ?? ''))) throw new ReplayProtectionError('The GitHub delivery ID is invalid.');
    if (retryAfterAt !== null && !Number.isFinite(Date.parse(String(retryAfterAt)))) throw new ReplayProtectionError('The redelivery retry time is invalid.');
    const rows = await this.#query(
      `UPDATE public.webhook_redelivery_requests
       SET requested_at = clock_timestamp(), github_delivery_id = $2,
           request_status = CASE WHEN attempt_count >= $5 THEN 'exhausted' ELSE 'requesting' END,
           next_attempt_at = GREATEST(
             clock_timestamp() + ($3::double precision * INTERVAL '1 millisecond'),
             COALESCE($4::timestamptz, '-infinity'::timestamptz)
           )
       WHERE delivery_guid = $1 AND request_status = 'requesting'
       RETURNING delivery_guid`,
      [guid.toLowerCase(), String(githubDeliveryId), REDELIVERY_COOLDOWN_MS, retryAfterAt, CONTROLLER_MAX_ATTEMPTS],
    );
    if (rows.length !== 1) throw storageError();
  }
}
