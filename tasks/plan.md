# Implementation plan: branch-based ADR lifecycle

Issue [#1](https://github.com/sjefsharp/agentic-delivery/issues/1) defines the architecture-decision convention. An issue is the assignment brief, but it is not automatically an ADR. An ADR may arise during triage, refining or implementation. Additions and removals happen on a feature branch; only `main` is official repository context.

ADR files have no lifecycle status in their YAML frontmatter. An approved pull request to `main` makes an addition official; an approved removal makes it no longer official. Branch protection is the merge boundary. GitHub Actions only validate quality; they do not accept or mutate ADR status.

## Decisions

- Use `docs/decisions/NNNN-title-with-dashes.md` for official ADR records.
- Keep frontmatter limited to metadata such as the date, source issue and participants; do not add `status`.
- Use `main` as the only source of official ADR context.
- Treat branch-local ADR additions and removals as provisional context for that branch.
- Use a normal issue or sub-issue as the assignment brief and audit trail.
- Link the ADR-tracking issue or sub-issue in the PR with `Closes #<number>`; use `Refs #<number>` for a broader parent that must stay open. Approval alone does not close the issue.
- Use labels only for triage: `adr:needed`, `adr:proposed`, `adr:removal` and `adr:rejected`.
- Do not use `adr:accepted`; a file on `main` is the accepted state.

## Execution order

1. Update process documentation, the ADR template and ADR-0001.
2. Update `AGENTS.md`, the architecture-decision skill and the issue form.
3. Make the validator and contract tests status-free.
4. Remove acceptance workflows, status-mutating scripts and obsolete tests.
5. Update issue #1 with the final runbook and configure the labels.
6. Check Markdown, YAML, shell tests and remaining workflow references.
7. Configure branch protection for `main` outside the repository.

## Acceptance criteria

- A generic issue can receive an ADR sub-issue during triage or refining.
- The ADR issue form supports both adding and removing a record.
- An ADR without `status` is valid; a `status` field is rejected.
- Agent instructions distinguish official `main` context from branch-local context.
- Old acceptance workflows and status-mutating scripts do not exist.
- An addition or removal becomes repository-wide only after merge to `main`.
- An ADR PR contains a closing reference to the ADR-tracking issue; the issue closes only at merge.
- Issue #1 is updated after the action and closes after a successful merge when it is a standalone ADR-tracking issue.
- All local quality tests pass.

## External prerequisites

- `main` must require pull requests, required checks and an approval.
- Direct pushes and bypasses for `main` must be disabled.
- A separate reviewer identity is needed; the only PR author cannot approve their own PR.
- The current private-repository plan may require an upgrade or a public repository before branch protection can be enabled.

## Verification

- `./tests/adr/test_validate_adrs.sh`
- `./tests/adr/test_architecture_decision_skill.sh`
- `./tests/adr/test_repository_contract.sh`
- `git diff --check`
- Parse the issue form, quality workflow and agent configuration as YAML.
- Search for old acceptance workflows, status mutations and stale process text.
