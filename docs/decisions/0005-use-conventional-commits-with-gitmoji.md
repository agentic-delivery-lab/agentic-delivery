---
date: 2026-09-06
source-issue: https://github.com/sjefsharp/agentic-delivery/issues/7
decision-makers: Sjef Jenniskens
consulted: None
informed: None
---

# Use Conventional Commits with Gitmoji

## Context and Problem Statement

Issue [#7](https://github.com/sjefsharp/agentic-delivery/issues/7) asks the repository to introduce Conventional Commits, `@commitlint`, and Gitmoji. Commit messages are part of the delivery history used by people, agents and future automation, but the repository currently has no enforced format for new work.

Conventional Commits defines a parseable type, optional scope, optional breaking-change marker and description. Gitmoji adds a compact visual intention. Their published examples place the Gitmoji at different positions: Conventional Commits starts with the type, while Gitmoji's own grammar starts with the intention. The repository needs one unambiguous local grammar.

## Decision Drivers

- Keep commit messages compatible with Conventional Commits tooling.
- Make intent visible without losing the conventional type and scope.
- Validate new work consistently in local commands and CI.
- Preserve historical commit messages rather than rewriting official history.
- Keep exact external names and codes available when they are useful.

## Considered Options

- Conventional Commit prefix followed immediately by a Gitmoji, validated by `@commitlint` and a small repository check.
- Gitmoji-first messages with a later Conventional Commit trailer.
- Conventional Commits without Gitmoji, relying only on the type and description.

## Decision Outcome

Chosen option: **Use Conventional Commits with Gitmoji immediately after the Conventional Commit prefix**, because it preserves the machine-readable grammar while making intent visible.

New non-merge commits use:

```text
<type>[optional scope][optional !]: <gitmoji> <description>
```

Examples are `feat: ✨ add a delivery guide`, `fix(parser): 🐛 reject an empty changelog`, and `feat!: 💥 change the validation contract`. The Gitmoji may be its official Unicode character or its official shortcode, such as `✨` or `:sparkles:`. The repository's local placement is an explicit deviation from the Gitmoji site's emoji-first grammar; Conventional Commits remains the first-order syntax.

`@commitlint/cli` with `@commitlint/config-conventional` validates the Conventional Commit portion. A repository script validates that the first token after the prefix is an official Gitmoji Unicode character or shortcode from the pinned `gitmojis` catalogue. Pull-request titles and every non-merge commit in the pull-request range are checked. Merge commits are ignored by the range check. Historical commits are not rewritten or retrofitted.

Semantic meaning remains a review concern: the type must describe the impact, the Gitmoji must match the intent, and a breaking change must be marked and explained. Structural checks cannot prove those meanings.

The decision follows [Conventional Commits 1.0.0](https://www.conventionalcommits.org/en/v1.0.0/), [`@commitlint/config-conventional`](https://github.com/conventional-changelog/commitlint/tree/master/%40commitlint/config-conventional), and [Gitmoji](https://gitmoji.dev/). The prefix-plus-Gitmoji ordering and historical-commit boundary are local rules.

### Consequences

- Good, because existing Conventional Commit tooling can parse the prefix and breaking marker.
- Good, because the first Gitmoji communicates intent at a glance.
- Good, because pull requests fail early when a new commit is malformed.
- Bad, because contributors must learn two small grammars and choose a meaningful pair.
- Bad, because Gitmoji catalogue updates require a deliberate dependency update.
- Neutral, because older commits remain valid historical records even when they lack Gitmoji.

### Confirmation

- `commitlint.config.mjs` contains the Conventional Commit configuration.
- `scripts/validate-gitmoji.mjs` validates Unicode and shortcode forms against the pinned catalogue.
- `scripts/validate-commit-range.mjs` validates a supplied base/head range and returns documented exit codes.
- Tests cover valid scopes, breaking markers, Unicode and shortcodes, malformed prefixes, unknown Gitmoji values and merge commits.
- The workflow validates the pull-request title and the complete non-merge commit range.
- Reviewers assess whether type, Gitmoji and description match the change's meaning.

## Pros and Cons of the Options

### Conventional Commit prefix followed by Gitmoji

- Good, because it is compatible with existing Conventional Commit parsers.
- Good, because intent is visible without making the prefix ambiguous.
- Bad, because it is a documented local deviation from Gitmoji's standalone grammar.

### Gitmoji-first messages with a later Conventional Commit trailer

- Good, because it follows the Gitmoji site's visual ordering.
- Bad, because common Conventional Commit tooling expects the type at the beginning.
- Bad, because the trailer would not provide the same compatibility for title and range checks.

### Conventional Commits without Gitmoji

- Good, because it has one compact syntax and broad tooling support.
- Bad, because it does not provide the requested visual intention signal.
- Neutral, because semantic review would still be needed.

## More Information

- Assignment brief: [GitHub issue #7](https://github.com/sjefsharp/agentic-delivery/issues/7)
- [Conventional Commits 1.0.0](https://www.conventionalcommits.org/en/v1.0.0/)
- [`@commitlint/config-conventional`](https://github.com/conventional-changelog/commitlint/tree/master/%40commitlint/config-conventional)
- [Gitmoji](https://gitmoji.dev/)
- Related decision: [ADR-0003](0003-use-context-scoped-ubiquitous-language.md)
- Delivery guidance: [`docs/delivery/README.md`](../delivery/README.md)
- Revisit this decision if the commit parser, Gitmoji catalogue or hosting workflow needs a different compatible grammar.
