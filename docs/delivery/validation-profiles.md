# Repository validation profile proposal

W11 replaces unconditional Control Plane layout assumptions with controller-owned
validation commands. `scripts/lib/validation-profile.mjs` contains the proposed
catalog for the seven factory repository identities. Selection requires both the
native repository ID and current full name, plus an immutable controller commit.
Issue text, repository names alone and unknown identities cannot choose commands.

Each result records a proposal version, definition SHA-256 and controller commit.
Commands are argument arrays with an explicit sandbox and bounded timeout. The
public and private adapters have no dependency-install command. The private
publication validator uses the trusted controller and requires read-only canonical
primitive source for reproduction; it does not grant publication entitlement.

The catalog is not yet connected to controller execution. Existing shadow
participants remain shadow; Requirements remains unenrolled. This commit is not
profile admission or evidence of active cross-repository delivery.

Before admission, controller integration must resolve declared paths and read-only
inputs from trusted state, hold unsupported layouts and missing inputs, bind the
selected profile to the saved operation, record command results and candidate tree,
and preserve exact tested-tree publication. Trusted validator/source reproduction,
resource limits, required checks and compatible runtime/authority pins must be
verified for each target. Architecture parsing is extended separately by W19.
