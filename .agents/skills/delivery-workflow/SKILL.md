---
name: delivery-workflow
description: Apply this repository's trunk-based delivery, Conventional Commits, Gitmoji and curated changelog rules when planning, changing or reviewing delivery work.
---

# Delivery workflow

Use this skill when a change affects the repository's branch workflow, commit history, pull requests, releases or `CHANGELOG.md`.

## Establish repository context

Before making a domain-bearing change, read [`docs/domain/README.md`](../../../docs/domain/README.md) and [`docs/domain/ubiquitous-language.yml`](../../../docs/domain/ubiquitous-language.yml). Use the `agentic-delivery-governance` bounded context and its registered terms. A missing concept, conflicting meaning or changed definition is a domain-model change and must be updated in the same change set.

For an architectural choice, read [`docs/decisions/README.md`](../../../docs/decisions/README.md) and use `$architecture-decision`. An architecture decision record is provisional on a feature branch and becomes an official decision only after its review pull request is merged into `main`.

## Work from the trunk

- Keep `main` deployable and use a short-lived feature branch for each change.
- Branch from the current `main`; keep the branch's pull-request head separate from `main`, which is the protected base. Use `npm run branch:start -- <type> <issue-number> <summary>` from a clean, synchronized `main` so the supported path verifies an open source issue before creating an issue-linked branch. Names use `<type>/issue-<number>-<lowercase-kebab-case-summary>`. Never open a pull request with `main` as its head.
- Finish a feature branch within two calendar days when practical. Integrate through a review pull request as soon as the change is complete.
- Do not create `develop`, permanent feature or permanent release branches for ordinary work. Use a feature flag when incomplete work must be integrated early.
- A coding agent may prepare, push and update a branch or review pull request, but it must not merge the pull request, bypass protection or close the source issue without explicit human authorization.
- The repository's chosen merge method is a merge commit. Do not use squash, rebase or auto-merge for this workflow. Delete a merged feature branch after a human has completed the merge.

The branch starter rejects a closed, missing or unreadable source issue and rejects a pull request number even when it is open. Use `npm run lint:branch -- <branch-name>` for a candidate that already exists. CI repeats the branch syntax and open-issue checks when an internal pull request is opened or updated. A raw Git branch command can bypass the local helper, but it cannot pass the pull-request check with an invalid name or source issue.

## Write commit and pull-request titles

Use the Conventional Commits grammar with the type first:

```text
<type>[optional scope][optional !]: <description>
```

This repository places a Gitmoji immediately after the Conventional Commit prefix, for example:

```text
feat(delivery): ✨ establish trunk-based delivery
```

The emoji may be the official Unicode character or its official Gitmoji shortcode. This ordering is an intentional local mapping: Conventional Commits remains parseable while Gitmoji supplies the intent marker. Validate every non-merge commit in the review pull request and validate the pull-request title with the same contract. Historical commits are not rewritten; merge commits are ignored by commitlint's default rule.

Keep the description short and explain why in the body when needed. Use a breaking-change marker (`!` or a `BREAKING CHANGE:` footer) only when the change really breaks consumers. Keep exact external names, identifiers and quotations unchanged and explain their context when they differ from the repository vocabulary.

## Maintain the changelog

Keep [`CHANGELOG.md`](../../../CHANGELOG.md) curated for people. Add user-relevant changes under `[Unreleased]` and use the Keep a Changelog categories: `Added`, `Changed`, `Deprecated`, `Removed`, `Fixed` and `Security`. Do not generate a raw commit dump, invent a release date or create a tag or release as part of ordinary feature work. A release is a separate, explicitly authorized human action using a SemVer version and an ISO 8601 date.

Review whether a change belongs in the changelog and whether its wording is useful to readers; the validator can check structure, not relevance or meaning.

## Structural checks and semantic review

The delivery-quality workflow structurally checks commit syntax and Gitmoji mappings, changelog shape, Markdown, YAML, JSON, repository tests and dependency audit results. These checks do not prove that a commit type, Gitmoji, changelog entry or domain term is semantically correct. Agents and human reviewers must review intent, affected bounded contexts, plain-language documentation, branch age and release impact.

## Sources

- [Trunk Based Development](https://trunkbaseddevelopment.com/)
- [Conventional Commits 1.0.0](https://www.conventionalcommits.org/en/v1.0.0/)
- [`@commitlint/config-conventional`](https://github.com/conventional-changelog/commitlint/tree/master/%40commitlint/config-conventional)
- [Gitmoji](https://gitmoji.dev/)
- [Keep a Changelog 1.1.0](https://keepachangelog.com/en/1.1.0/)
