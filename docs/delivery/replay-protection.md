# Webhook delivery replay protection

The organization webhook treats the GitHub delivery GUID as an idempotency key.
The claim is made after signature, organization, installation, participant,
event, origin token, and actor checks pass. A short dispatch lease protects the
`repository_dispatch` mutation. The lease has an owner token, so an expired
request cannot complete or release a newer request's claim.

The gateway carries `received_at` in the envelope. The central preflight
accepts a compatible legacy envelope without that field, but validates a
present timestamp against the five-minute replay window and a thirty-second
future clock-skew allowance. New webhook deliveries always include it. The
gateway also signs the complete `repository_dispatch` client payload with the
separate `AGENTIC_DELIVERY_DISPATCH_SECRET` using HMAC-SHA256.

The Neon store keeps two small state boundaries. `webhook_replay_claims` keeps
the five-minute gateway replay window, dispatch state, and lease. The separate
`webhook_controller_receipts` table keeps a 30-day status and lease for the
controller run: pending, running, retryable, completed, or exhausted. The
controller claims the receipt before intake, and a final Actions job records
completion only after classification and any selected delivery workflow
finish. Failed or interrupted runs become retryable after their lease expires.
Actions concurrency keyed by the delivery GUID serializes repeated dispatches.
Neither table stores webhook bodies, credentials, private keys, or model
output.

`AGENTIC_DELIVERY_REPLAY_DATABASE_URL` selects the shared Neon store. Use the
same pooled Neon connection string in the Vercel production environment and as
a repository Actions secret in the central controller repository. Its
hostname must include `-pooler`. Do not put this URL in an organization-level
Actions secret: the reusable workflow receives it explicitly from the
controller repository secret.

## Migration and configuration

Apply both migrations to the selected Neon database with a direct, unpooled
connection before deploying code that uses the new schema:

```sh
psql "$NEON_DATABASE_URL_UNPOOLED" -v ON_ERROR_STOP=1 \
  -f api/github/migrations/0001-webhook-replay-claims.sql
psql "$NEON_DATABASE_URL_UNPOOLED" -v ON_ERROR_STOP=1 \
  -f api/github/migrations/0002-recoverable-webhook-delivery.sql
```

Run them from a protected terminal. Never print the connection string or add
it to source control. Both migrations are safe to run more than once.

Configure these protected values before production activation:

| Store | Name | Purpose |
| --- | --- | --- |
| Vercel production | `AGENTIC_DELIVERY_REPLAY_DATABASE_URL` | Shared webhook and controller receipt state |
| Controller repository Actions secret | `AGENTIC_DELIVERY_REPLAY_DATABASE_URL` | Lets the controller claim and complete its receipt |
| Vercel production | `CRON_SECRET` | Bearer authentication for the scheduled reconciler |
| Vercel production | `AGENTIC_DELIVERY_APP_ID` or `CODEX_DELIVERY_APP_ID` | Signs an App JWT for webhook delivery APIs |
| Vercel production | `AGENTIC_DELIVERY_APP_PRIVATE_KEY` or `CODEX_DELIVERY_APP_PRIVATE_KEY` | Signs an App JWT; never place it in Actions workflow inputs |

The existing `ISSUE_FIELD_BINDINGS_JSON` value is a separate controller
repository Actions secret used by intake. It is not an organization-level
setting. The scheduled reconciler runs daily at 00:00 UTC through Vercel Cron;
Vercel supplies `Authorization: Bearer $CRON_SECRET` to the route. A Hobby plan
supports this daily schedule. The Cron route is deployed as code by
`vercel.json`; this repository change does not set secrets, apply migrations,
deploy, or activate the App webhook.

## Recovery and monitoring

GitHub does not automatically redeliver failed App webhook deliveries. The
scheduled route creates an App JWT, pages through delivery history, groups
attempts by stable GUID, and requests redelivery when no attempt succeeded.
Its first scan reads the available delivery history. Each scan is capped at 100
pages and 1,000 redelivery requests; hitting either cap returns 503 and leaves
the checkpoint unchanged instead of silently truncating the scan.
It also redelivers due controller receipts even when GitHub recorded the
original webhook delivery as successful. The reconciler stores a timestamp
and delivery ID checkpoint only after the full bounded scan and all accepted
redelivery requests complete. A failed API call leaves the checkpoint
unchanged, so the next run rescans safely. Redelivery requests have a
15-minute cooldown to avoid hammering an uncertain delivery.

Check the Vercel function invocation for `/api/cron/reconcile-webhooks` after
each scheduled run. A 200 response reports scanned pages, matched deliveries,
requested redeliveries, and cooldown skips. A 503 means GitHub or Neon failed
and the checkpoint did not advance. In GitHub App settings, inspect recent
webhook deliveries for repeated non-2xx responses. In Neon, monitor receipt
counts by status; `exhausted` means eight controller attempts failed and needs
operator diagnosis before any manual retry. Redelivery requests also stop after
eight attempts and retain an `exhausted` status for diagnosis:

```sql
SELECT status, count(*)
FROM public.webhook_controller_receipts
WHERE expires_at > clock_timestamp()
GROUP BY status
ORDER BY status;
```

```sql
SELECT request_status, count(*)
FROM public.webhook_redelivery_requests
GROUP BY request_status
ORDER BY request_status;
```

If Neon is unavailable, the gateway fails closed. A rollback to file-backed
state is safe only for one process or a shared filesystem. A multi-instance
deployment must keep dispatch disabled until the shared database is restored;
local function storage cannot preserve these semantics. To roll back the
controller code, keep the schema in place; the additive migration is backward
compatible with the earlier claim-only adapter.

The optional isolated integration test uses
`AGENTIC_DELIVERY_REPLAY_TEST_DATABASE_URL`. Point it only at a separate Neon
database where both migrations have been applied. The live Vercel deployment,
GitHub App credentials, Neon production schema, and scheduled execution remain
unverified until an operator configures and activates them.
