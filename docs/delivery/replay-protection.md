# Webhook delivery replay protection

The organization webhook treats the GitHub delivery ID as an idempotency key.
The claim is made only after the signed event, participant registry, event
catalogue, origin token, and actor authorization have passed, and immediately
before the central `repository_dispatch` mutation.

The gateway carries `received_at` in the envelope. The central preflight
accepts a compatible legacy envelope without that field, but validates a
present timestamp against the five-minute replay window and a thirty-second
future clock-skew allowance. New webhook deliveries always include it.

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
operation only.

Replay markers contain only the installation/delivery key and expiry. They do
not contain App private keys, installation tokens, issue bodies, or model
output.

The gateway also binds every supported event to the configured organization
login, numeric organization ID, and App installation ID before it mints an
origin-scoped token. The deployment defaults are the current
`agentic-delivery-lab` organization (`327861320`) and installation
(`163255060`); operators must verify these values against the live App
installation and override them with `AGENTIC_DELIVERY_ORGANIZATION`,
`AGENTIC_DELIVERY_ORGANIZATION_ID`, and `AGENTIC_DELIVERY_APP_INSTALLATION_ID`
when rotating or promoting the deployment. A mismatched organization or
installation is rejected before actor authorization or dispatch.
