# Control Plane contract configuration

## Mission

This directory contains versioned, machine-readable contracts for the
organization-wide Delivery Control Plane: event intake, participant
enrollment, lifecycle metadata, routing, orchestration, controller releases,
and Primitive selection.

## Authoritative sources

- `participants.yml` is the enrollment source keyed by immutable repository ID.
- `event-catalog.yml` is the organization event/action/route source.
- `issue-metadata.yml` is the current compatibility contract for Lifecycle
  Stage and the legacy Delivery Readiness field.
- `controller-release.json` is the immutable controller and dependency pin.
- `primitive-selection.yml` selects released Primitive capabilities without
  copying their implementation.

## Rules

- Keep Issue Type, Lifecycle Stage, Delivery State/Readiness, governance
  metadata, and execution state distinct.
- Use immutable commits and schema versions for cross-repository references.
- Do not store credentials, runtime/session state, issue state, or generated
  duplicate registries here.
- A configuration change is not active organization state until its reviewed
  release and operator-controlled GitHub change are complete.

## Required validation

Run `pnpm metadata:check`, `pnpm control-plane:check`, `pnpm github-app:check`,
`pnpm traceability:check`, `pnpm acceptance:check`, and the explicit-root
release-chain check when a dependency or contract changes.
