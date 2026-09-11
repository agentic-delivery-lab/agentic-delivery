---
date: 2026-09-10
source-issue: https://github.com/sjefsharp/agentic-delivery/issues/29
decision-makers: Sjef Jenniskens
consulted: None
informed: None
domains:
  - agentic-delivery-governance
required-enforcement:
  - deterministic
---

# Derive ADR traceability from agentic primitives

## Context and Problem Statement

ADRs explain why and what the repository decided, while instructions, skills,
validators, state-machine rules, workflows, and scripts explain how a decision
is enforced. The existing architecture impact map is useful for review but is
an independently maintained ADR-to-path mapping. It cannot prove that every
active ADR has an implementation or that an ADR removal leaves no dangling
primitive references.

## Decision Drivers

- Make ADR, primitive, and bounded-context relationships machine-readable.
- Keep the primitive as the authoritative reference rather than maintaining a
  second editable relationship map.
- Make additions, replacements, remappings, and removals reviewable on a PR.
- Keep metadata small and separate from runtime context selection.

## Considered Options

- Primitive-local metadata with a generated bidirectional index and deterministic
  removal checks.
- A hand-maintained central ADR-to-primitive manifest.
- Prose backlinks and semantic review without a structural index.

## Decision Outcome

Chosen option: **Primitive-local metadata with a generated index**, because a
primitive travels with the behavior it implements and the reverse view can be
rebuilt from the canonical repository at any time.

Supported primitives carry a concise native comment containing a stable ID,
kind, enforcement class, ADR IDs, and bounded-context IDs. Markdown comments
resolve to the nearest heading anchor. ADR frontmatter declares its applicable
domains and required enforcement classes. The generator produces sorted
domain-to-ADR-to-primitive and primitive-to-ADR/domain views. The generated
file is checked for equality in CI and is never edited as a source map.

The architecture review compares base and head indexes. Every active ADR must
have an implementing primitive; every reference must resolve; domains and
required enforcement must agree; removed ADRs must have no remaining
references. Stable primitive IDs identify retained/remapped primitives,
`replaces` metadata identifies replacements, and removed annotations identify
retired primitives. The review reports each affected reference outcome.

Traceability metadata is navigation and validation data. It does not instruct
Codex to load every related ADR into every runtime context.

### Consequences

- Good, because both lookup directions are deterministic and reproducible.
- Good, because obsolete ADRs cannot remain referenced silently.
- Bad, because each new primitive or ADR must carry valid metadata.
- Neutral, because semantic meaning still requires human or advisory model
  review.

### Confirmation

Tests cover all supported comment syntaxes, duplicate IDs, unknown ADRs and
domains, missing enforcement, generated-index drift, ADR deletion, replacement,
remapping, retirement, and selective architecture-review context.

## Pros and Cons of the Options

### Primitive-local metadata and generated index

- Good, because the source relationship is next to the implementation.
- Good, because the reverse index is derived and can be rebuilt from `main`.
- Bad, because parsers must support the repository's primitive file formats.

### Hand-maintained central manifest

- Good, because it is easy to inspect in one file.
- Bad, because it duplicates relationships and can drift from primitives.

### Prose backlinks only

- Good, because it has little tooling cost.
- Bad, because missing, stale, and dangling relationships are hard to prove.

## More Information

- Related decision: [Run layered harness architecture reviews](0011-run-layered-harness-architecture-reviews.md)
- Related decision: [Use context-scoped ubiquitous language](0003-use-context-scoped-ubiquitous-language.md)
- This record is provisional until its review pull request is merged into
  `main`.
