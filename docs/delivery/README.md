# Delivery workflow

This guide describes how people and coding agents move a change through the repository's trunk. It complements [ADR-0004](../decisions/0004-use-trunk-based-delivery.md), [ADR-0005](../decisions/0005-use-conventional-commits-with-gitmoji.md) and [ADR-0006](../decisions/0006-curate-a-changelog.md).

## Trunk-based flow

`main` is the trunk and the official source of truth. Start a short-lived feature branch from the current `main`. Keep it for no more than two calendar days. The feature branch must be the head of a review pull request whose base is `main`; never open a pull request from `main`.

Keep each increment small, test it and commit it. Use a feature flag or another reversible boundary when incomplete work must be integrated. Do not create a permanent `develop` branch for ordinary work. Approved pull requests use merge commits. Only an explicitly authorized human merges a review pull request or closes its source issue.

## Commit messages

New non-merge commits use this form:

```text
<type>[optional scope][optional !]: <gitmoji> <description>
```

For example: `docs(delivery): 📝 explain the branch boundary`. The Gitmoji is an official Unicode character or shortcode from the pinned catalogue. The prefix comes first to preserve Conventional Commits tooling; this ordering is the repository's explicit local mapping of the Gitmoji convention.

`@commitlint/cli` checks the Conventional Commit grammar. `scripts/validate-gitmoji.mjs` checks the Gitmoji token. Pull-request titles and all non-merge commits in the pull-request range are validated. Existing historical commits are not rewritten. Structural validation does not decide whether the type or Gitmoji truthfully describes the change; reviewers do that semantic check.

## Changelog

Maintain the root [`CHANGELOG.md`](../../CHANGELOG.md) as a curated document for people. Put current work under `[Unreleased]`, using `Added`, `Changed`, `Deprecated`, `Removed`, `Fixed` or `Security` when a category has an entry. Describe impact rather than copying commit subjects. Put released sections below `[Unreleased]`, newest first, with an ISO date and a Semantic Versioning value.

Do not invent a release, tag or version for unreleased work. Creating a release is a separate human-authorized action. A changelog validator checks structure; reviewers decide whether entries are relevant and accurately describe impact.

## What automation checks

CI checks the branch's commit range, pull-request title, changelog structure, ADR and domain-language contracts, Markdown/YAML/JSON syntax and dependency audit findings. On pushes to `main`, CI reports any first-parent commit that is not a merge commit.

Automation checks structure and syntax. Agents and human reviewers still check branch age, intent, semantic version impact, changelog relevance, domain meaning, external names and authorization boundaries.

## Sources and local mappings

- [Trunk Based Development](https://trunkbaseddevelopment.com/) informs the single-trunk and short-lived-branch model. The two-day target and merge-commit policy are local rules.
- [Conventional Commits 1.0.0](https://www.conventionalcommits.org/en/v1.0.0/) defines the commit prefix grammar.
- [`@commitlint/config-conventional`](https://github.com/conventional-changelog/commitlint/tree/master/%40commitlint/config-conventional) supplies the lint rules.
- [Gitmoji](https://gitmoji.dev/) supplies the intention catalogue. This repository places its token after the Conventional Commit prefix so both conventions remain usable.
- [Keep a Changelog 1.1.0](https://keepachangelog.com/en/1.1.0/) defines the human-readable changelog structure.
- [Semantic Versioning](https://semver.org/) defines release version meaning.
