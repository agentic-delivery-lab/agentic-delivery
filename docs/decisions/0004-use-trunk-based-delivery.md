---
date: 2026-09-06
source-issue: https://github.com/sjefsharp/agentic-delivery/issues/7
decision-makers: Sjef Jenniskens
consulted: None
informed: None
domains:
  - agentic-delivery-governance
required-enforcement:
  - instructional
  - deterministic
---

# Use trunk-based delivery with short-lived feature branches

## Context and Problem Statement

Issue [#7](https://github.com/sjefsharp/agentic-delivery/issues/7) asks the repository to introduce trunk-based development. The repository needs a delivery model that keeps `main` deployable, gives a review pull request a clear head and base, and does not leave parallel branch histories to drift.

The repository is maintained by people and coding agents. Agents need an explicit boundary for branch creation, review and merge actions. A branch-local change is provisional until its review pull request is merged into `main`; the contents of `main` remain the official repository context.

## Decision Drivers

- Keep `main` continuously integrable and deployable.
- Make review pull-request head and base unambiguous.
- Limit merge conflicts and stale branch context.
- Preserve a reviewable history for this governance repository.
- Keep merge and issue-closing authority with a human.
- Make the policy observable in local checks and CI where possible.

## Considered Options

- Trunk-based delivery with one `main` branch and short-lived feature branches.
- Gitflow with permanent `develop`, release and hotfix branches.
- Direct commits to `main` without a feature branch or review pull request.

## Decision Outcome

Chosen option: **Trunk-based delivery with one `main` branch and short-lived feature branches**, because it keeps integration frequent while retaining a review boundary for every change.

Contributors create a feature branch from the current `main`, open a review pull request with that branch as its head and `main` as its base, and merge only after checks and human review succeed. A feature branch should be completed within two calendar days. The repository does not create a permanent `develop` branch or a long-lived branch for ordinary feature work.

This repository uses merge commits for approved pull requests so the integration event remains visible in history. The repository settings disable squash merges, rebase merges and automatic merging. The contributor or agent may push the feature branch and open or update the review pull request, but only an explicitly authorized human may merge it or close its source issue. A merged head branch is deleted when the hosting service supports that setting.

The policy follows the [Trunk Based Development guidance](https://trunkbaseddevelopment.com/). The two-day target and merge-commit choice are local operating rules for this repository, not claims made by that source.

### Consequences

- Good, because `main` remains the single integration point and official source of truth.
- Good, because short-lived branches reduce divergence and make review scope clear.
- Good, because merge commits show when a review pull request entered `main`.
- Bad, because incomplete work needs a feature flag or another safe, reversible boundary.
- Bad, because contributors must keep a branch current and finish work promptly.
- Neutral, because release branches remain possible when a future release needs stabilization.

### Confirmation

- `AGENTS.md`, the delivery skill and the pull-request template state that the feature branch is the pull-request head and `main` is the base.
- The delivery-quality workflow checks that new first-parent commits on `main` are merge commits and validates pull-request commit ranges.
- Repository settings allow merge commits, disable squash/rebase/automatic merging and delete merged head branches.
- Reviewers check branch age, head/base selection and human authorization before merging.

## Pros and Cons of the Options

### Trunk-based delivery with short-lived feature branches

- Good, because integration happens frequently and the branch lifetime is bounded.
- Good, because every change has a review pull request without introducing a second trunk.
- Bad, because contributors need disciplined small increments and feature flags for unfinished work.

### Gitflow with permanent `develop`, release and hotfix branches

- Good, because release stabilization can be separated from feature integration.
- Bad, because permanent branches add merge points and allow context to become stale.
- Bad, because the repository has no release process that justifies the extra long-lived branches.

### Direct commits to `main`

- Good, because it has no branch-management overhead.
- Bad, because it removes the review pull-request boundary and makes agent authorization unsafe.
- Bad, because a mistake immediately changes the official source of truth.

## More Information

- Assignment brief: [GitHub issue #7](https://github.com/sjefsharp/agentic-delivery/issues/7)
- Source: [Trunk Based Development](https://trunkbaseddevelopment.com/)
- Related decisions: [ADR-0001](0001-use-madr-for-architecture-decisions.md), [ADR-0003](0003-use-context-scoped-ubiquitous-language.md)
- Delivery guidance: [`docs/delivery/README.md`](../delivery/README.md)
- Revisit this decision when the repository needs a release branch, a second integration trunk or a different merge authority.
