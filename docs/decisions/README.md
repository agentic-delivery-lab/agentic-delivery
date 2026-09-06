# Architectural Decisions

This directory is the canonical, version-controlled log of architectural decisions for this repository. Records use the MADR structure and explain one significant choice, its rationale, alternatives and consequences.

## Main is the source of truth

An ADR file present on the default branch `main` is an official repository decision. An ADR added or removed in a feature branch is provisional and applies only to that branch until its pull request is merged.

ADR files do not contain a lifecycle status in their YAML frontmatter. The branch state is the status:

- file present on `main`: official decision;
- file added only on a feature branch: proposed decision for that branch;
- file removed only on a feature branch: proposed removal for that branch;
- file absent from `main`: no official decision record.

Agents use ADR files from `main` as canonical context. When working on a feature branch, an agent may also use that branch's ADR additions or removals as provisional context for the current work. A branch that has not incorporated the latest `main` may need to be synchronized before it reflects the current official decisions.

## Issue and sub-issue intake

A GitHub Issue is an assignment brief and audit trail, not automatically an ADR. The issue may be a normal product or implementation issue.

During triage or refining, create a sub-issue with the architecture-decision issue form when a meaningful architectural decision emerges. If the issue itself already uses that form, no sub-issue is needed. If the need appears during implementation, create or update an issue or sub-issue before adding the ADR to the feature branch. For an ADR removal, record the affected ADR path and the reason in the issue or sub-issue.

If no source issue is supplied, search existing issues read-only and present a likely candidate for confirmation. If no suitable issue exists, show an issue-form preview and require explicit confirmation before creating one. Stop on search/authentication failures, inaccessible issues or missing required context; never replace an inaccessible issue or publish a partial issue.

## Runbook

1. Identify the source issue or create the appropriate ADR sub-issue.
2. Add the label `adr:needed` when an ADR change is required.
3. Create a feature branch. Add a new ADR or remove an existing ADR in that branch.
4. Add or update related agent primitives, README files and Markdown in the same branch when the ADR change affects them.
5. Add `adr:proposed`; also add `adr:removal` for a deletion.
6. Open a pull request linking the issue and describe the ADR addition or removal.
7. Merge only through a protected `main` branch after the required pull-request approval and checks succeed.
8. After merge, update the issue with the action and links. Close the ADR-tracking issue; keep a broader parent issue open when other work remains.

The repository does not use an acceptance workflow. A merged addition is accepted because it is present on `main`; a merged deletion removes the decision from the official context. Branch protection must prevent direct pushes and bypasses if this rule is to be enforced.

## Rejection and removal

A proposal that is not adopted is not merged. Record the reason in the source issue, apply `adr:rejected` and close the ADR-tracking issue or sub-issue. The proposal remains available through the closed pull request and Git history without polluting `main`.

If an ADR already on `main` must be removed, create a normal feature branch and pull request that deletes the file. The approved merge of that removal PR is the complete action; no follow-up cleanup workflow is needed.

## When to propose an ADR

Propose an ADR when a choice is architecturally significant and has meaningful alternatives. At least one of these signals should apply:

- the choice is costly or risky to reverse;
- it affects multiple components, teams or future changes;
- it establishes or changes a public interface, data ownership, security/privacy posture, availability, performance, deployment model or important dependency;
- it introduces or changes a repository-wide standard;
- its rationale is likely to be revisited and needs durable traceability.

Do not create an ADR for a local, easily reversible implementation detail, an ordinary bug fix, a purely editorial change or a choice with no meaningful alternative or lasting consequence.

## Labels

Use a small, non-authoritative label state machine. `main` and Git history remain authoritative; labels help triage and find work.

| Label | Meaning |
| --- | --- |
| `adr:needed` | Triage identified an ADR change, but no ADR branch/PR exists yet |
| `adr:proposed` | An active branch or pull request adds or changes an ADR |
| `adr:removal` | The active ADR change removes an existing record; combine with `adr:proposed` |
| `adr:rejected` | The proposal was rejected and the reason is recorded in the issue |

After a successful merge, remove the active labels and close the ADR-tracking issue. Do not add an `adr:accepted` label: presence on `main` is the accepted state.

## Records

Records use four consecutive digits and lowercase dashed names:

```text
docs/decisions/NNNN-title-with-dashes.md
```

The template intentionally lives beside README.md and the numbered records so contributors and agents have one stable canonical path. Every record keeps a source-issue link, even though the source issue itself may be generic or may have an ADR sub-issue.

| Number | Decision | Source | Review/implementation |
| --- | --- | --- | --- |
| [0001](0001-use-madr-for-architecture-decisions.md) | Use MADR and GitHub Issues for architectural decisions | [Issue #1](https://github.com/sjefsharp/agentic-delivery/issues/1) | [PR #2](https://github.com/sjefsharp/agentic-delivery/pull/2) |
