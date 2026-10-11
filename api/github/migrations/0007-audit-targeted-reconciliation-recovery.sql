CREATE TABLE IF NOT EXISTS public.webhook_reconciliation_recoveries (
  run_id text PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  operator_evidence jsonb NOT NULL,
  delivery_guid text NOT NULL,
  reason text NOT NULL CHECK (reason = 'pending_controller_after_stale_dispatch'),
  queue_before jsonb NOT NULL,
  receipt_before jsonb NOT NULL
);
