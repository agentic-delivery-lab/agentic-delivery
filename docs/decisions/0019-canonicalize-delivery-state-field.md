---
date: 2026-09-20
source-issue: https://github.com/agentic-delivery-lab/agentic-delivery/issues/52
decision-makers: Repository maintainers
consulted: Current organization issue-field inventory and control-plane implementation
informed: None
domains:
  - agentic-delivery-governance
  - agentic-delivery-control-plane
required-enforcement:
  - deterministic
  - semantic
---

# Canonicalize the orthogonal delivery-state field

## Context and Problem Statement

The organization intends to expose two orthogonal pinned issue fields:
`Lifecycle Stage` and `Delivery State`. The current repository and live
configuration instead call the second field `Delivery Readiness` and expose
the logical key `readiness`. Its options already describe more than a simple
precondition: `not-ready`, `needs-info`, `ready`, `working`, `waiting`,
`awaiting-human`, and `blocked`.

This is architecture drift, not a harmless spelling difference. A silent
rename would make the controller, organization field bindings, Projects
projections, issue forms, tests, and historical evidence disagree. Creating a
third field would be worse: it would split one work-state concept and create
two independently mutable sources of truth.

## Decision Drivers

- Keep Issue Type, Lifecycle Stage, delivery state, governance metadata and
  runner execution state orthogonal.
- Preserve the existing GitHub field and option node IDs where possible.
- Do not mutate live organization metadata as a side effect of a code change.
- Let old participants and saved runner state finish through an explicit
  compatibility window.
- Keep Projects as a projection rather than another state machine.
- Make the eventual rename reviewable, reversible, and observable.

## Considered Options

- Treat `Delivery Readiness` as a separate concept and add `Delivery State`.
- Rename the existing field immediately and rewrite all callers.
- Keep `Delivery Readiness` as the canonical name forever.
- Select `Delivery State` as the canonical model name and migrate the existing
  field in place with an explicit legacy alias.

## Decision Outcome

The canonical domain concept is **Delivery State**. `Delivery Readiness` is a
legacy name for the same orthogonal organization issue-field dimension, not a
second state machine. The existing values and their meanings remain valid;
their names do not imply that the field is the lifecycle stage or the
runner's execution record.

The migration is deliberately not activated by this ADR. Until the operator
completes the live-field migration, the current logical key `readiness`, field
ID `delivery-readiness`, display name `Delivery Readiness`, and existing
option IDs remain authoritative. Controllers must accept and emit the current
contract during this compatibility period. A future controller contract may
expose `delivery_state` as the canonical serialized key while accepting
`readiness` only at the versioned boundary.

When the migration is authorized, it must:

1. verify the live organization field and option IDs through a trusted
   read-only GraphQL inventory;
2. rename the existing field display name in place, if GitHub supports that
   operation for the installed plan, without creating a second field;
3. retain the field node ID and option IDs;
4. update the Control Plane, reusable workflows, Projects mappings, issue
   forms, evidence schemas, tests, and documentation in one versioned
   compatibility release;
5. run old and new readers in shadow mode and compare values by option ID;
6. update participants one at a time, with an exact controller and contract
   pin; and
7. remove the `readiness` alias only after every participant and projection
   has upgraded and a complete release cycle shows no fallback use.

If the live GitHub plan cannot rename the field in place, the operator must
stop and approve a separate migration that preserves one authoritative field
through a controlled replacement. The controller must never write both fields
or infer one from labels.

### Consequences

- Good, because the target vocabulary is explicit without changing the
  current issue that is being processed.
- Good, because option and field identity remain stable across a rename.
- Good, because the compatibility boundary is versioned and testable.
- Bad, because the repository temporarily carries a legacy `readiness` alias.
- Bad, because live field changes require operator entitlement and a separate
  rollout; content PRs cannot prove that GitHub accepted the rename.

### Confirmation

Deterministic evidence for the migration must show:

- the live field inventory contains exactly one field for this concept;
- Issue Type remains a native GitHub classification and is not a pinned
  lifecycle field;
- Lifecycle Stage and Delivery State remain separate fields;
- option IDs map one-to-one before and after the display-name change;
- old and new controller versions produce the same option-ID projection;
- no labels, Projects-only value, or runner state becomes authoritative; and
- rollback restores the previous controller pin without creating a second
  field or rewriting historical Issue URLs.

## More Information

- Refines [ADR-0012: Use GitHub as the lifecycle control plane](0012-use-github-as-the-lifecycle-control-plane.md).
- Extends [ADR-0018: Organization-wide Agentic Delivery control-plane distribution and versioning](0018-organization-wide-agentic-delivery-control-plane-distribution-and-versioning.md), which explicitly leaves this rename to a separate decision.
- The current live logical contract remains in [`.github/issue-metadata.yml`](../../.github/issue-metadata.yml) until the migration described here is authorized.
- This record is provisional until its review pull request is merged into `main`.
