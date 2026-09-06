# Tasks: branch-based ADR lifecycle

Source: [GitHub issue #1](https://github.com/sjefsharp/agentic-delivery/issues/1). The official decision exists only after the change PR is merged into `main`.

## Phase 1: process and agent harness

- [x] State that an issue is not automatically an ADR.
- [x] Describe ADR sub-issues for triage, refining and implementation.
- [x] Describe branch-local ADR context and `main` as the official source.
- [x] Remove lifecycle status from ADR frontmatter and the template.
- [x] Update `AGENTS.md`, the architecture-decision skill and agent configuration.
- [x] Extend the issue form for ADR additions and removals.

## Phase 2: validation and cleanup

- [x] Make the ADR validator check status-free frontmatter.
- [x] Remove acceptance workflows and status-mutating scripts.
- [x] Remove tests and fakes that only cover the old acceptance chain.
- [x] Keep `adr-quality.yml` focused on quality validation.
- [x] Add label and runbook contracts to the tests.

## Phase 3: GitHub administration

- [x] Use `adr:needed` for triage before an ADR PR exists.
- [x] Use `adr:proposed` for an active ADR PR.
- [x] Use `adr:removal` as the deletion modifier.
- [x] Use `adr:rejected` for a rejected proposal that was not merged.
- [x] Update issue #1 with the final runbook, labels and implementation links.
- [ ] Configure branch protection for `main` outside the repository.

## Local implementation checkpoint

- [x] No `status:` fields exist in ADR frontmatter.
- [x] No references to removed acceptance workflows or scripts remain outside negative contract tests.
- [x] All shell tests pass.
- [x] Markdown and YAML validation pass.

## Repository process checkpoint

- [ ] New ADR: issue/sub-issue → feature branch → PR → approval → merge → issue update/closure.
- [ ] ADR removal: issue/sub-issue → feature branch → file deletion → PR → approval → merge → issue update/closure.
- [x] Rejected proposal: reason in issue → `adr:rejected` → close PR; nothing on `main`.
- [x] Agents use only ADRs on `main` as official context.
