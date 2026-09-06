---
date: 2026-09-05
source-issue: https://github.com/sjefsharp/agentic-delivery/issues/1
decision-makers: Sjef Jenniskens
---

# Use MADR and GitHub Issues for Architectural Decisions

## Context and Problem Statement

Issue [#1](https://github.com/sjefsharp/agentic-delivery/issues/1) asks how this repository should capture architectural decisions and how ChatGPT and Codex CLI should participate. An issue is an assignment brief and audit trail, but it is not automatically an architectural decision. A decision may emerge during issue triage, refining or implementation.

The repository needs a simple convention that keeps the rationale close to the code, gives agents reliable context and records both new decisions and removals. A decision may be relevant to the feature branch where it is created before it is accepted repository-wide. The default branch must remain the only source of truth for official ADR context.

## Decision Drivers

- Keep the process simple enough for a single maintainer and future contributors.
- Keep official decisions close to the repository and version them with the code they explain.
- Make branch-local proposals and removals useful to the current implementation without presenting them as repository-wide truth.
- Preserve the issue as the audit trail for the request, discussion, rejection reason and completed action.
- Require an approved pull request before an ADR addition or removal reaches `main`.
- Avoid status drift between YAML frontmatter, branches and GitHub metadata.
- Avoid a separate acceptance workflow or privileged status-writing automation.
- Keep the process usable by ChatGPT, Codex CLI and a future Codex review agent.

## Considered Options

### Branch-local ADRs with protected `main`

Keep ADRs as Markdown files under `docs/decisions/`. Create or remove them in a feature branch and review the complete change in a pull request. A file present on `main` is official; a file added or removed only on a feature branch is provisional for that branch. Branch protection makes an approved pull request and merge the acceptance or removal boundary.

### ADR status in YAML frontmatter with an acceptance workflow

Store `proposed`, `accepted` or other lifecycle values in each ADR and use GitHub Actions to change the value after review. This creates a second state source, requires extra workflow security and does not work naturally when the sole PR author cannot approve their own pull request.

### GitHub Issues as the only ADR store

Keep the rationale and decision only in issue discussions. This gives a useful audit trail but makes official repository context harder to discover, compare and consume without tracker access.

## Decision Outcome

Chosen option: **Branch-local ADRs with protected `main`**, because branch contents plus the pull-request boundary provide one simple source of truth without a status mutation workflow.

The process is:

1. Start with any GitHub Issue as the assignment brief. The issue may be a normal product or implementation issue.
2. If triage or refining identifies an architectural decision, create a sub-issue from the architecture-decision issue form. If the original issue already uses that form, use it directly.
3. If the need appears during implementation, create or update the issue or sub-issue before adding the ADR to the feature branch.
4. For a new decision, add the ADR file in the feature branch. For a changed decision, remove the affected ADR in the feature branch. Update related agent primitives, README files and Markdown in that same branch when required.
5. The branch-local addition or removal is valid for the current branch only. Agents use it as provisional context there, while agents on other branches use only ADR files present on `main` as official context.
6. Merge only through protected `main` after the required pull-request approval and checks succeed. A merged addition is accepted by presence on `main`; a merged removal removes the decision from official context.
7. Update the relevant issue after the merge with the action, pull request and commit links, then close the ADR-tracking issue. Keep a broader parent issue open when it still contains implementation work.
8. If a proposal is rejected, do not merge it. Record the reason in the issue, apply the rejection label and close the ADR-tracking issue. The closed pull request and Git history retain the rejected proposal without adding it to `main`.

ADR files do not contain a lifecycle status in their YAML frontmatter. The presence or absence of the file on `main` is the official state. No GitHub Action is responsible for accepting or deleting an ADR.

### Consequences

- Good, because `main` is the only official ADR context and there is no duplicated status to become stale.
- Good, because a branch can introduce or remove an ADR alongside the implementation it explains.
- Good, because issue, sub-issue, pull request and Git history provide an auditable trail for additions, removals and rejections.
- Good, because agents can use the same branch model without a privileged acceptance helper.
- Bad, because branch protection is an operational prerequisite and must disallow direct pushes and bypasses to enforce the rule.
- Bad, because a sole maintainer needs a separate reviewer identity, such as a future Codex review agent or another human, to satisfy a required approval.
- Bad, because the current private-repository GitHub plan may require an upgrade before branch protection is available.
- Neutral, because rejected proposals are not listed in `main`; their reasons remain in issues and their content remains in Git history.

### Confirmation

- The ADR template contains no `status` field and the validator rejects status fields in ADR frontmatter.
- The canonical index states that only files on `main` are official context.
- The issue form supports an ADR decision or removal and can be used for a sub-issue.
- The agent instructions cover generic source issues, triage/refining, implementation-time decisions, branch-local context and removals.
- The old acceptance workflows, status-mutating scripts and their tests are absent.
- Protected `main` requires pull requests, approvals and required checks; the repository setting is verified separately from local tests.

## Pros and Cons of the Options

### Branch-local ADRs with protected `main`

- Good, because one branch is authoritative and the merge is the only repository-wide transition.
- Good, because it is easy to explain and works for additions and removals.
- Bad, because GitHub branch protection must be configured correctly.

### ADR status in YAML frontmatter with an acceptance workflow

- Good, because the status is visible inside the record.
- Bad, because the status duplicates branch state and needs privileged automation.
- Bad, because the review model breaks for a sole PR author without another reviewer.

### GitHub Issues as the only ADR store

- Good, because issue discussion is easy to update during triage.
- Bad, because repository agents and readers must depend on tracker context for the durable decision.
- Bad, because the decision is less discoverable beside the implementation.

## More Information

- Assignment brief: [GitHub issue #1](https://github.com/sjefsharp/agentic-delivery/issues/1)
- Review and implementation: [pull request #2](https://github.com/sjefsharp/agentic-delivery/pull/2)
- Format reference: [MADR](https://adr.github.io/madr/)
- Agent instruction loading: [OpenAI Docs — AGENTS.md](https://developers.openai.com/codex/guides/agents-md)
- Reusable agent skills: [OpenAI Docs — Build skills](https://developers.openai.com/codex/skills)
- Protected branches: [GitHub protected branches](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches)
