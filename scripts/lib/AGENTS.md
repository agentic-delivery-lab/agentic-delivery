# Delivery controller runtime libraries

## Mission

This directory contains the reusable runtime modules used by the central
Delivery Control Plane for identity, contracts, lifecycle validation, routing,
orchestration, GitHub access, runner state, evidence, and replay protection.

## Dependency direction

The runtime consumes pinned Architecture and Primitive release contracts. It
does not become the canonical owner of architecture decisions, Primitive
implementations, member-profile content, or consumer CI/CD.

## Rules

- Treat model proposals and event payloads as untrusted until deterministic
  schema, authorization, transition, and compatibility checks pass.
- Derive the origin repository from the signed event and participant registry;
  never use the controller repository as an implicit origin.
- Scope GitHub installation tokens to the originating repository and operation
  permission whenever a mutation is required.
- Keep GitHub Issues and organization fields as the durable work-state record;
  runner state is execution state only.
- Preserve repository-ID and issue/PR namespaces in sessions, evidence, and
  concurrency keys.

## Required validation

Run the focused module tests, `pnpm control-plane:boundary`,
`pnpm acceptance:check`, and the complete `pnpm test` suite after runtime
changes. Add a cross-repository fixture when an identity or mutation path is
changed.
