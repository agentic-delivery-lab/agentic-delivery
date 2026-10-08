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
gateway signs the complete version-1 envelope with the separate
`AGENTIC_DELIVERY_DISPATCH_SECRET` using HMAC-SHA256, then sends it as the sole
top-level `client_payload.envelope` property. This keeps the payload within
GitHub's limit of 10 top-level properties. The transport wrapper contains
opaque `json` text and a `delivery_id` copy for concurrency. Its decoder
checks that the copied identity matches the signed envelope before restoring
that envelope. Keeping the signed JSON as text prevents transport object-key
reordering from invalidating the existing HMAC. Legacy object wrappers remain
readable during deployment. The invocation and observation
workflows copy the envelope into a per-run event file in the direct shape
expected by the pinned controller readers; those readers validate the original
schema and signature. The
[GitHub REST API reference](https://docs.github.com/en/rest/repos/repos#create-a-repository-dispatch-event)
documents this limit.

Neon stores the five-minute gateway replay window and dispatch lease in
`webhook_replay_claims`. `webhook_controller_receipts` keeps a 30-day status and
lease for controller runs: pending, running, retryable, completed, or
exhausted. The controller claims the receipt before intake, and a final Actions
job records completion only after classification and any selected delivery
workflow finish. The finalizer checks out the same validated controller pin
used for intake before it records completion or retryability. Failed runs become
retryable with backoff. An interrupted run can be reclaimed after its lease
expires while it remains below the attempt limit. Expired final-attempt
receipts are marked exhausted before redelivery selection and are not claimed
again automatically. Actions concurrency keyed by the delivery GUID serializes
repeated dispatches.

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

Apply the first five migrations to the selected Neon database with a direct, unpooled
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
psql "$NEON_DATABASE_URL_UNPOOLED" -v ON_ERROR_STOP=1 \
  -f api/github/migrations/0005-queue-webhook-redeliveries.sql
```

Run them from a protected terminal. Never print the connection string or add
it to source control. All migrations are safe to run more than once. Migration
0006 adds the durable archive and the manual `archived` queue status. Deploy
the queue claim status allowlist before applying any archival disposition.
The Issue #60 operator operation applies migration 0006 in its guarded
transaction; ordinary reconciliation never applies a migration.

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
deploy, or activate the App webhook. Vercel Hobby permits one invocation per
day, while Pro and Enterprise permit per-minute schedules; confirm the project
plan before changing this cadence ([Cron Jobs usage and pricing](https://vercel.com/docs/cron-jobs/usage-and-pricing)).
The webhook function reads `config/participants.yml` at runtime, so the
`vercel.json` function configuration includes that file in its bundle.

## Recovery and monitoring

GitHub does not automatically redeliver failed App webhook deliveries. The
scheduled route creates an App JWT, pages through delivery history, groups
attempts by stable GUID, and requests redelivery when no attempt succeeded.
The App API returns delivery IDs as JSON integers, and current IDs exceed
JavaScript's safe integer range. The reconciler retains each original decimal
number token as a string before comparing, storing, or putting it in a request
URL. Parsing the value through `Number` rounds it and can make GitHub reject a
redelivery with HTTP 404. Any segment in a paginated history scan can replace a
rounded ID at the same timestamp. The observation update and exhausted-row
requeue happen atomically, so a later page cannot replace the repaired ID with
an older attempt. The request waits until the history scan finishes before it
is sent. Reconciliation requeues only when that GUID maps to a different exact
ID and its retry count remains below the limit. It preserves the retry count
and leaves unchanged or unmatched exhausted records for operator diagnosis.
Each run reads at most five 100-delivery pages. If more history remains before
the prior checkpoint, it saves the opaque cursor and accumulated GUID outcomes
for the next run; it does not make history-based retry decisions from a partial
scan. The cursor is resumed until the prior checkpoint is reached. A run that
finishes a scan first records every failed delivery in the durable Neon
redelivery queue. It then requests at most 250 queued or due redeliveries per
invocation. With the current daily schedule, the upper bound is 250 redelivery
API attempts per day, and rate limits or retries can lower actual throughput.
The history checkpoint stays in place while any request is queued, has an
uncertain `requesting` outcome, or is `exhausted`. GitHub acceptance lets the
current scan advance, while the accepted request stays durable for follow-up.
If the eighth accepted attempt's cooldown expires without a successful history
result, the reconciler marks it `exhausted` before its next checkpoint update.
That unresolved row stays durable and blocks further checkpoint progress until
an operator diagnoses the cause and explicitly requeues or archives it.
Exhausted requests have no age-based deletion. An operator must diagnose and
explicitly requeue them when replay is possible; the requeued request stays durable and holds the
checkpoint until GitHub accepts it. If its final accepted attempt does not
produce a successful history result before cooldown expires, it becomes
exhausted again and continues to hold progress.

### Manual disposition of unavailable historical deliveries

An operator may explicitly approve a **webhook delivery archive** when a
complete fresh GitHub history audit establishes that the delivery is unavailable
and no controller receipt is linked to it. Age alone never triggers archiving.
The archive retains the original queue, observation and scan metadata, the
reason, source issue, evidence and manifest SHA-256 digests, operator identity,
implementation commit and Actions run. It contains no webhook body or secret.
The queue row remains as `archived`, preserving its retry counters and delivery
identity. Queue claims, due selection and automatic requeue exclude that state.
It does not hold the checkpoint and does not mean the original work completed.

For the explicitly approved Issue #60 recovery, use `self-hosted-runner-smoke`
with `reconciliation_recovery=preview` and the exact 161-row `recovery_manifest`
saved from evidence run 37762823635. The manifest is protected operator input,
not a checked-in list. Its SHA-256 is
`d16f6bff149ffaabe3e67a324a1a2ff489fe03bff4fb0ad76d7d88424dc84055`.
Both modes require the reviewed implementation on `main`. Preview reads only.
`apply` requires
a fresh complete history scan, unchanged exhausted queue and observation IDs,
one attempt per candidate and no linked receipt. Locks and a single transaction
ensure all 161 dispositions and the stale pagination restart commit together.
A mismatch, timeout or repeated application fails without changing records.
The completed checkpoint and observations remain intact; normal reconciliation
must observe fresh outcomes and advance the checkpoint itself.

After application, verify the archive count and digest, queue status counts and
the scan restart using protected read-only diagnostics. Run reconciliation in
bounded steps and verify checkpoint progress separately. Recover pending
controller receipts with fresh, limited delivery and sufficient runner capacity.
Keep the five-minute signed-envelope window and participant modes unchanged.

For rollback, retain migration 0006 and the archive. After stopping concurrent
reconciliation, review each original `queue_snapshot` before restoring a specific
queue row to `exhausted`; never bulk reset attempt counters or claim success.
Do not restore an opaque historical cursor without auditing its current validity.
Before reverting the queue claim allowlist, restore all `archived` rows to a
blocking status, otherwise older claim code could retry them. The audit survives
normal successful queue completion and checkpoint observation cleanup.

### Controller receipt reconciliation

It also redelivers due controller receipts even when GitHub recorded the
original webhook delivery as successful. Before advancing its checkpoint, the
reconciler links every observed delivery GUID's numeric GitHub API ID to a
matching pending, running, or retryable controller receipt, including receipts
whose retry time has not arrived. The due-receipt query selects only rows that
already have a numeric GitHub delivery ID, so older unlinked rows cannot occupy
the bounded batch or starve linked retries. A later scan can retry a linked
receipt even after its original webhook delivery is older than the history
checkpoint. The reconciler stores a timestamp and delivery ID
checkpoint only after the full bounded scan and after each failed delivery's
redelivery request is accepted. Each invocation claims at
most 250 queued or due requests. Accepted attempts below the limit and
ambiguous `requesting` outcomes remain in Neon and become due again after the
cooldown, even if their original delivery is older than the history checkpoint.
After the eighth accepted attempt, an unresolved delivery becomes `exhausted`
when the cooldown expires. A queued request, an uncertain `requesting` outcome,
or an exhausted request holds the checkpoint. Rate-limited responses use
`Retry-After` or the primary rate-limit reset time when available, in addition
to the 15-minute cooldown. GitHub may report rate limits as HTTP 403 or 429; a
403 is treated as rate-limited when its headers or response message say so.
Other definitive GitHub client errors mark the request `exhausted` and hold the
checkpoint; they do not delete attempt state or retry forever. After fixing the
cause, requeue that delivery explicitly:

```sql
UPDATE public.webhook_redelivery_requests
SET request_status = 'queued',
    attempt_count = 0,
    requested_at = clock_timestamp(),
    next_attempt_at = clock_timestamp()
WHERE delivery_guid = '<delivery-guid>'
  AND request_status = 'exhausted';
```

Confirm that exactly one row was updated. The next scheduled run retries the
request and advances the checkpoint only after GitHub accepts it. Network errors,
5xx responses, timeouts, and rate limits keep the request retryable. The retry
limit is eight attempts. An exhausted request needs operator diagnosis before
a manual retry. `exhausted_redeliveries` counts requests newly exhausted by a
definitive rejection or an unresolved final attempt; `redelivery_queue_pending`
reports queued, uncertain, exhausted, or due final accepted requests that hold
a checkpoint. A run that reports
both `redelivery_requests: 250` and `redelivery_queue_pending: true` has
saturated the per-run batch; any remainder stays durable for the next run.
Escalate if the queue is still pending after two consecutive successful daily
runs or if `exhausted_redeliveries` is nonzero. Before webhook activation,
clear those conditions and confirm that observed failed-delivery volume
remains below the measured capacity. Do not advance the scan checkpoint
manually. Increasing the schedule frequency requires a verified Vercel plan
and a review of GitHub rate-limit behavior.

GitHub documents that primary and secondary REST API limits can return HTTP
403 or 429, and that clients should wait for `Retry-After` or
`X-RateLimit-Reset` when provided ([rate-limit guidance](https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api)).

Check the Vercel function invocation for `/api/cron/reconcile-webhooks` after
each scheduled run. A 200 response reports scanned pages, matched deliveries,
requested redeliveries, and cooldown skips. A 503 means GitHub or Neon failed
and the checkpoint did not advance. In GitHub App settings, inspect recent
webhook deliveries for repeated non-2xx responses. In Neon, monitor receipt
counts by status; `exhausted` controller receipts have reached eight claimed
attempts without durable completion and need operator diagnosis before any
manual retry. Redelivery requests retain an `exhausted` status when GitHub
definitively rejects a request or eight accepted/ambiguous attempts fail to
produce a successful history result by the final cooldown. Operators can
diagnose these separately from transient failures:

The Vercel runtime also emits structured JSON events without webhook payloads
or secret values. `agentic_delivery_webhook` records an accepted delivery
after the controller dispatch succeeds; its `http_status` is the response
returned to GitHub. `agentic_delivery_webhook_reconciler_redelivery` records
the GitHub API result for one redelivery request, including its delivery GUID,
numeric delivery ID, outcome, and HTTP status. An `accepted` redelivery means
GitHub accepted the request to retry; check later delivery history to see
whether that retry succeeded. An outcome ending in `_not_recorded` means GitHub's
result was known but Neon could not save it; `recovery_status` says whether the
request was durably deferred. The run then fails with HTTP 503 and does not
advance its checkpoint. A failed webhook dispatch emits `outcome: failed` with
the gateway response status, a GitHub API status when known, a bounded error
type, an optional sanitized system error code, and the delivery GUID; it
excludes error messages and request contents.
`agentic_delivery_webhook_reconciler_run`
records the Cron endpoint's completed or failed response and its counters.
There, `http_status` is the Vercel endpoint response and `github_api_status`
is the GitHub API response when one is known. Capture these events with the
Vercel request ID and timestamp because runtime-log retention is limited.

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
database where all five migrations have been applied. The live Vercel deployment,
GitHub App credentials, Neon production schema, and scheduled execution remain
unverified until an operator configures and activates them.
