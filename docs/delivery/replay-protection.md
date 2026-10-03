# Webhook delivery replay protection

The organization webhook treats the GitHub delivery ID as an idempotency key.
The claim is made only after the signed event, participant registry, event
catalogue, origin token, and actor authorization have passed, and immediately
before the central `repository_dispatch` mutation.

The gateway carries `received_at` in the envelope. The central preflight
accepts a compatible legacy envelope without that field, but validates a
present timestamp against the five-minute replay window and a thirty-second
future clock-skew allowance. New webhook deliveries always include it.

The gateway also signs the complete `repository_dispatch` client payload with
the separate `AGENTIC_DELIVERY_DISPATCH_SECRET` using HMAC-SHA256. The
signature covers the immutable envelope after removing only the signature
field, and `dispatch_timestamp` is checked against the same five-minute replay
window (with a thirty-second future-skew allowance) by the central preflight.
The dispatch secret is held only by the central gateway and controller
workflow; it is never sent to an origin repository, Codex model process, or
untrusted primitive. `CODEX_DELIVERY_DISPATCH_SECRET` is the explicitly named
Actions secret used by the controller workflow.

Duplicate deliveries return a successful non-dispatch response and cannot
create a second controller run. If dispatch fails after the claim, the gateway
releases the claim so GitHub can retry the same delivery. Runner-local markers
remain a second, origin-scoped idempotency boundary; they are not a replacement
for gateway protection.

`AGENTIC_DELIVERY_REPLAY_DATABASE_URL` selects the Neon-backed claim store.
Set it to a pooled Neon connection string whose endpoint hostname includes
`-pooler`. The handler uses the `@neondatabase/serverless` HTTP driver and one
parameterized SQL statement for each claim. A primary key and atomic upsert
allow only one concurrent claim; an expired claim can be replaced using the
database clock. Each claim also removes at most 100 other expired rows, so
cleanup is bounded and does not need a separate scheduled job.

Before setting this runtime secret, apply
[`api/github/migrations/0001-webhook-replay-claims.sql`](../../api/github/migrations/0001-webhook-replay-claims.sql)
to the selected Neon database using a direct, unpooled connection. The
migration creates only the replay key and expiry columns, plus an expiry
index. It is safe to run more than once. For example, from a protected local
terminal with `psql` installed:

```sh
psql "$NEON_DATABASE_URL_UNPOOLED" -v ON_ERROR_STOP=1 \
  -f api/github/migrations/0001-webhook-replay-claims.sql
```

Do not print the connection string or add it to source control. The gateway
does not log database errors or credentials.

`AGENTIC_DELIVERY_REPLAY_STATE_DIRECTORY` remains available for a single
process or a shared filesystem. When both settings are present, the Neon
database is selected. A multi-instance deployment must not rely on a local
function filesystem. The process-local memory store is intended for tests and
explicitly isolated single-process operation only. The default handler fails
closed when no durable store or injected adapter is available. Tests may set
`AGENTIC_DELIVERY_ALLOW_EPHEMERAL_REPLAY=true`; that flag is not a production
fallback.

For rollout, apply the migration first, then configure the protected runtime
secret with the pooled URL, and deploy through the separately approved
deployment process. Confirm a controlled duplicate delivery is rejected and
that a failed dispatch can be retried. This code change does not configure the
secret or activate the production webhook.

If Neon is unavailable, the handler fails closed and GitHub can retry. A
rollback to file-backed state is safe only when the deployed gateway uses one
process or a shared filesystem. On a multi-instance deployment, restore a
previously verified shared store or keep dispatch disabled until Neon is
available; local function storage is not a safe rollback target.

Replay rows contain only the installation/delivery key and expiry. They do
not contain App private keys, installation tokens, issue bodies, or model
output. The optional integration test uses
`AGENTIC_DELIVERY_REPLAY_TEST_DATABASE_URL`; point it only at an isolated Neon
database where this migration has already been applied.

The gateway also binds every supported event to the configured organization
login, numeric organization ID, and App installation ID before it mints an
origin-scoped token. The organization defaults identify
`agentic-delivery-lab` (`327861320`), but the App installation ID has no
runtime default and must be supplied by the protected deployment environment
through `AGENTIC_DELIVERY_APP_INSTALLATION_ID`. Operators must verify the
organization values and installation ID against the live App installation
before promotion. A missing or mismatched installation is rejected before
actor authorization or dispatch.

The dispatch token is independently narrowed to the configured numeric
Control-Plane repository ID (`AGENTIC_DELIVERY_CONTROLLER_REPOSITORY_ID`).
That value has no runtime default: a deployment that omits it fails closed
before it can mint an installation token or dispatch an event.
The origin token and dispatch token therefore have separate repository scopes;
the App installation's broader selected-repository access is not exposed to
either API call.

The central Actions preflight repeats the installation and organization
identity checks when those envelope fields and controller configuration are
present, verifies the dispatch HMAC and timestamp, then resolves the origin
full name from the numeric participant registry entry. A forged or misrouted
dispatch therefore cannot redirect the run by changing only the readable
repository name.
