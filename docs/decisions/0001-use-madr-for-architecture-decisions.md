---
date: 2026-09-05
source-issue: https://github.com/agentic-delivery-lab/agentic-delivery/issues/1
decision-makers: Sjef Jenniskens
domains:
  - agentic-delivery-governance
required-enforcement:
  - instructional
  - deterministic
---

# Use MADR and GitHub Issues for architectural decisions

## Context and Problem Statement

Issue [#1](https://github.com/agentic-delivery-lab/agentic-delivery/issues/1) asks how this repository should record architectural decisions and how ChatGPT and Codex CLI should work with them. An issue is an assignment brief and audit trail, not automatically an ADR. A decision may emerge during triage, refining or implementation.

The repository needs a small convention that keeps reasons close to the code, gives agents reliable context and records additions and removals. A branch may need a decision before that decision is official for the whole repository. The default branch must therefore be the only source of official ADR context.

## Decision Drivers

- Keep the process simple for one maintainer and future contributors.
- Keep official decisions in the repository and version them with the code they explain.
- Make branch-local proposals and removals useful without presenting them as repository-wide truth.
- Keep the issue as the audit trail for the request, discussion, rejection and completed action.
- Require an approved pull request before a change reaches `main`.
- Avoid duplicated status sources and privileged status-writing automation.
- Keep the process usable by ChatGPT, Codex CLI and a future Codex review agent.

## Considered Options

### Branch-local ADRs with protected `main`

Keep ADRs as Markdown files under `docs/decisions/`. Add or remove them on a feature branch and review the complete change in a pull request. A file on `main` is official; a file only on a feature branch is provisional. Branch protection makes approval and merge the acceptance boundary.

### ADR status in YAML frontmatter with an acceptance workflow

Store `proposed`, `accepted` or another lifecycle value in each ADR and change it with GitHub Actions after review. This creates a second state source, needs extra workflow security and does not work naturally when the only PR author cannot approve their own pull request.

### GitHub Issues as the only ADR store

Keep the rationale and decision only in issue discussions. This gives a useful audit trail but makes official repository context harder to discover and use without tracker access.

## Decision Outcome

Chosen option: **Branch-local ADRs with protected `main`**, because branch contents and the pull-request boundary provide one simple source of truth without a status mutation workflow.

The process is:

1. Start with any GitHub Issue as the assignment brief. It may be a normal product or implementation issue.
2. If triage or refining identifies an architectural decision, create a sub-issue from the architecture-decision issue form. If the original issue already uses that form, use it directly.
3. If the need appears during implementation, create or update the issue or sub-issue before adding the ADR to the feature branch.
4. For a new decision, add the ADR in the feature branch. For a changed decision, remove the affected ADR there. Update related agent primitives, README files and Markdown in that branch when needed.
5. A branch-local addition or removal applies only to that branch. Agents on other branches use only ADR files on `main` as official context.
6. Open or update a pull request that links the relevant issue or sub-issue. Put the ADR-tracking issue in the PR body with `Closes #123`; use `Refs #123` for a broader parent that must remain open. Approval alone does not close the issue.
7. Merge only through protected `main` after the required approval and checks. A merged addition is accepted because it is present on `main`; a merged removal removes the decision from official context.
8. Update the relevant issue after merge with the action, pull request and commit links. A `Closes #123` reference closes the ADR-tracking issue at merge; otherwise close it explicitly. Keep a broader parent open when implementation remains.
9. If a proposal is rejected, do not merge it. Record the reason in the issue, apply `adr:rejected` and close the ADR-tracking issue. The closed pull request and Git history retain the proposal without adding it to `main`.

ADR files have no lifecycle status in their YAML frontmatter. No GitHub Action accepts or deletes an ADR.

### Consequences

- Good, because `main` is the only official ADR context and no duplicated status can become stale.
- Good, because a branch can add or remove an ADR next to the implementation it explains.
- Good, because the issue, sub-issue, pull request and Git history provide an audit trail.
- Good, because agents can follow the same branch model without privileged acceptance automation.
- Bad, because branch protection is an operational prerequisite and must disallow direct pushes and bypasses.
- Bad, because a sole maintainer needs another reviewer identity for a required approval.
- Bad, because the current private-repository GitHub plan may require an upgrade before branch protection is available.
- Neutral, because rejected proposals are absent from `main` but remain in issues and Git history.

### Confirmation

- The ADR template has no `status` field, and the validator rejects one.
- The canonical index says that only files on `main` are official context.
- The issue form supports an ADR decision and an ADR removal.
- Agent instructions cover generic issues, triage, implementation-time decisions, branch-local context and removals.
- Acceptance workflows, status-mutating scripts and obsolete tests are absent.
- Protected `main` requires pull requests, approvals and required checks; the repository setting is verified separately from local tests.

## Pros and Cons of the Options

### Branch-local ADRs with protected `main`

- Good, because one branch is authoritative and merge is the only repository-wide transition.
- Good, because the same process supports additions and removals.
- Bad, because GitHub branch protection must be configured correctly.

### ADR status in YAML frontmatter with an acceptance workflow

- Good, because status is visible inside the record.
- Bad, because status duplicates branch state and needs privileged automation.
- Bad, because the review model breaks for a sole PR author without another reviewer.

### GitHub Issues as the only ADR store

- Good, because issue discussion is easy to update during triage.
- Bad, because agents and readers depend on tracker context for the durable decision.
- Bad, because the decision is less discoverable beside the implementation.

## More Information

- Assignment brief: [GitHub issue #1](https://github.com/agentic-delivery-lab/agentic-delivery/issues/1)
- Review and implementation: [pull request #2](https://github.com/agentic-delivery-lab/agentic-delivery/pull/2)
- Format reference: [MADR](https://adr.github.io/madr/)
- Agent instruction loading: [OpenAI Docs — AGENTS.md](https://developers.openai.com/codex/guides/agents-md)
- Reusable agent skills: [OpenAI Docs — Build skills](https://developers.openai.com/codex/skills)
- Protected branches: [GitHub protected branches](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches)
