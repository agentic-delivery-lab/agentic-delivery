---
date: 2026-09-10
source-issue: https://github.com/sjefsharp/agentic-delivery/issues/29
decision-makers: Sjef Jenniskens
consulted: None
informed: None
domains:
  - agentic-delivery-governance
required-enforcement:
  - deterministic
supersedes:
  - ADR-0010
---

# Use GitHub as the lifecycle control plane

## Context and Problem Statement

The harness must accept an issue ranging from a complete request to a vague
word such as `boe`. The existing deterministic intake correctly protects the
Plan and Implement controller, but it cannot conduct iterative refinement or
conditional decomposition. It also leaves lifecycle labels and runner
execution status too easy to confuse.

## Decision Drivers

- Keep GitHub Issues, pull requests, labels, and Actions authoritative for work
  state and lineage.
- Allow Codex to ask focused questions and propose refinement without allowing
  model output to mutate lifecycle state directly.
- Preserve the existing exact-session continuation and human merge authority.
- Keep conditional research, decision, specification, implementation, and
  validation work from becoming a fixed waterfall or fixed issue checklist.

## Considered Options

- A GitHub control plane with a semantic refinement agent, deterministic
  transition validator, and conditional child issues.
- Keep deterministic intake only and require humans to refine every vague issue.
- Let Codex own labels, transitions, and child-issue creation from free-form
  model output.

## Decision Outcome

Chosen option: **A GitHub control plane with deterministic transition
validation and conditional refinement/decomposition**, because it combines
human-visible lineage with useful model assistance and a testable safety
boundary.

GitHub work state is the single lifecycle authority. Codex returns a structured
refinement or transition proposal. A small deterministic validator checks the
current state, work type, governance gates, dependencies, authorization, and
configured transition table before Actions changes labels or creates child
issues. Technical execution failures update execution evidence only and do not
advance work state.

The persisted execution state records the failed operation, run identifier,
reason, and recoverability without changing the authoritative work state.

The existing readiness labels remain explicit control-plane contracts:
`state:ready-for-plan` authorizes planning, `state:ready-for-agent` authorizes
implementation, `state:investigating` records research, and `state:parked`
records deferred ideas. Rejected or abandoned work uses `state:done` with
GitHub's `not planned` close reason. The governance labels `adr:needed`,
`adr:proposed`, and `adr:removal` remain blocking until their decision work is
resolved.

An atomic refined request selects a delivery-capable parent work type and
continues from its parent issue into planning. A refined request with multiple actionable work items creates at most ten
idempotent, one-level child issues. The parent is the lineage root and moves
through coordination and acceptance; child issues use the existing delivery
workflow when their kind is implementation-capable. Human users close source
issues after review; Codex never closes them.

### Consequences

- Good, because a vague issue can be refined through its existing conversation.
- Good, because invalid model transitions cannot mutate GitHub state.
- Good, because parent/child lineage and conditional work remain visible.
- Bad, because refinement, dependency coordination, and idempotency need more
  state and tests.
- Neutral, because the old deterministic readiness gate still protects Plan
  and Implement after refinement.

### Confirmation

Contract tests cover blank intake, iterative repository-writer continuation, structured
outcomes, legal and illegal transitions, duplicate events, decomposition
dependencies, and execution failures that preserve work state. An end-to-end
run with a minimal issue is required after the workflow and credentials are
installed.

## Pros and Cons of the Options

### GitHub control plane with validated refinement and decomposition

- Good, because state and lineage remain observable and deterministic.
- Good, because model assistance is useful without becoming authority.
- Bad, because it adds a refinement outcome and child coordination contract.

### Deterministic intake only

- Good, because it is small and predictable.
- Bad, because vague issues cannot be refined autonomously and every question
  becomes a manual handoff.

### Model-owned lifecycle state

- Good, because it has the smallest apparent orchestration layer.
- Bad, because invalid or stale output could advance work, duplicate children,
  or bypass governance gates.

## More Information

- Supersedes ADR-0010, the removed deterministic-only intake record. Its
  history remains in Git, while this record is the active replacement.
- Refines ADR-0009: [Run Codex from source issues with a budget boundary](0009-run-codex-from-source-issues-with-a-budget-boundary.md)
- This record is provisional until its review pull request is merged into
  `main`.
