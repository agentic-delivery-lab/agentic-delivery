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

`AGENTIC_DELIVERY_REPLAY_STATE_DIRECTORY` selects the file-backed claim store.
It is suitable only for a single process or a shared filesystem. A
multi-instance deployment must provide an equivalent durable atomic claim
store through the `replayStore` adapter before activation; a process-local
memory store is intended for tests and explicitly isolated single-process
operation only. The default handler fails closed when neither a durable
directory nor an injected adapter is available. Tests may set
`AGENTIC_DELIVERY_ALLOW_EPHEMERAL_REPLAY=true`; that flag is not a production
fallback.

Replay markers contain only the installation/delivery key and expiry. They do
not contain App private keys, installation tokens, issue bodies, or model
output.

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
