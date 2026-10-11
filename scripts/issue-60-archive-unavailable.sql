-- This transaction-local function is not a new production API.
CREATE OR REPLACE FUNCTION pg_temp.archive_issue_60_deliveries(
  manifest jsonb, evidence jsonb, expected_updated_at timestamptz
) RETURNS integer LANGUAGE plpgsql AS $$
DECLARE
  matched integer;
  saved_scan jsonb;
BEGIN
  -- Keep the verified snapshot stable through disposition and scan restart.
  LOCK TABLE public.webhook_reconciler_state,
    public.webhook_reconciler_observations,
    public.webhook_redelivery_requests,
    public.webhook_controller_receipts IN ACCESS EXCLUSIVE MODE;
  SELECT to_jsonb(s) INTO saved_scan
    FROM public.webhook_reconciler_state s
    WHERE state_key = 'github-app-deliveries' AND updated_at = expected_updated_at;
  IF saved_scan IS NULL OR jsonb_array_length(manifest) <> 161 THEN
    RAISE EXCEPTION 'Recovery snapshot changed or manifest is invalid';
  END IF;
  SELECT count(*) INTO matched
    FROM jsonb_to_recordset(manifest) AS m(delivery_guid text, stored_delivery_id text,
      observed_delivery_id text, observation_installation_id text)
    JOIN public.webhook_redelivery_requests q USING (delivery_guid)
    JOIN public.webhook_reconciler_observations o USING (delivery_guid)
    WHERE q.request_status = 'exhausted' AND q.attempt_count = 1
      AND q.github_delivery_id::text = m.stored_delivery_id
      AND o.newest_delivery_id::text = m.observed_delivery_id
      AND o.installation_id::text = m.observation_installation_id
      AND NOT o.has_success
      AND NOT EXISTS (SELECT 1 FROM public.webhook_controller_receipts c
        WHERE split_part(c.replay_key, ':', 2) = q.delivery_guid)
      AND NOT EXISTS (SELECT 1 FROM public.webhook_redelivery_archive a
        WHERE a.delivery_guid = q.delivery_guid);
  IF matched <> 161 THEN
    RAISE EXCEPTION 'Recovery candidates changed; no disposition applied';
  END IF;
  INSERT INTO public.webhook_redelivery_archive
    (delivery_guid, reason, queue_snapshot, observation_snapshot, scan_snapshot, operator_evidence)
    SELECT q.delivery_guid, 'history_unavailable_after_id_precision_failure',
      to_jsonb(q), to_jsonb(o), saved_scan, evidence
    FROM jsonb_to_recordset(manifest) AS m(delivery_guid text)
    JOIN public.webhook_redelivery_requests q USING (delivery_guid)
    JOIN public.webhook_reconciler_observations o USING (delivery_guid);
  UPDATE public.webhook_redelivery_requests q SET request_status = 'archived'
    FROM jsonb_to_recordset(manifest) AS m(delivery_guid text)
    WHERE q.delivery_guid = m.delivery_guid;
  GET DIAGNOSTICS matched = ROW_COUNT;
  IF matched <> 161 THEN RAISE EXCEPTION 'Recovery disposition count changed'; END IF;
  -- Retain the completed checkpoint and observations. Restart only pagination.
  UPDATE public.webhook_reconciler_state
    SET scan_cursor = NULL, scan_high_water_at = NULL,
      scan_high_water_delivery_id = NULL, updated_at = clock_timestamp()
    WHERE state_key = 'github-app-deliveries' AND updated_at = expected_updated_at;
  IF NOT FOUND THEN RAISE EXCEPTION 'Recovery scan restart failed'; END IF;
  RETURN matched;
END $$;
