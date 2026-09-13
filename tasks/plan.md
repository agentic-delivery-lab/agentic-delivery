# Implementation Plan: Type-aware issue orchestration

## Overview

Source issue [#35](https://github.com/agentic-delivery-lab/agentic-delivery/issues/35) evolves the agentic-delivery control plane from repository-local lifecycle labels and a default Plan then Implement chain to native organization issue types, pinned lifecycle fields, and a versioned orchestration policy. GitHub remains authoritative for issue work state; the runner keeps only bounded execution state and exact-session continuation data.

The GitHub task tracker is the task-list target. The child issues below are linked to #35 as sub-issues and carry lineage markers. `tasks/todo.md` is intentionally not created.

## Architecture Decisions

- Native organization issue types classify durable work. A compatibility resolver reads old `type:*` labels only during migration.
- A small organization-level `Lifecycle Stage` single-select field is the authoritative lifecycle state. An orthogonal `Readiness` field records temporary authorization gates; governance labels remain cross-cutting controls, and runner execution state remains local.
- Semantic routing may propose an orchestration pattern, but deterministic policy validation authorizes only catalogued patterns, agent profiles, capabilities, models, skills, MCP servers, and lifecycle transitions.
- Orchestration is composable and type-aware. It may stop after research, requirements, architecture, validation, or coordination, and it may resume an unchanged implementation session without planning again.
- Organization settings and the organization `.github` repository are external prerequisites. This repository will provide versioned manifests, migration tooling, templates, and an explicit operator runbook rather than pretending that unavailable organization configuration has been applied.
- ADR-0012 is amended provisionally in the same branch; ADR-0013 traceability and ADR-0015 isolation remain preserved.

## Task List

### Phase 1: Foundation

- [x] [#36](https://github.com/agentic-delivery-lab/agentic-delivery/issues/36): Define native issue metadata and orchestration contracts.
- [x] [#37](https://github.com/agentic-delivery-lab/agentic-delivery/issues/37): Move lifecycle transitions from labels to issue fields.

### Checkpoint: Foundation

- [x] Contract schemas parse and reject unknown values.
- [x] Focused policy and transition tests pass.
- [x] Existing migration compatibility behavior remains covered.

### Phase 2: Core orchestration

- [x] [#38](https://github.com/agentic-delivery-lab/agentic-delivery/issues/38): Implement type-aware orchestration policy selection.
- [x] [#39](https://github.com/agentic-delivery-lab/agentic-delivery/issues/39): Integrate type-aware delivery and exact-session continuation.

### Checkpoint: Core orchestration

- [x] Research, architecture, validation-only, coordination, fresh implementation, valid-plan implementation, and exact-session continuation have distinct authorized routes.
- [x] Missing capabilities and stale plans fail closed without illegal lifecycle advancement.
- [x] Existing delivery, security, quota, and resumability tests pass.

### Phase 3: Migration and governance

- [x] [#40](https://github.com/agentic-delivery-lab/agentic-delivery/issues/40): Prepare organization template migration and governance documentation.
- [x] Add or amend the provisional architecture decision and update the domain register, agentic primitive references, evidence projection, and changelog.

### Checkpoint: Complete

- [x] Organization configuration is explicitly prepared with an idempotent dry-run/apply contract; final reconciliation remains an operator step.
- [x] No workflow treats `state:*` labels as authoritative lifecycle state.
- [x] Generated ADR traceability is current.
- [x] Full deterministic test, configuration, domain, ADR, changelog, whitespace, and architecture-harness checks pass.
- [x] The feature branch is ready for a review pull request; human review and merge remain required.

## Dependency Graph

```text
native metadata and policy schemas
        |
        +--> field and transition resolver
        |          |
        |          +--> issue intake and field mutation
        |
        +--> agent/capability policy validator
                   |
                   +--> routing selection
                              |
                              +--> delivery controller patterns
                                         |
                                         +--> migration, evidence, and review
```

## Verification Scope

- Unit tests cover schema closure, field transitions, policy authorization, migration, idempotency, stale-plan detection, scope-change invalidation, capability availability, and exact-session selection.
- Integration fixtures cover GitHub issue fields, native issue types, legacy labels, duplicate events, parent lineage, and persisted delivery state.
- Existing tests remain the evidence for quota boundaries, credential isolation, temporary homes, publication ownership, redaction, cleanup, ADR traceability, and architecture review.
- Manual review checks that organization defaults are not claimed as applied when the `.github` repository or organization settings are unavailable.

## Risks and Mitigations

| Risk | Impact | Mitigation |
| --- | --- | --- |
| Organization fields or custom types are unavailable to repository automation | High | Version the desired catalog, validate observed IDs/options, provide idempotent operator migration, and degrade explicitly. |
| Legacy issues have labels but no fields | High | Resolve native metadata first, read labels only in a bounded migration window, and retain execution state independently. |
| A stale or malicious model proposal selects an unsafe route | High | Closed schemas plus deterministic policy, transition, capability, and issue-identity validation before execution. |
| Research access leaks into implementation | High | Bind web/research capability only to the research profile and preserve per-profile sandbox/network permissions. |
| A plan or session becomes invalid during migration | High | Store plan digest and metadata version, invalidate on material scope changes, and preserve exact session identifiers for valid continuations. |
| Native sub-issue API is unavailable | Medium | Keep explicit lineage markers and parent references; reconcile native links when the organization API is available. |

## Open Questions

- The organization owner must apply or authorize the final custom issue types, `Lifecycle Stage` and `Readiness` fields, their options, and pinned type mappings.
- The runner owner must confirm which configured MCP servers are installed on the self-hosted runner at execution time; the registry will not infer availability from a desirable profile.
