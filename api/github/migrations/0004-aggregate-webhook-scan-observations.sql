-- Preserve attempt outcomes across bounded delivery-history scan segments.
CREATE TABLE IF NOT EXISTS public.webhook_reconciler_observations (
  delivery_guid text PRIMARY KEY,
  newest_delivery_at timestamptz NOT NULL,
  newest_delivery_id bigint NOT NULL CHECK (newest_delivery_id > 0),
  has_success boolean NOT NULL DEFAULT false,
  installation_id bigint CHECK (installation_id > 0)
);
