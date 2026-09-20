# Repository instructions

<!-- agentic-primitive: {"id":"repository-governance-instructions","kind":"instruction","enforcement":"instructional","adrs":["ADR-0001","ADR-0002","ADR-0003","ADR-0004","ADR-0007","ADR-0012","ADR-0013","ADR-0014","ADR-0015","ADR-0016","ADR-0017"],"domains":["agentic-delivery-governance"]} -->

## Architectural decisions

- For a costly, cross-cutting, repository-wide, security-sensitive or otherwise significant choice, read [`docs/decisions/README.md`](docs/decisions/README.md) and use `$architecture-decision`.
- Treat a linked GitHub Issue as the assignment brief. It is not automatically an ADR. Keep the source issue, any separate ADR tracking issue and the review pull request linked.
- When no source issue is supplied, follow the guarded intake in the decisions index and skill. Search read-only, confirm a candidate or preview before creating one, never replace an inaccessible issue, and ask questions only through explicitly authorized issue communication.
- Add or remove an ADR only on a feature branch. The feature branch must be the pull-request head; never create a pull request from `main`, which is only the protected base. The change is provisional there; only the merged contents of `main` are official. Do not merge a pull request or close its tracking issue without explicit human authorization.
- When opening or updating an ADR pull request, include its ADR tracking issue with a closing reference such as `Closes #123`. The source issue may serve as the ADR tracking issue; otherwise use its linked sub-issue. GitHub closes that issue only after the PR is merged; approval alone does not close it. Use `Refs #123` when a broader source issue must remain open.

## Communication

- Follow the user's language for Dutch and English conversations. Use Dutch when the language is mixed or unclear.
- Use plain English for new or changed repository documentation. Keep code, commands, identifiers, quotations and necessary technical terms unchanged.
- Use `$plain-language-communication` when drafting or reviewing human-agent communication or repository documentation.

## Domain language

- Before changing domain-bearing code, documentation or agentic primitives, identify the affected bounded context and read [`docs/domain/README.md`](docs/domain/README.md) and [`docs/domain/ubiquitous-language.yml`](docs/domain/ubiquitous-language.yml). Use `$ubiquitous-language` for this review.
- Use registered terms with their defined meaning inside that bounded context. Do not assume that the same term has the same meaning outside it.
- Treat a missing concept, conflicting meaning or changed term as a domain-model change. Update the register and affected artifacts in the same change set; use the architecture-decision process when the change is significant.
- Keep exact external names, identifiers and quotations. Explain their context or map them to a registered term when the difference could be ambiguous.
- Structural checks do not prove semantic consistency. Agents and human reviewers must review meaning; do not introduce a repository-wide forbidden-word scan.

## Delivery workflow

- GitHub Issues, native issue types, pinned issue fields, governance labels,
  pull requests and Actions are the control plane and authoritative work-state
  record. Codex and the self-hosted runner are the execution plane. An LLM
  interprets every eligible issue or human comment and proposes the route,
  field values, governance metadata, and orchestration pattern. Deterministic
  code checks permission, schema, the versioned metadata and orchestration
  catalogs, and allowed transitions before changing GitHub state; it must not
  infer intent from words or phrases.
- Blank issues may enter iterative refinement without a template. Ask only
  focused questions that are answerable from the current conversation. A
  repository writer's answer continues the same issue and saved session; a
  refined goal may create only the validated child work items it needs, while
  the parent remains the lineage root.
- Issue intake applies only a validated routing proposal before the Codex delivery primitive. People do not set lifecycle fields during normal work; manual intake dispatch using current approved fields is a rare break-glass recovery when semantic routing is unavailable. A new Plan run requires an open issue with a supported native type, valid Lifecycle Stage and Delivery Readiness fields, and cleared deterministic gates. Research, requirements, architecture, validation, and coordination routes do not implicitly invoke implementation. Historical `type:*` and `state:*` labels are migration evidence only; governance labels such as `adr:needed` remain orthogonal controls, and GitHub's `not planned` close reason remains the final disposition for rejected or abandoned work.
- Conversation-driven agent runs require the explicit invocation boundary in [`.github/agent-actors.json`](.github/agent-actors.json): `@agentic-delivery-lab-invoker-7f3a` must begin the first actionable line of a supported issue or pull-request comment/review event. The tag activates processing but does not select a route or bypass issue fields, readiness, plan validity, actor authorization, or orchestration policy. Untagged comments, quoted/code examples, native `@copilot` requests, and the orchestrator's own output remain outside this delivery invocation boundary.

- For automated source issue execution, read [`.agents/codex-delivery.md`](.agents/codex-delivery.md) and [`docs/delivery/codex-workflow.md`](docs/delivery/codex-workflow.md). Preserve mandatory issue communication, clarification pauses, exact model settings, and the budget boundary.
- Review pull requests through the read-only Harness Architecture Review when its workflow is available. Treat its deterministic violations as structural failures, and treat semantic findings or unavailable runtime evidence as cited review input rather than proof.
- Use the organization pull request template from `agentic-delivery-lab/.github`; do not add a local template. Complete every section with evidence, or write `Not applicable` with a reason. Record the source issue, implementation plan, material plan deviations, verification, risks, rollback and review guidance. The `Validate pull request body` check enforces the structural contract for every pull request except one authored by `dependabot[bot]`; do not claim or extend that exception to another bot or app.
- Keep `## Source` and `## Plan` as separate headings in every pull request. `Source` contains the source issue; `Plan` contains the implementation plan and deviations. The combined `## Source and plan` heading is not valid.
- The repository is public, but a versioned branch-protection or ruleset definition is not itself live enforcement. Treat the main-branch protection and required-check rules below as repository policy until an authorized maintainer activates and verifies the corresponding GitHub rule; do not describe an unverified rule as a hosting guarantee.

- Use `$delivery-workflow` for changes that affect branches, commit history, pull requests, releases or `CHANGELOG.md`. The skill is implicitly available.
- Keep `main` deployable. Work on a short-lived feature branch and make that branch the review pull-request head; `main` is the protected base. Never create a pull request from `main`.
- Start supported work from a clean, synchronized `main` with `pnpm branch:start <type> <issue-number> <summary>`. The command requires an open source issue in this repository and creates a branch with an issue-linked branch name in the form `<type>/issue-<number>-<lowercase-kebab-case-summary>`.
- Use `pnpm lint:branch <branch-name>` to check an existing candidate. The pull-request head and its source issue are checked again by CI; a closed issue, pull request number or unreadable issue is invalid.
- Prefer completing a feature branch within two calendar days. Do not create `develop` or permanent feature/release branches for ordinary work. Use a feature flag when incomplete work must be integrated early.
- Use merge commits for this repository. Do not use squash, rebase or auto-merge. A coding agent must not merge a pull request, bypass protection or close its source issue without explicit human authorization.
- Write commit messages and pull-request titles as Conventional Commits with a Gitmoji immediately after the prefix, for example `feat(delivery): ✨ establish trunk-based delivery`. The official Unicode emoji or Gitmoji shortcode is allowed. Validate all non-merge commits and the pull-request title; historical commits are not rewritten.
- Keep `CHANGELOG.md` curated for people. Put relevant changes in `[Unreleased]` under the Keep a Changelog categories. Releases, tags and release dates require a separate human decision.
- CI checks structure, syntax, tests and dependency risk. Agents and human reviewers must still review commit intent, Gitmoji meaning, changelog relevance, affected bounded contexts and documentation in plain English.

See [`$delivery-workflow`](.agents/skills/delivery-workflow/SKILL.md) and its sources for the full contract.
