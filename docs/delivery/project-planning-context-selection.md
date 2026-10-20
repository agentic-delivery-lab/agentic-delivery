# Project planning context selection

This is an offline-only selection contract for choosing one Project planning
context linked to an exact source Issue. It does not read GitHub, change Project
or Issue data, authorize a run, or select a delivery route.

## Selection policy

A version 1 selection policy identifies a topology, its allowed Project node
IDs, each Project's pinned field-schema digest, and an explicit numeric priority
for each Project. The policy's SHA-256 is calculated over canonical JSON with
the fields `schemaVersion`, `policyId`, `version`, `topologyId`, and `projects`;
the Project entries are sorted by ascending priority and contain only
`projectNodeId`, `fieldSchemaSha256`, and `priority`. The selector checks both
the policy's digest and a separately supplied expected digest. It also rejects
duplicate Project IDs and duplicate priorities. JSON Schema validates policy
structure; it cannot establish these uniqueness rules or verify the digest.
Consumers must use the selector's semantic validation before selection; a
schema-valid policy alone is insufficient.

The expected digest must come from a reviewed immutable release that has
already resolved the topology and policy approval. This selector checks policy
integrity and binding; it cannot prove who approved a policy. No live Project or
approved topology exists in the current inventory, so the test policy uses
synthetic IDs and is not an organization configuration.

## Candidate handling

The caller must declare `candidatesComplete: true` only after completing its
candidate collection. Explicit partial reads return
`PROJECT_CANDIDATE_READ_INCOMPLETE`; a missing or invalid declaration returns
`PROJECT_CANDIDATE_READ_COMPLETENESS_UNKNOWN`. The offline selector cannot
verify a caller's declaration or perform pagination; a future reader must prove
that collection is complete before supplying it.

Each candidate must pass the existing Project planning normalizer. The selector
then binds its Project item to the source repository ID, repository name, Issue
number, and Issue node ID. Repository names are compared case-insensitively for
this identity check; repository ID, Issue number, and Issue node ID must still
match exactly. Equal Issue numbers in different repositories are different
source Issues.

The policy priority resolves candidates from different approved Projects.
Project display names, API order, and Project field values do not affect the
choice. A Project with multiple views remains one Project; repeated identical
observations of the same Project item collapse to one candidate. Conflicting
observations or multiple distinct items from one Project produce a fixed hold
result. Fields from non-selected Projects are never combined with the selected
context.

A successful result records `consideredCandidates` in policy-priority order.
Each distinct candidate retains its Project node ID, item node ID, and exact
source repository and Issue identities, including alternatives not selected.
Repeated observations appear once. `candidateCount` counts these distinct
items. This evidence does not copy unselected planning fields or grant them
authority. The provisional version 1 result schema requires this evidence
before its first adoption; earlier proposal outputs without it are incomplete.

Missing or mismatched policy pins, unapproved or inaccessible Projects,
incomplete reads, invalid source identities, and ambiguous candidates return a
stable error code with no selected context. The gap schema requires
`candidateEvidence`, which retains the target source identity and each distinct
supplied Project/item/source identity in a fixed order. This evidence is
untrusted, including when access or policy approval is missing. It contains no
planning fields, Issue body or approval claim; missing or malformed identities
are null. Reordering or repeating observations does not change the projection.
This records only identities supplied by the caller and does not establish that
an inaccessible or incomplete read discovered every candidate. The selected output retains the
existing planning-only authority and untrusted-data marker. It cannot overwrite
Issue-owned priority, lifecycle, readiness, or runner state.

The success and gap schemas validate structure. The selector and its tests
also enforce that `candidateCount` equals the retained list length and that the
chosen Project item is in that list; those relationships are not expressed by
the JSON Schema alone. Future consumers must not treat structural schema
validation of arbitrary supplied results as proof of these relationships.

Candidate-local errors are collected across the supplied observations and
resolved by a fixed code precedence. The resulting error does not depend on API
response order.

Project access is optional planning context. A selection gap does not change
the separate source-Issue authorization result for an otherwise eligible
security or recovery task. Any future runtime integration must independently
validate the pinned policy source, Project access, source-Issue authorization,
and all lifecycle and downstream execution gates.

The policy and result schemas and synthetic tests are offline evidence only.
They do not show live Project operation. Adoption requires completion of the
Architecture #11 strategy and contract work and ADR-0023's reviewed Architecture
release path, plus a recorded human topology decision in Architecture #15.
Any runtime consumer must receive the policy and its expected digest from that
approved immutable release and separately verify Project access and
configuration. No real Project identity or live read is introduced here.
