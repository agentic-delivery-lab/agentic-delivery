-- Store only the installation/delivery replay key and its expiry.
CREATE TABLE IF NOT EXISTS public.webhook_replay_claims (
  replay_key text PRIMARY KEY,
  expires_at timestamptz NOT NULL
);

CREATE INDEX IF NOT EXISTS webhook_replay_claims_expires_at_idx
  ON public.webhook_replay_claims (expires_at);
