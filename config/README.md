# Control Plane configuration

This directory is the canonical configuration boundary for the executable
Delivery Control Plane.

- `agent-actors.json` defines the explicit conversation-invocation boundary.
- `participants.yml` defines repository enrollment, controller pins, contract
  versions, and local integration profiles.
- `controller-release.json` defines the immutable controller release and its
  dependency pins.
- `issue-metadata.yml` defines the native issue type, lifecycle stage, delivery
  state/readiness compatibility contract, governance metadata, and field
  transitions.
- `orchestration-policy.yml` defines the versioned routing and execution
  policy.
- `github-app-contract.json` defines the organization App and credential
  boundary.
- Repository-root `schemas/github-inventory.v1.schema.json` and
  `scripts/collect-github-inventory.mjs` define a redacted, read-only
  organization inventory used to separate observed GitHub state from
  permission and entitlement gaps.

These files are Control Plane configuration, not GitHub organization-default
files. The separate public `.github` repository owns community-health
defaults. Any future split of lifecycle and field definitions into separate
files must preserve one authoritative executable contract and be introduced
through a versioned migration.
