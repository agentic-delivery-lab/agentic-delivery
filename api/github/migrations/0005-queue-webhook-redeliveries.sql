-- Queue failed deliveries durably before advancing the history checkpoint.
ALTER TABLE public.webhook_redelivery_requests
  ADD COLUMN IF NOT EXISTS next_attempt_at timestamptz;

UPDATE public.webhook_redelivery_requests
SET next_attempt_at = requested_at + INTERVAL '15 minutes'
WHERE next_attempt_at IS NULL
  AND request_status IN ('requesting', 'accepted');

UPDATE public.webhook_redelivery_requests
SET next_attempt_at = requested_at
WHERE next_attempt_at IS NULL;

UPDATE public.webhook_redelivery_requests
SET request_status = 'exhausted'
WHERE request_status = 'requesting'
  AND attempt_count >= 8
  AND next_attempt_at <= clock_timestamp();

ALTER TABLE public.webhook_redelivery_requests
  ALTER COLUMN next_attempt_at SET NOT NULL,
  ALTER COLUMN next_attempt_at SET DEFAULT clock_timestamp();

ALTER TABLE public.webhook_redelivery_requests
  DROP CONSTRAINT IF EXISTS webhook_redelivery_requests_status_check;

ALTER TABLE public.webhook_redelivery_requests
  ADD CONSTRAINT webhook_redelivery_requests_status_check
  CHECK (request_status IN ('queued', 'requesting', 'accepted', 'exhausted'));

CREATE INDEX IF NOT EXISTS webhook_redelivery_requests_next_attempt_idx
  ON public.webhook_redelivery_requests (next_attempt_at, requested_at)
  WHERE request_status IN ('queued', 'requesting', 'accepted');
