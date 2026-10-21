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
Authority-dependent profiles declare required read-only inputs: Architecture
requires Requirements source, Customizations requires the pinned Architecture
report schema source, and the private adapter requires canonical primitive source.
The controller checks these declarations before model startup, token issuance or
protected writes. Missing inputs produce a validation-profile hold and operator
readmission advice, rather than an availability retry. No Issue or environment
path can provision them.

The proposal version is `1.0.0-proposed.2`. Presence checks do not prove source
identity, immutable pins or sandbox mounts. The trusted source resolver and actual
mount admission remain separate work; this change neither supplies those mounts
nor enables the dependent profiles. A changed saved profile still requires owner
readmission without resetting spent operation allowance.

Before admission, real target layouts and selected validators must be exercised.
Trusted validator/source reproduction,
resource limits, required checks and compatible runtime/authority pins must be
verified for each target. Architecture parsing is extended separately by W19.

Automatic Vercel Git deployments are disabled while safety changes are reviewed.
A code merge is separate from deployment and participant activation.
