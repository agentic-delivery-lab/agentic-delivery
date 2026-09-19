---
date: 2026-09-16
source-issue: https://github.com/agentic-delivery-lab/agentic-delivery/issues/44
decision-makers: Sjef Jenniskens
consulted: GitHub Docs and Microsoft Engineering Fundamentals
informed: None
domains:
  - agentic-delivery-governance
required-enforcement:
  - instructional
  - deterministic
---

# Require structured pull request descriptions

## Context and Problem Statement

Issue [#44](https://github.com/agentic-delivery-lab/agentic-delivery/issues/44)
asks this repository to use the organization pull request template without a
local override and to make its contents a required review input. A template by
itself is advisory: an author or coding agent can leave sections empty, while
Dependabot does not know the repository's planning and evidence contract.

GitHub can make a stable Actions job a required status check through a branch
ruleset. The repository was private when this decision was drafted and the
Rulesets API rejected that scope. It is public now, so the repository endpoint
is available, but the workflow is not yet on `main` and the active rule has not
been verified. The repository must distinguish the desired, versioned rule
from live hosting enforcement and must not claim that an unactivated control is
active.

## Decision Drivers

- Keep one organization pull request template as the canonical default.
- Give reviewers separate `Source` and `Plan` sections for the source issue,
  implementation plan and deviations, followed by evidence,
  risks, delivery guidance and requested review focus.
- Make the structural contract deterministic and visible as one stable check.
- Evaluate trusted base-branch validator code without executing pull-request
  code or exposing secrets.
- Keep automated dependency updates usable without giving bots a broad ruleset
  bypass.
- Preserve a reviewable ruleset definition until an authorized maintainer
  activates and verifies it after the workflow is on `main`.
- Keep human merge authority and repository-specific semantic review.

## Considered Options

- Organization template, deterministic base-branch check, narrow Dependabot
  exemption, and a versioned required-check ruleset.
- Repository-local template with a repository-local check.
- Advisory organization template without deterministic validation.
- A ruleset bypass for Dependabot or all bots.

## Decision Outcome

Chosen option: **Organization template with a deterministic check and a narrow
Dependabot exemption**, because it centralizes the author guidance while
keeping repository-specific validation, agent instructions and review evidence
under version control.

The repository will not contain a local pull request template. Pull request
authors and coding agents must complete the organization template, including
separate `Source` and `Plan` headings. A combined `Source and plan` heading is
invalid. A dedicated
`pull_request_target` workflow checks the body for all relevant body and
revision events. It checks out the trusted base commit, has read-only contents
permission, uses no secrets and never executes code from the pull request.

The job name is `Validate pull request body`. It validates every author except
the exact pull request author `dependabot[bot]`. Dependabot still receives a
visible successful result from the same job. Other bots, GitHub Apps, users,
teams and administrators are not exempt. The ruleset has no bypass actors,
because a ruleset bypass would waive more than the pull request body contract.

The versioned ruleset requires the stable job on the default branch. It is a
desired control, not current hosting state. An operator may activate it only
after the workflow has reached `main`, reported the expected check, and the
live ruleset has been verified through GitHub.

### Consequences

- Good, because reviewers receive a consistent description from people and
  coding agents.
- Good, because the validator is testable and runs trusted base-branch code.
- Good, because Dependabot is exempt only from this description contract and
  does not bypass unrelated review or status-check rules.
- Bad, because the first pull request that introduces the workflow cannot run
  the new base-branch workflow until the change is merged.
- Bad, because activation is a separate privileged operation after the
  workflow merge and cannot be proven by repository files alone.
- Neutral, because deterministic structure does not prove that an answer is
  complete or true; reviewers still assess meaning and evidence.

### Confirmation

- Contract tests reject every supported repository-local pull request template
  location.
- Unit tests cover complete bodies, missing content, unchecked author items,
  the exact Dependabot exemption and rejection of other bots.
- Workflow contract tests verify events, permissions, base-commit checkout,
  stable job name and absence of secrets.
- The automated delivery controller produces a body that passes the same
  validator, and agentic primitives instruct coding agents to follow it.
- The versioned ruleset has no bypass actors and requires only
  `Validate pull request body` on the default branch.
- The repository is public and the endpoint is now queryable; documentation
  records the post-merge activation procedure and keeps live enforcement
  unclaimed until an administrator verifies it.

## Pros and Cons of the Options

### Organization template with deterministic validation

- Good, because organization guidance has one source while repository policy
  remains testable.
- Good, because one always-reported job can become a required status check.
- Bad, because template changes and validator changes must remain compatible.

### Repository-local template and validation

- Good, because both files could change in one repository pull request.
- Bad, because the local file overrides and duplicates the organization
  default, which is the opposite of the requested ownership boundary.

### Advisory template only

- Good, because it adds no workflow maintenance.
- Bad, because empty or placeholder descriptions reach review without a clear
  signal.

### Ruleset bypass for bots

- Good, because bot pull requests would never be blocked by this check.
- Bad, because the bypass can waive unrelated rules and is broader than the
  required Dependabot exception.

## More Information

- Organization template proposal:
  [`agentic-delivery-lab/.github#2`](https://github.com/agentic-delivery-lab/.github/pull/2)
- [GitHub ruleset availability](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/about-rulesets)
- [GitHub required-status-check behavior](https://docs.github.com/en/pull-requests/how-tos/merge-and-close-pull-requests/troubleshooting-required-status-checks)
- [GitHub Dependabot Actions behavior](https://docs.github.com/en/code-security/reference/supply-chain-security/dependabot-on-actions)
- [GitHub Rulesets REST API](https://docs.github.com/en/rest/repos/rules)
- Related decisions: [ADR-0004](0004-use-trunk-based-delivery.md),
  [ADR-0011](0011-run-layered-harness-architecture-reviews.md), and
  [ADR-0012](0012-use-github-as-the-lifecycle-control-plane.md).
- This decision is provisional on its feature branch and becomes official only
  after its review pull request is merged into `main`.
