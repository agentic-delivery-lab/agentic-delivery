# Native operation tool gate candidate

Source issue: agentic-delivery-lab/agentic-delivery#105. This is an experimental,
source-only candidate implementing the already selected operation-budget boundary.
It is **not an admitted runtime** and does not change the selected installer pin.

The source preparer accepts one clean upstream commit and verifies every changed
file's SHA-256 before inserting the guard. The release-tag lockfile still names 159 workspace packages as version
0.0.0; preparation changes only those versions to 0.159.3 and verifies the
exact input and output digests. External dependencies and config schema stay
unchanged. The CLI initializes a private inherited descriptor before threads or
helper children, marks it close-on-exec and removes its parent-only environment
marker. A common registry check runs before native, extension and MCP dispatch.
It requires a correlated positive controller response; denial, disconnect,
malformed response, wrong identity, oversized frame or timeout holds the channel.
No public endpoint, tool shell networking or listener is introduced.

The controller protocol uses newline-delimited JSON, version 1, at most 4096 bytes
per frame, one request in flight, and a five-second native response deadline.
Readiness contains `version`, `type=ready` and `sourceCommit`. Reservation requests
contain `version`, a random `requestId`, `threadId`, `turnId`, `callId` and
`toolName`. Grants contain exactly `version`, matching `requestId` and `allow`.
Tool arguments, credentials and raw provider errors are excluded.

The future controller adapter must bind the inherited channel to its admitted
operation, exact runtime, native origin, current thread/turn and live receipt
lease; reserve durably before granting; deny unapproved tools and all child-agent
creation; and retain consumption after uncertain responses. Stable call identity
must prevent duplicate execution across restart. A runtime readiness frame alone
is insufficient admission: artifact provenance and the installed package hash
must also match.

The build probe uses isolated hosted CI with read-only repository permission and
no owner/model credentials. It formats the prepared source, runs upstream core
and workspace tests, builds the actual CLI, and tests readiness plus rejection of
a missing inherited channel without invoking a model. Evidence artifacts are
build/test observations, not executable distribution releases.

Remaining admission gates include actual tool execution before/at/after the
budget boundary with the real ledger, concurrent calls, replay/resume,
forbidden tools and child creation, inherited-descriptor isolation, outage and
shutdown; routing/controller integration across all participating phases;
complete artifact/dependency/license inventory; and Distribution/runtime/client
compatibility. The small native channel tests do not prove these outcomes.
An unavailable build or failed probe withholds admission. The existing runtime
is not silently replaced, and participants remain shadow.
