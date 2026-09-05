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
4. After an explicit approval, the trusted ADR workflow changes the status to `accepted`; merge remains gated by the repository's review rules.
5. Use a closing keyword such as `Closes #NNN` in the pull request so GitHub closes the source issue when the pull request merges.
6. For a changed decision, create a new record and mark the prior one `superseded by ADR-NNNN` or `deprecated`; never erase the historical record.

The allowed statuses are `proposed`, `accepted`, `rejected`, `deprecated` and `superseded by ADR-NNNN`. `rejected` is for a documented proposal that will not be adopted; a rejected proposal may remain only when its rationale is useful to the history.

## Automated acceptance

The [`adr-approval-signal.yml`](../../.github/workflows/adr-approval-signal.yml) workflow listens for submitted pull-request reviews but has no permissions, secrets or repository checkout. Only an eligible approval on a same-repository pull request targeting the default branch produces a successful signal.

The [`adr-accept-on-approval.yml`](../../.github/workflows/adr-accept-on-approval.yml) workflow runs from the trusted default branch after that signal. On the existing self-hosted runner it rechecks the current pull request, review, head commit and changed files through the GitHub API, then changes exactly one `docs/decisions/NNNN-*.md` record from `proposed` to `accepted`. The update is idempotent and refuses forks, stale approvals, ambiguous ADR changes and non-proposed statuses. It does not execute pull-request code.

The status update is a code-modifying commit. If branch protection dismisses stale approvals for every new commit, the reviewer may need to approve the resulting status-only commit again; configure the repository review rule with that consequence in mind.

## Agent workflow

The root [`AGENTS.md`](../../AGENTS.md) should route agents here and to the repository skill at [`.agents/skills/architecture-decision/SKILL.md`](../../.agents/skills/architecture-decision/SKILL.md). The skill may research and draft a complete `proposed` record, but it must not accept an ADR, merge a pull request or close an issue without explicit human authorization. The workflow above is the only automated status transition, and it is triggered by GitHub's recorded human approval rather than by an agent.

## Records

| Number | Decision | Status | Source | Review |
| --- | --- | --- | --- | --- |
| [0001](0001-use-madr-for-architecture-decisions.md) | Use MADR and GitHub Issues for architectural decisions | Proposed | [Issue #1](https://github.com/sjefsharp/agentic-delivery/issues/1) | [PR #2](https://github.com/sjefsharp/agentic-delivery/pull/2) |
