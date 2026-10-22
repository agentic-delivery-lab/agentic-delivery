-- Source-only proposal. Apply only through a separately admitted migration.
-- No expiry or replay cleanup may reset a software operation's consumption.
CREATE TABLE IF NOT EXISTS public.delivery_operation_budgets (
  operation_id uuid PRIMARY KEY,
  origin_repository_id bigint NOT NULL CHECK (origin_repository_id > 0),
  source_issue_number integer NOT NULL CHECK (source_issue_number > 0),
  controller_commit text NOT NULL CHECK (controller_commit ~ '^[0-9a-f]{40}$'),
  policy_sha256 text NOT NULL CHECK (policy_sha256 ~ '^[0-9a-f]{64}$'),
  context_sha256 text NOT NULL CHECK (context_sha256 ~ '^[0-9a-f]{64}$'),
  runtime_sha256 text NOT NULL CHECK (runtime_sha256 ~ '^[0-9a-f]{64}$'),
  model_turns integer NOT NULL CHECK (model_turns BETWEEN 0 AND 8),
  validation_attempts integer NOT NULL CHECK (validation_attempts BETWEEN 0 AND 3),
  controller_attempts integer NOT NULL CHECK (controller_attempts BETWEEN 0 AND 8),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (origin_repository_id, source_issue_number)
);

CREATE TABLE IF NOT EXISTS public.delivery_operation_reservations (
  operation_id uuid NOT NULL REFERENCES public.delivery_operation_budgets(operation_id),
  request_key text NOT NULL CHECK (request_key ~ '^[0-9a-f]{64}$'),
  resource text NOT NULL CHECK (resource IN ('model', 'validation', 'controller')),
  receipt_replay_key text NOT NULL,
  lease_token text NOT NULL,
  workflow_run_id text NOT NULL,
  workflow_run_attempt integer NOT NULL CHECK (workflow_run_attempt > 0),
  reserved_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (operation_id, request_key)
);
REVOKE ALL ON public.delivery_operation_budgets FROM PUBLIC;
REVOKE ALL ON public.delivery_operation_reservations FROM PUBLIC;
