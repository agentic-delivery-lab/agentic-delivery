---
date: 2026-09-10
source-issue: https://github.com/sjefsharp/agentic-delivery/issues/25
decision-makers: Sjef Jenniskens
consulted: None
informed: None
domains:
  - agentic-delivery-governance
required-enforcement:
  - deterministic
  - semantic
---

# Run layered harness architecture reviews on pull requests

## Context and Problem Statement

The architecture-conformance baseline for issue #25 found that this
repository encodes many decisions in validators and tests, but a reviewer
cannot reliably connect a pull request to affected ADRs, bounded contexts,
source-issue intent, Codex execution evidence and the limits of runtime
observation. Documentation-only review is too weak, while model judgment
cannot be treated as deterministic proof.

## Decision Drivers

- Detect objective architecture and evidence-contract violations early.
- Review decision meaning, domain language and architectural drift with cited
  evidence rather than unsupported model opinion.
- Keep the official ADR context on the base branch and provisional changes on
  the pull-request branch.
- Give reviewers a path from the pull request to the source issue, delivery
  run, Codex session, verified revision and validation summary.
- Preserve human merge authority and avoid write permissions or duplicate
  issue comments.
- Reuse the existing Codex quota, sandbox, model selection and redaction
  boundaries without silently falling back to another model or billing path.

## Considered Options

- **Documentation-only review.** Easy to maintain, but cannot detect drift or
  provide repeatable evidence.
- **Deterministic-only workflow.** Strong for schemas, links, permissions and
  state rules, but cannot decide whether implementation preserves an ADR's
  intent or a domain term's meaning.
- **Mandatory model-gated review.** Interprets meaning, but makes a
  safety-sensitive merge gate dependent on quota, model availability and
  non-deterministic judgment.
- **Layered read-only review.** Deterministic checks fail only on objective
  violations; a bounded Sol High reviewer returns cited advisory findings.

## Decision Outcome

Chosen option: **Layered read-only review**, because it combines deterministic
failure for deterministic rules with explicit, evidence-backed semantic review
without pretending that model judgment is mathematical proof.

The repository will run a dedicated internal pull-request workflow. It loads
official ADRs from the base revision, provisional ADR changes from the head,
the merge-base-to-head diff, the generated ADR-to-primitive traceability index,
the domain register, the architecture impact map, the source issue and safe
runtime evidence when available. It produces one
machine-readable result and one concise check summary. It does not post issue
comments, modify the pull request, merge, close issues or silently repair
findings.

The deterministic layer validates the evidence schema, generated
ADR/primitive relationships, domain applicability, required deterministic
enforcement, source-issue and branch correlation, required durable-artifact
relationships, deletion outcomes, supersession, and permission/state
invariants. It fails the check only for a clear violation. The semantic layer
uses GPT-5.6 Sol with
high reasoning effort, read-only `delivery-review` permissions, the existing
subscription-only budget boundary and no external network. It must cite exact
repository, issue, run or session evidence. Findings, invalid semantic output,
unavailable evidence and unavailable quota are reported as advisory or
inconclusive results.

Agent-created pull requests carry a versioned evidence projection derived from
persisted delivery state. The projection contains source issue, workflow run,
branch and verified revision, Codex session, model turn settings, ADR/context
references, validation, bounded telemetry and an audit checkpoint. Runner
state remains canonical; the pull-request projection is the reviewer-facing
reference and is replaced idempotently on publication retry.

### Consequences

- Good, because structural rules fail predictably and semantic concerns remain
  visible without blocking on a model opinion.
- Good, because a reviewer can begin at the pull request and follow stable
  references toward the source issue and delivery run.
- Good, because read-only permissions preserve human and controller ownership.
- Bad, because semantic review consumes subscription allowance and can be
  inconclusive when quota or runtime evidence is unavailable.
- Bad, because the runtime-surface impact map must be maintained when
  architectural surfaces move, although it does not duplicate ADR rationale
  or the generated ADR-to-primitive relationship.
- Neutral, because GitHub Free still cannot technically prevent every direct
  push or bypass by another credential holder.

### Confirmation

Tests must cover impact-map coverage, evidence-schema validation, redaction,
publication retry idempotency, deterministic failure codes, exact Sol High
review settings, denied model network, cited semantic findings, inconclusive
quota/evidence handling, workflow permissions and no-comment behavior. A
human reviewer must inspect whether the baseline and semantic findings cite
evidence rather than treating tests or documentation as runtime proof.

## Pros and Cons of the Options

### Layered read-only review

- Good, because each question is assigned to deterministic tooling or human/
  model interpretation according to its nature.
- Good, because it closes the traceability gap without giving the reviewer
  publication or issue-management authority.
- Bad, because it adds a small impact map, evidence schema and model-review
  runtime that need maintenance.

### Documentation-only review

- Good, because it has no runtime cost.
- Bad, because drift is found only when a person remembers to inspect it.

### Deterministic-only workflow

- Good, because results are reproducible and cheap.
- Bad, because it cannot assess intent, meaning or whether a test proves the
  right architectural property.

### Mandatory model-gated review

- Good, because semantic concerns can be raised before merge.
- Bad, because quota, availability and model judgment are not a sound
  deterministic merge boundary.

## More Information

- Baseline: [`docs/architecture/harness-conformance-review.md`](../architecture/harness-conformance-review.md)
- Domain register: [`ubiquitous-language.yml`](../domain/ubiquitous-language.yml)
- Related decisions: [ADR-0001](0001-use-madr-for-architecture-decisions.md), [ADR-0003](0003-use-context-scoped-ubiquitous-language.md), [ADR-0009](0009-run-codex-from-source-issues-with-a-budget-boundary.md), [ADR-0012](0012-use-github-as-the-lifecycle-control-plane.md), and [ADR-0013](0013-derive-adr-traceability-from-agentic-primitives.md)
- This decision is provisional on its feature branch and becomes official only
  after its review pull request is merged into `main`.
