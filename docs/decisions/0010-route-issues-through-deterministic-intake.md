---
date: 2026-09-09
source-issue: https://github.com/sjefsharp/agentic-delivery/issues/17
decision-makers: Sjef Jenniskens
consulted: None
informed: None
---

# Route source issues through deterministic intake

## Context and Problem Statement

[Issue #17](https://github.com/sjefsharp/agentic-delivery/issues/17) asks the
repository to classify and mature GitHub Issues before planning or
implementation. The current controller starts its Plan → Implement path for
every newly opened source issue. That makes an idea, incomplete feature, or
unresolved architecture question look ready for implementation and mixes work
type, lifecycle state, and governance concerns.

The repository needs an observable entry contract that can stop work before a
Codex turn, retain the existing Plan → Implement controller as a reusable
downstream primitive, and leave room for later lifecycle-specific agents. The
decision affects the repository-wide delivery entry point and refines
[ADR-0009](0009-run-codex-from-source-issues-with-a-budget-boundary.md).

## Decision Drivers

- Do not spend model quota on issues that are incomplete or not ready.
- Keep work type, lifecycle state, governance metadata, and final resolution
  separate and visible in GitHub metadata.
- Make readiness deterministic wherever labels and structured form data can
  enforce it.
- Preserve the exact Plan and Implement models, budget boundary, sandbox,
  audit trail, branch rules, review pull request, and human merge authority
  from ADR-0009.
- Keep the configuration repository-local, idempotent, and extensible without
  introducing a general-purpose workflow engine or external service.

## Considered Options

- **A deterministic intake workflow with a reusable delivery workflow.**
  Classify native Issue Types or repository fallback labels, reconcile one
  lifecycle state, enforce governance and readiness gates, and invoke the
  existing controller only for an eligible issue.
- **Send every issue directly to the existing Codex controller.** This keeps
  the workflow small, but cannot prevent ideas and incomplete requirements from
  entering Plan and makes lifecycle metadata incidental.
- **Use an LLM-only classifier and readiness decision.** This handles semantic
  ambiguity, but makes a safety-critical gate non-deterministic, spends quota
  before readiness, and is difficult to test without production cleanup.
- **Require a maintainer to issue `/codex resume` for every ready issue.** This
  is explicit, but adds an unnecessary manual handoff to the normal path and
  does not make readiness observable as authorization.

## Decision Outcome

Chosen option: **A deterministic intake workflow with a reusable delivery
workflow**, because it creates a small, inspectable boundary before model
execution while retaining the current delivery behavior downstream.

The repository stores six work types—Bug, Feature, Task, Idea, Research, and
Architecture—using a recognized native GitHub Issue Type when available and a
repository-local `type:*` label as fallback. It stores one lifecycle state in
the `state:*` label family. Research uses `state:investigating`; deferred Idea
work uses `state:parked`. Governance labels, including the canonical
`adr:needed`, remain independent. Rejected or intentionally abandoned work
uses `state:done` and GitHub's `not planned` close reason.

The intake workflow handles issue creation and relevant metadata changes. It
uses structured Bug, Feature/Request, Idea, and Task/Work Request forms while
keeping blank issues as a generic fallback. A deterministic classifier reads
the issue title, body, form headings, native type, labels, state, governance
metadata, and close reason. It assigns or proposes only a conservative result;
ambiguous work remains in triage. It reconciles managed labels without
removing unrelated labels and does not call an LLM for the final readiness
decision.

`state:ready-for-plan` is the readiness gate. It requires a supported,
delivery-capable work type, complete recognized intake fields, no conflicting
metadata, cleared decision requirements, and no unresolved `adr:needed`,
`adr:proposed`, or `adr:removal` gate. A valid ready state automatically
invokes the reusable delivery workflow. A successful Plan transition records
`state:ready-for-agent`, then `state:in-progress` immediately before
Implement. Clarification records `state:needs-info`; a published review pull
request records `state:review`. Clear natural-language owner requests and
manual dispatch remain recovery mechanisms for saved or intentionally gated
work; `/codex resume` is retained as a compatibility shortcut.

### Consequences

- Good, because incomplete, ambiguous, Idea, and Research work cannot consume
  delivery model quota before maturation.
- Good, because the issue itself shows its work type, current state, controls,
  and final disposition.
- Good, because repeated issue events and automation-owned label changes are
  idempotent and do not form a self-triggering loop.
- Good, because later lifecycle-specific agents can be added behind the route
  table without changing the delivery controller contract.
- Bad, because maintainers must move an issue through explicit states and
  resolve conflicting metadata.
- Bad, because native Issue Type availability is controlled by GitHub and the
  repository must retain fallback labels for portability.
- Neutral, because the existing Codex models, quota boundary, sandbox,
  persistence, review, merge, and source-issue authority remain governed by
  ADR-0009.

### Confirmation

- Routing tests cover every supported type, state transition, form contract,
  governance gate, close reason, conflict, and idempotent replay.
- Controller tests prove that non-ready issues start no model turn, that the
  ready-for-plan handoff automatically reaches Implement, and that lifecycle
  transitions are written before dependent phases.
- Workflow, YAML, Markdown, ADR, domain-language, repository test, and
  dependency-audit checks run in the existing quality workflows.
- Human review confirms that GitHub's external Issue Type name maps to the
  repository's `work type` term and that no architecture-related issue is
  treated as requiring an ADR without the `adr:needed` governance decision.

## Pros and Cons of the Options

### A deterministic intake workflow with a reusable delivery workflow

- Good, because metadata and the readiness boundary are visible and testable.
- Good, because the existing Plan → Implement primitive remains reusable.
- Bad, because the workflow and controller need a small integration contract.

### Send every issue directly to the existing Codex controller

- Good, because it has the least workflow surface.
- Bad, because readiness cannot be enforced before the Plan turn.
- Bad, because discovery and implementation lifecycles remain conflated.

### Use an LLM-only classifier and readiness decision

- Good, because semantic classification can handle unstructured prose.
- Bad, because a model judgment is not a deterministic final readiness gate.
- Bad, because it consumes quota and makes idempotent tests harder.

### Require a maintainer to issue `/codex resume` for every ready issue

- Good, because the handoff is explicit.
- Bad, because normal ready work receives an unnecessary manual gate.
- Bad, because the ready state would not itself authorize downstream delivery.

## More Information

- Assignment brief and ADR tracking issue: [GitHub issue #17](https://github.com/sjefsharp/agentic-delivery/issues/17)
- Review pull request: [GitHub pull request #24](https://github.com/sjefsharp/agentic-delivery/pull/24)
- Refined decision: [ADR-0009](0009-run-codex-from-source-issues-with-a-budget-boundary.md)
- Domain register: [`ubiquitous-language.yml`](../domain/ubiquitous-language.yml)
- Delivery guide: [`docs/delivery/codex-workflow.md`](../delivery/codex-workflow.md)
- The addition is provisional on its feature branch and becomes an official
  decision only after its review pull request is merged into `main`.
