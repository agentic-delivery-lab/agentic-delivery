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

The controller selects the profile from the authenticated origin and its own
checkout commit before model execution. State version 5 saves the profile reference;
missing or changed references hold continuation without resetting spent allowance.
During verification it records required command-result hashes and the candidate
tree, then retains the existing exact-tree commit/publication checks. Older state
is readable for inspection, but cannot receive a fresh profile pin on resume.

Existing shadow participants remain shadow; Requirements remains unenrolled. This
integration is not profile admission or evidence of active cross-repository delivery.

Declared controller/workspace paths are resolved from trusted runtime state.
Additional authority mounts require W12 admission; the private profile holds before
model startup while its canonical source mount is unavailable. No Issue or
environment path can supply that mount.

Before admission, real target layouts and selected validators must be exercised.
Trusted validator/source reproduction,
resource limits, required checks and compatible runtime/authority pins must be
verified for each target. Architecture parsing is extended separately by W19.
