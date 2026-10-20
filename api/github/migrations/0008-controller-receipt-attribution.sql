ALTER TABLE public.webhook_controller_receipts
  ADD COLUMN IF NOT EXISTS origin_repository text,
  ADD COLUMN IF NOT EXISTS origin_repository_id bigint,
  ADD COLUMN IF NOT EXISTS source_issue_number integer,
  ADD COLUMN IF NOT EXISTS controller_commit text,
  ADD COLUMN IF NOT EXISTS workflow_run_id text,
  ADD COLUMN IF NOT EXISTS workflow_run_attempt integer;

DO $$ BEGIN
  ALTER TABLE public.webhook_controller_receipts
    ADD CONSTRAINT webhook_controller_receipts_identity_check
    CHECK (
      (
        origin_repository IS NULL
        AND origin_repository_id IS NULL
        AND source_issue_number IS NULL
        AND controller_commit IS NULL
        AND workflow_run_id IS NULL
        AND workflow_run_attempt IS NULL
      )
      OR (
        origin_repository IS NOT NULL
        AND origin_repository_id IS NOT NULL
        AND source_issue_number IS NOT NULL
        AND controller_commit IS NOT NULL
        AND workflow_run_id IS NOT NULL
        AND workflow_run_attempt IS NOT NULL
        AND
        origin_repository ~ '^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$'
        AND origin_repository_id > 0
        AND source_issue_number > 0
        AND controller_commit ~ '^[0-9A-Fa-f]{40}$'
        AND workflow_run_id ~ '^(local|[1-9][0-9]*)$'
        AND workflow_run_attempt > 0
      )
    );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
