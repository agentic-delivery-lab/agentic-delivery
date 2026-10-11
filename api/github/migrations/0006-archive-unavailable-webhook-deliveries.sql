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
  -- Older immutable controller pins share this table. Enforce retention here too.
  CREATE OR REPLACE FUNCTION public.preserve_webhook_archive_guard()
    RETURNS trigger LANGUAGE plpgsql AS $guard$
  BEGIN
    IF OLD.request_status = 'archived' THEN
      IF TG_OP = 'DELETE' THEN RETURN NULL; END IF;
      -- Only an explicit operator restoration to exhausted can release the guard.
      IF NEW.request_status NOT IN ('archived', 'exhausted') THEN RETURN NULL; END IF;
    END IF;
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END $guard$;
  DROP TRIGGER IF EXISTS webhook_redelivery_archive_guard ON public.webhook_redelivery_requests;
  CREATE TRIGGER webhook_redelivery_archive_guard
    BEFORE UPDATE OR DELETE ON public.webhook_redelivery_requests
    FOR EACH ROW EXECUTE FUNCTION public.preserve_webhook_archive_guard();
END $$;
