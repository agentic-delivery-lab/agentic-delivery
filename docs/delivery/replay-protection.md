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

Neon stores the five-minute gateway replay window and dispatch lease in
`webhook_replay_claims`. `webhook_controller_receipts` keeps a 30-day status and
lease for controller runs: pending, running, retryable, completed, or
exhausted. The controller claims the receipt before intake, and a final Actions
job records completion only after classification and any selected delivery
workflow finish. The finalizer checks out the same validated controller pin
used for intake before it records completion or retryability. Failed or
interrupted runs become retryable after their lease expires. Actions
concurrency keyed by the delivery GUID serializes repeated dispatches.

`webhook_reconciler_state` holds the completed history checkpoint and any
pending GitHub cursor. A `webhook delivery observation` in
`webhook_reconciler_observations` accumulates one GUID's newest attempt,
whether any attempt succeeded, and its installation ID across five-page run
segments. History-based retry decisions wait until the scan reaches its
previous checkpoint. The observations are deleted atomically when the
checkpoint advances. The tables store delivery identity and coordination
metadata, not webhook bodies, credentials, private keys, or model output.

The reconciler processes at most five 100-delivery pages per run. When it
reaches that bound before the previous checkpoint, it stores the opaque GitHub
pagination cursor and the scan's original high-water mark. The next run resumes
from that cursor. After it reaches the last completed checkpoint, the
reconciler commits the saved high-water mark and clears the cursor; newer
deliveries that arrived during the catch-up scan are found by the next fresh
scan. Each fresh scan overlaps the prior checkpoint by five minutes to include
delivery-history entries that arrive late.

`AGENTIC_DELIVERY_REPLAY_DATABASE_URL` selects the shared Neon store. Use the
same pooled Neon connection string in the Vercel production environment and as
a repository Actions secret in the central controller repository. Its
hostname must include `-pooler`. Do not put this URL in an organization-level
Actions secret: the reusable workflow receives it explicitly from the
controller repository secret.

## Migration and configuration

Apply all four migrations to the selected Neon database with a direct, unpooled
connection before deploying code that uses the new schema:

```sh
psql "$NEON_DATABASE_URL_UNPOOLED" -v ON_ERROR_STOP=1 \
  -f api/github/migrations/0001-webhook-replay-claims.sql
psql "$NEON_DATABASE_URL_UNPOOLED" -v ON_ERROR_STOP=1 \
  -f api/github/migrations/0002-recoverable-webhook-delivery.sql
psql "$NEON_DATABASE_URL_UNPOOLED" -v ON_ERROR_STOP=1 \
  -f api/github/migrations/0003-resumable-webhook-scan.sql
psql "$NEON_DATABASE_URL_UNPOOLED" -v ON_ERROR_STOP=1 \
  -f api/github/migrations/0004-aggregate-webhook-scan-observations.sql
```

Run them from a protected terminal. Never print the connection string or add
it to source control. All migrations are safe to run more than once.

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
Each run reads at most five 100-delivery pages. If more history remains before
the prior checkpoint, it saves the opaque cursor and accumulated GUID outcomes
for the next run; it does not make history-based retry decisions from a partial
scan. The cursor is resumed until the prior checkpoint is reached. A run that
would exceed 1,000 redelivery requests returns 503 and leaves the checkpoint
unchanged.
It also redelivers due controller receipts even when GitHub recorded the
original webhook delivery as successful. Before advancing its checkpoint, the
reconciler links every observed delivery GUID's numeric GitHub API ID to a
matching pending, running, or retryable controller receipt, including receipts
whose retry time has not arrived. The due-receipt query selects only rows that
already have a numeric GitHub delivery ID, so older unlinked rows cannot occupy
the bounded batch or starve linked retries. A later scan can retry a linked
receipt even after its original webhook delivery is older than the history
checkpoint. The reconciler stores a timestamp and delivery ID
checkpoint only after the full bounded scan and after each redelivery request
is accepted, already exhausted, or definitively rejected and recorded. An
ambiguous or transient API failure leaves the checkpoint unchanged, so the
next run rescans safely. Redelivery requests have a 15-minute cooldown to
avoid hammering an uncertain delivery. Each request attempt is retained in
Neon. A definitive GitHub client error (4xx other than 408 or 429) marks the
request `exhausted` and allows the scan checkpoint to advance; it does not
delete the attempt state and retry forever. Network errors, 5xx responses,
timeouts, and rate limits keep the request retryable after the cooldown. The
retry limit is eight attempts. An exhausted request needs operator diagnosis
before a manual retry.

Check the Vercel function invocation for `/api/cron/reconcile-webhooks` after
each scheduled run. A 200 response reports scanned pages, matched deliveries,
requested redeliveries, and cooldown skips. A 503 means GitHub or Neon failed
and the checkpoint did not advance. In GitHub App settings, inspect recent
webhook deliveries for repeated non-2xx responses. In Neon, monitor receipt
counts by status; `exhausted` controller receipts mean eight attempts failed
and need operator diagnosis before any manual retry. Redelivery requests retain
an `exhausted` status when they reach eight attempts or GitHub definitively
rejects the request, so operators can diagnose these separately from transient
failures:

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

If Neon is unavailable, the gateway fails closed. The webhook gateway does not
select file-backed replay state from a configured directory; local file and
in-memory adapters are limited to explicit test or development use. Keep
dispatch disabled until the shared database is restored. To roll back the
controller code, keep the schema in place; the additive migrations are
backward compatible with earlier controller releases.

The optional isolated integration test uses
`AGENTIC_DELIVERY_REPLAY_TEST_DATABASE_URL`. Point it only at a separate Neon
database where all four migrations have been applied. The live Vercel deployment,
GitHub App credentials, Neon production schema, and scheduled execution remain
unverified until an operator configures and activates them.
