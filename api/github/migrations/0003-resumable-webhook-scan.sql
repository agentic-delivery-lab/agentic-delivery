-- Preserve a bounded pagination cursor when one scheduled scan cannot reach
-- the previously completed checkpoint within its per-run page limit.
ALTER TABLE public.webhook_reconciler_state
  ADD COLUMN IF NOT EXISTS scan_cursor text,
  ADD COLUMN IF NOT EXISTS scan_high_water_at timestamptz,
  ADD COLUMN IF NOT EXISTS scan_high_water_delivery_id bigint;

DO $$ BEGIN
  ALTER TABLE public.webhook_reconciler_state
    ADD CONSTRAINT webhook_reconciler_state_scan_progress_check
    CHECK (
      (scan_cursor IS NULL AND scan_high_water_at IS NULL AND scan_high_water_delivery_id IS NULL)
      OR (scan_cursor IS NOT NULL AND scan_high_water_at IS NOT NULL AND scan_high_water_delivery_id IS NOT NULL)
    );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
