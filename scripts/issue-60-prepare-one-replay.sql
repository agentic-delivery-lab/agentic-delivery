WITH candidates AS MATERIALIZED (
  SELECT q.delivery_guid, to_jsonb(q) AS queue_before, to_jsonb(c) AS receipt_before
  FROM public.webhook_redelivery_requests q JOIN public.webhook_controller_receipts c ON c.replay_key = $1
  WHERE q.delivery_guid = $2 AND q.request_status IN ('queued', 'exhausted')
    AND q.github_delivery_id::text = $3 AND c.github_delivery_id::text = $3
    AND c.status IN ('pending', 'retryable') AND c.attempt_count < 8 AND c.expires_at > clock_timestamp()
  FOR UPDATE OF q, c
), audited AS (
  INSERT INTO public.webhook_reconciliation_recoveries(run_id, operator_evidence, delivery_guid, reason, queue_before, receipt_before)
  SELECT $4, $5::jsonb, delivery_guid, 'pending_controller_after_stale_dispatch', queue_before, receipt_before FROM candidates
  RETURNING delivery_guid
)
UPDATE public.webhook_redelivery_requests q SET request_status = 'queued',
  attempt_count = CASE WHEN q.request_status = 'exhausted' AND q.attempt_count >= 8 THEN 0 ELSE q.attempt_count END,
  requested_at = clock_timestamp(), next_attempt_at = clock_timestamp()
FROM audited WHERE q.delivery_guid = audited.delivery_guid RETURNING q.delivery_guid;
