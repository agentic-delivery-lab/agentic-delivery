---
date: 2026-09-10
source-issue: https://github.com/agentic-delivery-lab/agentic-delivery/issues/29
amendment-source: https://github.com/agentic-delivery-lab/agentic-delivery/issues/35
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
word such as `boe`. The previous intake encoded lifecycle authority in
repository-local labels and assumed that most actionable work would enter the
Plan and Implement controller. That model makes durable classification,
lifecycle position, temporary readiness, governance controls, and runner
execution state too easy to confuse, and it cannot select a research,
requirements, architecture, validation, or coordination route independently.

## Decision Drivers

- Keep GitHub Issues, pull requests, issue types, pinned issue fields, and
  Actions authoritative for work intent, lifecycle position, and lineage.
- Use model reasoning to interpret the meaning and context of eligible issues
  and comments without keyword or regular-expression routing.
- Allow Codex to propose routing, field values, governance metadata, and
  refinement without allowing model output to mutate the control plane
  directly.
- Keep the native issue-type taxonomy, pinned field vocabulary, governance
  label catalog, orchestration policy, and transition table in versioned
  repository configuration.
- Do not require people to add labels or repeat continuation comments during
  normal delivery.
- Preserve the existing exact-session continuation and human merge authority.
- Keep conditional research, decision, specification, implementation, and
  validation work from becoming a fixed waterfall or fixed issue checklist.

## Considered Options

- A GitHub control plane with semantic routing and refinement, a deterministic
  issue-field and transition validator, versioned orchestration policy, and
  conditional child issues.
- Keep deterministic intake only and require humans to refine every vague issue.
- Let Codex own labels, transitions, and child-issue creation from free-form
  model output.

## Decision Outcome

Chosen option: **A GitHub control plane with semantic routing, deterministic
validation, and conditional refinement/decomposition**, because it combines
meaning-aware decisions and human-visible lineage with a testable safety
boundary.

GitHub is the control plane. Native organization issue types are the durable
work classification. The pinned `Lifecycle Stage` field is the lifecycle
authority and the pinned `Delivery Readiness` field is an orthogonal temporary
gate. Governance labels remain cross-cutting controls. Runner-local
continuation and execution data is not GitHub lifecycle metadata.

Codex returns a structured refinement, routing, or transition proposal. A
small deterministic validator checks the current type, fields, governance
gates, dependencies, authorization, orchestration policy, and configured
transition table before the controller changes an issue field, assigns a
native type, or creates child issues. Technical execution failures update
execution evidence only and do not advance lifecycle stage.

The persisted execution state records the failed operation, run identifier,
reason, and recoverability without changing the authoritative work state.

For every eligible issue or human comment, a read-only semantic router receives
the current issue, its conversation, the triggering event, and the approved
catalogs from `.github/issue-metadata.yml` and
`.github/orchestration-policy.yml`. It returns one structured routing proposal
containing a route, issue type, lifecycle stage, readiness value, complete
governance-label set, and orchestration pattern. No title prefix, form heading,
keyword, phrase, or regular expression assigns intent.

The proposal is untrusted. Deterministic code checks repository and issue
identity, actor permission, schema, native type compatibility, current field
values, allowed transition, readiness, governance, and exact membership in the
configured orchestration policy. Only then does the controller write approved
issue fields or invoke the selected profile. Unknown types, fields, stages,
profiles, capabilities, and MCP servers are rejected. Bot comments, pull
request comments, closed issues, stale events, and unauthorized actors are
rejected before model use.

People do not manage lifecycle fields during normal delivery. If model routing
or the GitHub field API is unavailable, the issue receives one short message
and no lifecycle mutation is attempted. A manual workflow dispatch is a
break-glass recovery only after an operator has confirmed the same field and
orchestration inputs. Historical `type:*` and `state:*` labels are read-only
migration evidence; the idempotent migration command assigns native types and
fields before removing those fallback labels. Governance labels such as
`adr:needed`, `adr:proposed`, and `adr:removal` remain cross-cutting gates, not
lifecycle states.

The organization taxonomy covers Idea, Research, Feature / Outcome, Bug, Task,
Requirements, Architecture Decision, Implementation, and Validation. The
universal lifecycle vocabulary is Intake, Discovery, Definition, Decision,
Planning, Execution, Validation, Acceptance, Done, and Parked. Readiness
values such as Needs information, Ready, Working, Waiting, Awaiting human, and
Blocked live in the separate readiness field. These vocabularies describe
distinct concepts and do not form a mandatory waterfall.

The versioned orchestration policy selects composable patterns from issue type,
lifecycle stage, trigger, governance, lineage, plan validity, saved session,
execution state, and explicitly observed capabilities. Research may use an
approved web capability; implementation profiles receive no MCP access. A
valid unchanged plan can invoke only the Luna Max implementer and resume the
exact saved session. Validation and coordination can complete without
implementation.

An atomic refined request selects a delivery-capable parent work type and
continues from its parent issue into planning. A refined request with multiple
actionable work items creates at most ten idempotent, one-level child issues.
The parent is the lineage root and moves through coordination and acceptance;
child issues use the existing delivery workflow when their kind is
implementation-capable. Human users close source issues after review;
rejected or abandoned work uses GitHub's `not planned` close reason, and Codex
never closes source issues.

### Consequences

- Good, because a vague issue can be refined through its existing conversation.
- Good, because arbitrary human wording is interpreted in context instead of
  being reduced to a keyword match.
- Good, because the model can propose fields and policy patterns but cannot
  invent or directly apply them.
- Good, because lifecycle fields, readiness, governance, and execution state
  remain separately observable.
- Good, because invalid model transitions cannot mutate GitHub state.
- Good, because parent/child lineage and conditional work remain visible.
- Bad, because refinement, dependency coordination, and idempotency need more
  state and tests.
- Neutral, because legacy labels remain readable during the migration window
  but are never written as lifecycle authority.

### Confirmation

Contract tests cover blank intake, paraphrase-independent comment routing,
closed proposal schemas, unknown metadata and capability rejection, legal and
illegal field transitions, policy selection, isolated model execution,
iterative repository-writer continuation, structured outcomes, duplicate
events, decomposition dependencies, idempotent legacy migration, and
execution failures that preserve lifecycle stage. An end-to-end run with a
minimal issue is required after the organization fields, credentials, and
operator bindings are installed.

## Pros and Cons of the Options

### GitHub control plane with validated refinement and decomposition

- Good, because fields, type, governance, and lineage remain observable and
  deterministic.
- Good, because model assistance is useful without becoming authority.
- Bad, because it adds a refinement outcome, child coordination contract,
  organization configuration, and a capability-aware policy.

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
- Amendment source: [issue #32](https://github.com/agentic-delivery-lab/agentic-delivery/issues/32)
  and [issue #35](https://github.com/agentic-delivery-lab/agentic-delivery/issues/35).
- The active metadata contract is `.github/issue-metadata.yml`; the active
  orchestration contract is `.github/orchestration-policy.yml`. The former
  repository-local lifecycle file is migration history and is not loaded.
