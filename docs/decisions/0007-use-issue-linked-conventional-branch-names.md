---
date: 2026-09-06
source-issue: https://github.com/sjefsharp/agentic-delivery/issues/11
decision-makers: Sjef Jenniskens
consulted: None
informed: None
domains:
  - agentic-delivery-governance
required-enforcement:
  - deterministic
---

# Use issue-linked Conventional branch names

## Context and Problem Statement

Issue [#11](https://github.com/sjefsharp/agentic-delivery/issues/11) asks the repository to improve branch naming based on trunk-based delivery and Conventional Commits. A branch name should show the kind of change and make its source issue immediately traceable. The repository also needs an early, repeatable way to reject work that starts from a closed issue.

The affected bounded context is `agentic-delivery-governance`. The relevant terms are `short-lived feature branch`, `source issue`, `issue-linked branch name`, `trunk` and `conventional commit`.

## Decision Drivers

- Keep `main` as the only integration trunk and preserve short-lived branches.
- Make the change type and source issue visible without opening GitHub.
- Find invalid names before dependency installation or review.
- Prevent supported branch creation from starting with a closed issue.
- Keep local checks deterministic and CI checks authoritative.

## Considered Options

- An issue-linked name that starts with a Conventional Commit type.
- The existing `feature/issue-<number>-<summary>` convention.
- An issue number and summary without a change type.
- Unrestricted branch names with review-only enforcement.

## Decision Outcome

Chosen option: **Use an issue-linked branch name with a Conventional Commit type**, because it combines traceability, recognizable change intent and early structural validation.

Change branches use this form:

```text
<type>/issue-<number>-<lowercase-kebab-case-summary>
```

Allowed types are `build`, `chore`, `ci`, `docs`, `feat`, `fix`, `perf`, `refactor`, `revert`, `style` and `test`. The issue number must be positive. The summary contains one or more lowercase alphanumeric words separated by single hyphens.

The source issue check accepts only an open GitHub Issue in this repository. A GitHub sub-issue is valid when it is open. A pull request number, closed issue, missing issue, API error or authentication error is rejected. The local branch starter performs this check before `git switch -c`; CI repeats it for every internal pull request. The branch validator rejects `main`, which is the protected trunk rather than a change branch.

The repository cannot intercept a contributor who invokes raw `git switch -c` directly. The supported `pnpm branch:start <type> <issue-number> <summary>` command prevents that error before branch creation, while the pull-request check prevents an invalid branch from entering the review workflow.

### Consequences

- Good, because the branch type and source issue are visible in Git and pull-request lists.
- Good, because a closed or unreachable source issue fails before supported branch creation.
- Good, because local syntax checks do not require a network connection.
- Good, because CI rechecks the external issue state with least-privilege read access.
- Bad, because contributors need GitHub CLI authentication for supported branch creation.
- Bad, because a raw Git command can still bypass the local helper until CI runs.
- Neutral, because semantic correctness of the type and summary remains a review responsibility.

### Confirmation

- `scripts/validate-branch-name.mjs` checks the local name grammar.
- `scripts/validate-source-issue.mjs` checks repository, URL type and open state through GitHub CLI locally and the GitHub REST API in Actions.
- `scripts/start-issue-branch.mjs` requires a clean, synchronized `main` and runs both validators before creating a branch.
- Delivery tests cover valid names, malformed names, open and closed issues, pull request numbers, API failures and branch-creation guardrails.
- `delivery-quality.yml` validates the pull-request head branch before installing dependencies.
- Human reviewers confirm that the type, summary and source issue describe the same change.

## Pros and Cons of the Options

### Issue-linked Conventional branch names

- Good, because Conventional Commit types provide a familiar change vocabulary.
- Good, because the issue number provides direct traceability.
- Bad, because the local convention is stricter than Git's branch-name rules.

### Existing `feature/issue-<number>-<summary>` convention

- Good, because it is already familiar from earlier repository branches.
- Bad, because `feature` does not distinguish fixes, documentation or delivery changes.
- Bad, because it does not reuse the repository's existing Conventional Commit vocabulary.

### Issue number and summary without a change type

- Good, because the grammar is shorter.
- Bad, because branch intent is less visible and reviewers must infer it from the diff.

### Unrestricted names with review-only enforcement

- Good, because it imposes no local tooling requirements.
- Bad, because violations are found late and branch traceability is inconsistent.

## More Information

- Assignment brief: [GitHub issue #11](https://github.com/sjefsharp/agentic-delivery/issues/11)
- Review and implementation: [pull request #13](https://github.com/sjefsharp/agentic-delivery/pull/13)
- Related decision: [ADR-0004](0004-use-trunk-based-delivery.md)
- Related decision: [ADR-0005](0005-use-conventional-commits-with-gitmoji.md)
- Domain register: [`ubiquitous-language.yml`](../domain/ubiquitous-language.yml)
- Delivery guidance: [`docs/delivery/README.md`](../delivery/README.md)
- Revisit this decision if automated contributors require a branch naming exception or if the repository adopts a different issue-tracking boundary.
