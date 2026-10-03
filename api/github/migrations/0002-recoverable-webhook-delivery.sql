-- Add dispatch lease state while retaining existing active claims as dispatched.
ALTER TABLE public.webhook_replay_claims
  ADD COLUMN IF NOT EXISTS dispatch_status text NOT NULL DEFAULT 'dispatched',
  ADD COLUMN IF NOT EXISTS dispatch_lease_expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS dispatch_lease_token text;

DO $$ BEGIN
  ALTER TABLE public.webhook_replay_claims
    ADD CONSTRAINT webhook_replay_claims_dispatch_status_check
    CHECK (dispatch_status IN ('pending', 'dispatching', 'dispatched'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS public.webhook_controller_receipts (
  replay_key text PRIMARY KEY,
  status text NOT NULL DEFAULT 'pending',
  lease_expires_at timestamptz,
  lease_token text,
  next_attempt_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  github_delivery_id bigint,
  attempt_count integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  expires_at timestamptz NOT NULL
);

DO $$ BEGIN
  ALTER TABLE public.webhook_controller_receipts
    ADD CONSTRAINT webhook_controller_receipts_status_check
    CHECK (status IN ('pending', 'running', 'retryable', 'completed', 'exhausted'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS webhook_controller_receipts_retry_idx
  ON public.webhook_controller_receipts (next_attempt_at, created_at)
  WHERE status IN ('pending', 'retryable', 'running');

CREATE TABLE IF NOT EXISTS public.webhook_reconciler_state (
  state_key text PRIMARY KEY,
  checkpoint_at timestamptz,
  checkpoint_delivery_id bigint,
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE IF NOT EXISTS public.webhook_redelivery_requests (
  delivery_guid text PRIMARY KEY,
  requested_at timestamptz NOT NULL,
  request_status text NOT NULL DEFAULT 'requesting',
  github_delivery_id bigint,
  attempt_count integer NOT NULL DEFAULT 0
);

DO $$ BEGIN
  ALTER TABLE public.webhook_redelivery_requests
    ADD CONSTRAINT webhook_redelivery_requests_status_check
    CHECK (request_status IN ('requesting', 'accepted', 'exhausted'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS webhook_redelivery_requests_requested_at_idx
  ON public.webhook_redelivery_requests (requested_at);

-- The tables contain delivery identity and bounded state only. They never hold
-- webhook payloads, credentials, private keys, or model output.
