# Architectural Decisions

This directory is the canonical, version-controlled log of architectural decisions for this repository. Records use the [MADR](https://adr.github.io/madr/) Markdown format and explain one significant choice, its rationale, alternatives and consequences.

## Create a decision record

Start with a GitHub Issue as the assignment brief. Include the problem, scope, decision drivers, constraints, known options, reversibility/impact, owner and desired decision date. Link the issue from the eventual ADR and pull request.

Copy [`adr-template.md`](adr-template.md) to the next filename in the global sequence:

```text
docs/decisions/NNNN-title-with-dashes.md
```

Use lowercase dashed titles and four consecutive digits (`0001`, `0002`, …). Do not create a second numbering scheme in a subdirectory. If two branches choose the same next number, keep the record with the merged pull request's number and renumber the other before merge.

## When to propose an ADR

Propose an ADR when a choice is architecturally significant and has meaningful alternatives. At least one of these signals should apply:

- the choice is costly or risky to reverse;
- it affects multiple components, teams or future changes;
- it establishes a public interface, data ownership, security/privacy posture, availability or performance characteristic, deployment model or important dependency;
- it introduces or intentionally changes a repository-wide standard;
- the rationale is likely to be revisited and needs durable traceability.

Do not create an ADR for a local, easily reversible implementation detail, an ordinary bug fix, a purely editorial change, or a choice with no meaningful alternative or lasting consequence. When uncertain, record the question in the source issue and ask for a human decision about whether an ADR is warranted.

## Review and lifecycle

1. The source issue is the assignment brief and discussion history.
2. The ADR pull request starts with status `proposed` and records the research, options and recommendation.
3. A human reviewer checks the rationale, consequences and confirmation criteria.
4. After explicit approval, change the status to `accepted` and merge the pull request.
5. Close the source issue with links to the accepted ADR and merged pull request.
6. For a changed decision, create a new record and mark the prior one `superseded by ADR-NNNN` or `deprecated`; never erase the historical record.

The allowed statuses are `proposed`, `accepted`, `rejected`, `deprecated` and `superseded by ADR-NNNN`. `rejected` is for a documented proposal that will not be adopted; a rejected proposal may remain only when its rationale is useful to the history.

## Agent workflow

The root [`AGENTS.md`](../../AGENTS.md) should route agents here and to the repository skill at [`.agents/skills/architecture-decision/SKILL.md`](../../.agents/skills/architecture-decision/SKILL.md). The skill may research and draft a complete `proposed` record, but it must not accept an ADR, merge a pull request or close an issue without explicit human authorization.

## Records

| Number | Decision | Status | Source | Review |
| --- | --- | --- | --- | --- |
| [0001](0001-use-madr-for-architecture-decisions.md) | Use MADR and GitHub Issues for architectural decisions | Proposed | [Issue #1](https://github.com/sjefsharp/agentic-delivery/issues/1) | [PR #2](https://github.com/sjefsharp/agentic-delivery/pull/2) |
