---
date: 2026-09-06
source-issue: https://github.com/sjefsharp/agentic-delivery/issues/7
decision-makers: Sjef Jenniskens
consulted: None
informed: None
---

# Curate a human-readable changelog

## Context and Problem Statement

Issue [#7](https://github.com/sjefsharp/agentic-delivery/issues/7) asks the repository to introduce a changelog. A raw commit log is useful for development but does not explain user impact, group related changes or identify release boundaries. The repository also has no release tags, so inventing a version for the first entry would be misleading.

## Decision Drivers

- Give people a concise, human-readable record of notable changes.
- Keep unreleased work visible without pretending that it was released.
- Use a stable format that supports future SemVer releases.
- Make the entry part of the change while its impact is understood.
- Avoid a generated log that repeats internal implementation details.

## Considered Options

- A curated root `CHANGELOG.md` following Keep a Changelog, starting with `[Unreleased]`.
- A generated changelog assembled from commit messages at release time.
- No changelog until the first tagged release.

## Decision Outcome

Chosen option: **Maintain a curated root `CHANGELOG.md` following Keep a Changelog 1.1.0**, because it is written for humans and can show unreleased impact before a release exists.

The file starts with an `[Unreleased]` section and uses the categories `Added`, `Changed`, `Deprecated`, `Removed`, `Fixed` and `Security` as needed. Entries describe user or contributor impact in plain English, not a raw commit list. A release section uses an ISO date (`YYYY-MM-DD`) and a SemVer version such as `1.0.0`; newest sections remain at the top. The initial implementation does not create a fake version, tag, release or release bot.

The changelog follows [Keep a Changelog 1.1.0](https://keepachangelog.com/en/1.1.0/) and [Semantic Versioning](https://semver.org/). The root location, initial Unreleased-only state and manual curation are local repository choices.

### Consequences

- Good, because readers can understand notable changes without interpreting commit internals.
- Good, because unreleased work is documented before a release decision exists.
- Good, because a predictable structure supports future release automation without requiring it now.
- Bad, because contributors must explain impact and keep entries current.
- Bad, because a structural validator cannot judge whether an entry is meaningful or complete.
- Neutral, because tags and releases remain a separate human-authorized decision.

### Confirmation

- `scripts/validate-changelog.mjs` checks the root file's required heading, section order, dates, SemVer headings and allowed categories.
- Tests cover valid Unreleased content, duplicate or missing sections, invalid categories, dates, versions and ordering.
- CI runs the validator and parses the Markdown and related configuration.
- Reviewers decide whether each entry belongs in the changelog and accurately describes impact.

## Pros and Cons of the Options

### Curated root changelog with Unreleased

- Good, because it is readable and records impact while the work is fresh.
- Good, because it supports future releases without forcing a release now.
- Bad, because curation takes deliberate contributor time.

### Generated changelog from commit messages

- Good, because it reduces manual editing.
- Bad, because commit messages describe implementation intent, not necessarily user impact.
- Bad, because generator configuration would add scope before the repository has a release process.

### No changelog until the first tagged release

- Good, because it avoids maintaining an interim document.
- Bad, because contributors and reviewers lack a central view of unreleased changes.
- Bad, because reconstructing impact later loses context.

## More Information

- Assignment brief: [GitHub issue #7](https://github.com/sjefsharp/agentic-delivery/issues/7)
- Source: [Keep a Changelog 1.1.0](https://keepachangelog.com/en/1.1.0/)
- Versioning reference: [Semantic Versioning 2.0.0](https://semver.org/)
- Related decision: [ADR-0003](0003-use-context-scoped-ubiquitous-language.md)
- Delivery guidance: [`docs/delivery/README.md`](../delivery/README.md)
- Revisit this decision when the repository publishes its first release or requires automated release notes.
