# Architectural decisions

This directory is the repository's versioned decision log. Each record uses the MADR structure and explains one important choice, its reasons, alternatives and effects.

## Main is the source of truth

An ADR file on the default branch `main` is an official repository decision. A file added or removed only on a feature branch is provisional for that branch until its pull request is merged.

ADR frontmatter has no lifecycle status. The branch state supplies the status:

- present on `main`: official decision;
- added only on a feature branch: proposed decision for that branch;
- removed only on a feature branch: proposed removal for that branch; or
- absent from `main`: no official decision record.

Agents use ADR files from `main` as canonical context. On a feature branch they may also use that branch's additions or removals as provisional context. A branch that is behind `main` may not include the latest official decisions.

## Source issue and ADR tracking issue intake

A GitHub Issue is an assignment brief and audit trail, not automatically an ADR. It may be a normal product or implementation issue.

The source issue also serves as the ADR tracking issue when it directly tracks the decision work. During triage or refining, create a linked sub-issue with the architecture-decision issue form when a separate ADR tracking issue is useful. If the original issue already uses that form, use it directly. If the need appears during implementation, create or update the ADR tracking issue before adding the ADR to the feature branch. For a removal, record the affected ADR path and the reason there.

If no source issue is supplied, search existing issues read-only and present a likely candidate for confirmation. If no suitable issue exists, show an issue-form preview and require explicit confirmation before creating one. Stop on search, authentication or access failures. Never replace an inaccessible issue or publish a partial issue.

## Runbook

1. Identify the source issue and its ADR tracking issue. Create a linked sub-issue when separate tracking is useful.
2. Add `adr:needed` when triage finds that an ADR change is required.
3. Create a feature branch. Add a new ADR or remove an existing ADR there. The feature branch is the pull-request head; never create a pull request from `main`, which is only the protected base.
4. Update related agent primitives, README files and Markdown in the same branch when the decision affects them.
5. Add `adr:proposed` for an active ADR branch or pull request. Add `adr:removal` as well for a deletion.
6. Open or update a review pull request that links the source issue and describes the ADR change. Put the ADR tracking issue in the pull-request body with `Closes #123`, or use `Refs #123` when a broader source issue must remain open. Approval alone does not close the issue.
7. Merge only through protected `main` after the required review and checks succeed, and only with explicit human authorization.
8. After merge, update the source issue and ADR tracking issue with the action and links, remove active labels and close the ADR tracking issue. A `Closes #123` reference closes it during the merge; otherwise close it explicitly. Keep a broader source issue open when other work remains.

The repository has no acceptance workflow. A merged addition is accepted because it is present on `main`; a merged deletion removes the decision from official context. Branch protection must prevent direct pushes and bypasses.

## Rejection and removal

Do not merge a rejected proposal. Record the reason in the ADR tracking issue, apply `adr:rejected` and close that issue. The closed review pull request and Git history retain the proposal without adding it to `main`.

To remove an official ADR, create a feature branch and a pull request that deletes the file. The approved merge completes the removal.

## When to propose an ADR

Propose an ADR when a choice has meaningful alternatives and at least one of these signals applies:

- it is costly or risky to reverse;
- it affects multiple components, teams or future changes;
- it establishes or changes a public interface, data ownership, security/privacy posture, availability, performance, deployment model or important dependency;
- it introduces or changes a repository-wide standard; or
- its rationale is likely to be revisited and needs durable traceability.

Do not create an ADR for a local, easily reversible detail, an ordinary bug fix, a purely editorial change or a choice with no lasting alternative. When uncertain, record the question in the source issue and ask whether an ADR is warranted.

## Labels

Labels help triage and find work; `main` and Git history remain authoritative.

| Label | Meaning |
| --- | --- |
| `adr:needed` | Triage found an ADR change, but no ADR branch or PR exists yet |
| `adr:proposed` | An active branch or PR adds or changes an ADR |
| `adr:removal` | The active ADR change removes an existing record; combine it with `adr:proposed` |
| `adr:rejected` | The proposal was rejected and the reason is recorded in the issue |

After a successful merge, remove active labels and close the ADR tracking issue. Do not add an `adr:accepted` label: a file on `main` is the accepted state.

## Records

Use four digits and a lowercase dashed name:

```text
docs/decisions/NNNN-title-with-dashes.md
```

The template intentionally lives beside README.md and the numbered records. Every record keeps a source-issue link, including when a separate ADR tracking issue is used.

| Number | Decision | Source | Review/implementation |
| --- | --- | --- | --- |
| [0001](0001-use-madr-for-architecture-decisions.md) | Use MADR and GitHub Issues for architectural decisions | [Issue #1](https://github.com/sjefsharp/agentic-delivery/issues/1) | [PR #2](https://github.com/sjefsharp/agentic-delivery/pull/2) |
| [0002](0002-use-plain-language-for-human-agent-communication.md) | Use plain language for human-agent communication | [Issue #3](https://github.com/sjefsharp/agentic-delivery/issues/3) | [PR #4](https://github.com/sjefsharp/agentic-delivery/pull/4) |
| [0003](0003-use-context-scoped-ubiquitous-language.md) | Use context-scoped ubiquitous language | [Issue #5](https://github.com/sjefsharp/agentic-delivery/issues/5) | [PR #6](https://github.com/sjefsharp/agentic-delivery/pull/6) |
| [0004](0004-use-trunk-based-delivery.md) | Use trunk-based delivery with short-lived feature branches | [Issue #7](https://github.com/sjefsharp/agentic-delivery/issues/7) | This review pull request |
| [0005](0005-use-conventional-commits-with-gitmoji.md) | Use Conventional Commits with Gitmoji | [Issue #7](https://github.com/sjefsharp/agentic-delivery/issues/7) | This review pull request |
| [0006](0006-curate-a-changelog.md) | Curate a human-readable changelog | [Issue #7](https://github.com/sjefsharp/agentic-delivery/issues/7) | This review pull request |
| [0007](0007-use-issue-linked-conventional-branch-names.md) | Use issue-linked Conventional branch names | [Issue #11](https://github.com/sjefsharp/agentic-delivery/issues/11) | This review pull request |
