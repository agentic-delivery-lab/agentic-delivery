# Control Plane configuration

This directory is the canonical configuration boundary for the executable
Delivery Control Plane.

- `agent-actors.json` defines the explicit conversation-invocation boundary.
- `participants.yml` defines repository enrollment, controller pins, contract
  versions, and local integration profiles.
- `controller-release.json` defines the immutable controller release and its
  dependency pins.
- `github-app-contract.json` defines the organization App and credential
  boundary.

The lifecycle and orchestration documents under `.github/` are retained as a
read-only migration bridge until their split into `config/lifecycle.yml`,
`config/issue-fields.yml`, and `config/orchestration-policy.yml` is approved
and validated. They are not GitHub organization-default files: this repository
is the Control Plane, while the separate public `.github` repository owns
community-health defaults.
