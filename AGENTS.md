# Repository instructions

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

- Use `$delivery-workflow` for changes that affect branches, commit history, pull requests, releases or `CHANGELOG.md`. The skill is implicitly available.
- Keep `main` deployable. Work on a short-lived feature branch and make that branch the review pull-request head; `main` is the protected base. Never create a pull request from `main`.
- Start supported work from a clean, synchronized `main` with `npm run branch:start -- <type> <issue-number> <summary>`. The command requires an open source issue in this repository and creates a branch with an issue-linked branch name in the form `<type>/issue-<number>-<lowercase-kebab-case-summary>`.
- Use `npm run lint:branch -- <branch-name>` to check an existing candidate. The pull-request head and its source issue are checked again by CI; a closed issue, pull request number or unreadable issue is invalid.
- Prefer completing a feature branch within two calendar days. Do not create `develop` or permanent feature/release branches for ordinary work. Use a feature flag when incomplete work must be integrated early.
- Use merge commits for this repository. Do not use squash, rebase or auto-merge. A coding agent must not merge a pull request, bypass protection or close its source issue without explicit human authorization.
- Write commit messages and pull-request titles as Conventional Commits with a Gitmoji immediately after the prefix, for example `feat(delivery): ✨ establish trunk-based delivery`. The official Unicode emoji or Gitmoji shortcode is allowed. Validate all non-merge commits and the pull-request title; historical commits are not rewritten.
- Keep `CHANGELOG.md` curated for people. Put relevant changes in `[Unreleased]` under the Keep a Changelog categories. Releases, tags and release dates require a separate human decision.
- CI checks structure, syntax, tests and dependency risk. Agents and human reviewers must still review commit intent, Gitmoji meaning, changelog relevance, affected bounded contexts and documentation in plain English.

See [`$delivery-workflow`](.agents/skills/delivery-workflow/SKILL.md) and its sources for the full contract.
