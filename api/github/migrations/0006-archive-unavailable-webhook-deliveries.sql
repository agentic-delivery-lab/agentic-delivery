-- Explicit operator disposition only; ordinary reconciliation never archives.
DO $$ BEGIN
  CREATE TABLE IF NOT EXISTS public.webhook_redelivery_archive (
    delivery_guid text PRIMARY KEY,
    archived_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    reason text NOT NULL CHECK (reason = 'history_unavailable_after_id_precision_failure'),
    queue_snapshot jsonb NOT NULL,
    observation_snapshot jsonb NOT NULL,
    scan_snapshot jsonb NOT NULL,
    operator_evidence jsonb NOT NULL
  );
  ALTER TABLE public.webhook_redelivery_requests
    DROP CONSTRAINT IF EXISTS webhook_redelivery_requests_status_check;
  ALTER TABLE public.webhook_redelivery_requests
    ADD CONSTRAINT webhook_redelivery_requests_status_check
    CHECK (request_status IN ('queued', 'requesting', 'accepted', 'exhausted', 'archived'));
END $$;
