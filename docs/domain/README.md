# Domain language

## Domain vision

This repository defines a reliable way for people and coding agents to deliver changes together. Its domain model makes governance rules, review boundaries and reusable agent instructions explicit so that a future contributor can understand what is being changed, why it is being changed and when a decision becomes official.

The canonical model vocabulary is stored in [`ubiquitous-language.yml`](ubiquitous-language.yml). Use the registered term and definition when discussing a modeled concept in documentation, agent instructions, issue or pull-request communication, and domain-bearing code.

The control plane is GitHub: Issues, native issue types, pinned Lifecycle Stage
and Delivery Readiness fields, governance metadata, pull requests, and
deterministic Actions own work state. The execution plane is Codex and the
self-hosted runner: it performs bounded operations and records execution state
but cannot decide or apply lifecycle transitions.

Issue type answers what the issue represents. Lifecycle Stage answers where it
is in its lifecycle. Delivery Readiness records an orthogonal temporary gate,
while governance metadata records cross-cutting controls. The runner's
execution state records resumable operations and is not a replacement for any
of those GitHub values.

## Repository boundary

The initial bounded context is `agentic-delivery-governance`. It covers the repository's rules and agentic primitives for proposing, reviewing, validating and recording delivery work. The repository currently has no runtime application model.

Do not assume that a registered meaning applies outside its bounded context. Add another bounded context only when a model has a distinct purpose or a term needs a meaning that would conflict with the existing context. Describe translations at the boundary when two contexts must interact.

## Changing the model

Treat language as part of the domain model. Include a register update in the same change set when work:

- introduces a modeled concept that has no registered term;
- uses a registered term with a conflicting meaning;
- changes the meaning or preferred name of a term; or
- introduces a bounded context or a translation between contexts.

State the affected bounded contexts and terms in architecture-decision work. Review the change against relevant ADRs and update code, documentation, tests and agentic primitives that express the changed model. A significant or cross-cutting model change requires the repository's architecture-decision process.

An `avoid` entry names wording that can hide or confuse the intended meaning. It is review guidance within that term's context, not a repository-wide forbidden-word rule. Exact names from external systems, identifiers and quotations may remain unchanged. Explain their context or map them to the local term when the difference could be ambiguous.

## Enforcement boundary

`scripts/validate-domain-language.mjs` checks the structure of the canonical register. CI also checks that the register, this documentation, agent instructions and the reusable skill remain linked. These checks can detect malformed data, duplicate names and broken references.

Automation cannot prove that prose or code expresses the intended model. Agents and human reviewers must check semantic consistency, ambiguity and context. The repository deliberately does not scan all text for forbidden words.

Agentic primitives carry a small `primitive reference` comment naming their
governing ADRs and bounded contexts. The generated traceability index is
derived from those comments; it is not a second editable decision map and its
presence does not load complete ADRs into a model context.

## Sources

- [Eric Evans, *Domain-Driven Design Reference* (2015)](https://www.domainlanguage.com/wp-content/uploads/2016/05/DDD_Reference_2015-03.pdf): Bounded Context, Ubiquitous Language and Continuous Integration.
- [ADR-0001: Use MADR and GitHub Issues for architectural decisions](../decisions/0001-use-madr-for-architecture-decisions.md).
- [ADR-0002: Use plain language for human-agent communication](../decisions/0002-use-plain-language-for-human-agent-communication.md).
- [ADR-0003: Use context-scoped ubiquitous language](../decisions/0003-use-context-scoped-ubiquitous-language.md).
- [ADR-0004: Use trunk-based delivery with short-lived feature branches](../decisions/0004-use-trunk-based-delivery.md).
- [ADR-0005: Use Conventional Commits with Gitmoji](../decisions/0005-use-conventional-commits-with-gitmoji.md).
- [ADR-0006: Curate a human-readable changelog](../decisions/0006-curate-a-changelog.md).
- [ADR-0012: Use GitHub as the lifecycle control plane](../decisions/0012-use-github-as-the-lifecycle-control-plane.md).
- [ADR-0013: Derive ADR traceability from agentic primitives](../decisions/0013-derive-adr-traceability-from-agentic-primitives.md).
- [ADR-0014: Use a repository-scoped GitHub App](../decisions/0014-use-a-repository-scoped-github-app.md).
- [ADR-0015: Isolate resumable runner execution](../decisions/0015-isolate-resumable-runner-execution.md).
- [ADR-0016: Require structured pull request descriptions](../decisions/0016-require-structured-pull-request-descriptions.md).
