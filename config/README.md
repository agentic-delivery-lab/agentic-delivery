# Control Plane configuration

This directory is the canonical configuration boundary for the executable
Delivery Control Plane.

- `agent-actors.json` defines the explicit conversation-invocation boundary.
- `participants.yml` defines repository enrollment, controller pins, contract
  versions, and local integration profiles.
- `controller-release.json` defines the immutable controller release, its
  dependency pins, and the exact bootstrap commit used before a participant
  pin is trusted.
- `issue-metadata.yml` defines the native issue type, lifecycle stage, delivery
  state/readiness compatibility contract, governance metadata, and field
  transitions.
- `orchestration-policy.yml` defines the versioned routing and execution
  policy.
- `event-catalog.yml` is the canonical organization event/action contract;
  the GitHub App manifest and participant subscriptions are validated
  projections of it. An event is input, not an automatic lifecycle transition.
- `primitive-selection.yml` binds each approved orchestration profile to the
  released Primitive identifiers it may compose. It is a release-bound
  selection contract, not a second Primitive catalog; the Primitive release
  manifest remains authoritative for content, version, commit, digest, and
  capability policy.
- `github-app-contract.json` defines the organization App and credential
  boundary, including separate webhook and repository-dispatch signing
  secrets; pull-request lifecycle events are signed observations and are not
  invocation or lifecycle-transition events.
- `controller-release.json` is checked against the explicitly supplied
  Architecture, Primitives, Distribution, and `.github-private` checkouts by
  `scripts/validate-release-chain.mjs`. That release-coordination check
  reproduces the pinned content digests, workflow source SHA, plugin inputs,
  and private-publication provenance; it does not create runtime imports or
  infer repository paths.
- `.github/workflows/agent-observation.yml` is the credential-free central
  dispatch entry point for pull-request observations; it must remain separate
  from `agent-invocation.yml` so an observation cannot start a model run. It
  checks out the participant's immutable controller commit before validating
  the envelope and registry; it must not follow a moving `main` ref.
- Repository-root `schemas/github-inventory.v1.schema.json` and
  `scripts/collect-github-inventory.mjs` define a redacted, read-only
  organization inventory used to separate observed GitHub state from
  permission and entitlement gaps.

These files are Control Plane configuration, not GitHub organization-default
files. The separate public `.github` repository owns community-health
defaults. Any future split of lifecycle and field definitions into separate
files must preserve one authoritative executable contract and be introduced
through a versioned migration.
