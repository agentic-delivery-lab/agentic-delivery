# Architecture Authority references

Architecture Authority owns all formal ADR, ADP and ADD decision text,
including decisions specific to Control Plane. This directory contains
consumer references and metadata projections, not another canonical log.
The reference index selects immutable Architecture0.1.0 manifest commit
`ba804c044bd7dc0a7c5568062d43a1f0d9f3141b` and prepared source
`0423533176ad6239fe5d828736605b5a6360293c`.

The22 ADR references apply to the registered governance and Control Plane
contexts. Their hashes and source metadata are recorded in
[`authority-reference-index.json`](authority-reference-index.json). Local
`domains` metadata projects only those two contexts for the existing
traceability reader; full source domains remain in the index. This does not
claim execution, runtime admission or coverage of other contexts.

## Reading and changing decisions

Read the canonical decision at its exact link below. A local main branch
or feature branch cannot approve or change Authority text. Formal changes
require an existing, separately identified Architecture tracking Issue linked
to the originating source Issue, then the owning Authority branch and PR.
A source Issue can serve both roles only when it already belongs to Authority
and tracks that decision work. Never infer identity from a shared number.
Do not create an Issue without the user's authorization.

Use the pinned canonical architecture-decision skill through
[the local input reference](../../.agents/skills/architecture-decision/SKILL.md)
and [the shared template reference](adr-template.md). Hold if those trusted
inputs are unavailable; do not invent a local template or formal numbering
scheme. Consumer implementation follows an approved merged Architecture
Release and is reviewed in its own source Issue and repository.

## Provenance and namespace

Git history preserves the former17 local ADR texts and proposals. Their
consumer paths remain references where they match the canonical lineage.
Authority references20–24 use Authority identity; in particular, Authority
ADR-0020 is not the removed Control Plane ADR-0020 App-access proposal.
Repository identity, immutable source and record ID qualify each reference.
The canonical inventory, rather than a same-number local proposal, determines
meaning. No historical commits or decision provenance are rewritten.

## Selected Authority records

| Authority record | Consumer reference | Historical source Issue |
| --- | --- | --- |
| ADR-0001 | [Use MADR and GitHub Issues for architectural decisions](0001-use-madr-for-architecture-decisions.md) | [source](https://github.com/agentic-delivery-lab/agentic-delivery/issues/1) |
| ADR-0002 | [Use plain language for human-agent communication](0002-use-plain-language-for-human-agent-communication.md) | [source](https://github.com/agentic-delivery-lab/agentic-delivery/issues/3) |
| ADR-0003 | [Use context-scoped ubiquitous language](0003-use-context-scoped-ubiquitous-language.md) | [source](https://github.com/agentic-delivery-lab/agentic-delivery/issues/5) |
| ADR-0004 | [Use trunk-based delivery with short-lived feature branches](0004-use-trunk-based-delivery.md) | [source](https://github.com/agentic-delivery-lab/agentic-delivery/issues/7) |
| ADR-0005 | [Use Conventional Commits with Gitmoji](0005-use-conventional-commits-with-gitmoji.md) | [source](https://github.com/agentic-delivery-lab/agentic-delivery/issues/7) |
| ADR-0006 | [Curate a human-readable changelog](0006-curate-a-changelog.md) | [source](https://github.com/agentic-delivery-lab/agentic-delivery/issues/7) |
| ADR-0007 | [Use issue-linked Conventional branch names](0007-use-issue-linked-conventional-branch-names.md) | [source](https://github.com/agentic-delivery-lab/agentic-delivery/issues/11) |
| ADR-0008 | [Use pnpm with delayed dependency adoption and Node.js automation](0008-use-pnpm-with-delayed-dependency-adoption.md) | [source](https://github.com/agentic-delivery-lab/agentic-delivery/issues/12) |
| ADR-0009 | [Run Codex from source issues with a budget boundary](0009-run-codex-from-source-issues-with-a-budget-boundary.md) | [source](https://github.com/agentic-delivery-lab/agentic-delivery/issues/21) |
| ADR-0011 | [Run layered harness architecture reviews on pull requests](0011-run-layered-harness-architecture-reviews.md) | [source](https://github.com/agentic-delivery-lab/agentic-delivery/issues/25) |
| ADR-0012 | [Use GitHub as the lifecycle control plane](0012-use-github-as-the-lifecycle-control-plane.md) | [source](https://github.com/agentic-delivery-lab/agentic-delivery/issues/29) |
| ADR-0013 | [Derive ADR traceability from agentic primitives](0013-derive-adr-traceability-from-agentic-primitives.md) | [source](https://github.com/agentic-delivery-lab/agentic-delivery/issues/29) |
| ADR-0015 | [Isolate resumable runner execution by source issue](0015-isolate-resumable-runner-execution.md) | [source](https://github.com/agentic-delivery-lab/agentic-delivery/issues/29) |
| ADR-0016 | [Require structured pull-request descriptions](0016-require-structured-pull-request-descriptions.md) | [source](https://github.com/agentic-delivery-lab/agentic-delivery/issues/44) |
| ADR-0017 | [Use an explicit agent-invocation boundary for conversation-driven delivery](0017-use-an-explicit-agent-invocation-boundary.md) | [source](https://github.com/agentic-delivery-lab/agentic-delivery/issues/46) |
| ADR-0018 | [Organization-wide Agentic Delivery control-plane distribution and versioning](0018-organization-wide-agentic-delivery-control-plane-distribution-and-versioning.md) | [source](https://github.com/agentic-delivery-lab/agentic-delivery/issues/53) |
| ADR-0019 | [Canonicalize the orthogonal delivery-state field](0019-canonicalize-delivery-state-field.md) | [source](https://github.com/agentic-delivery-lab/agentic-delivery/issues/52) |
| ADR-0020 | [Centralize organization decision records in Architecture Authority](0020-centralize-organization-decision-records.md) | [source](https://github.com/agentic-delivery-lab/agentic-delivery-architecture/issues/3) |
| ADR-0021 | [Define per-family Architecture artifact contracts](0021-define-architecture-artifact-contracts.md) | [source](https://github.com/agentic-delivery-lab/agentic-delivery-architecture/issues/3) |
| ADR-0022 | [Use Neon Postgres for webhook replay state](0022-use-neon-postgres-for-webhook-replay-state.md) | [source](https://github.com/agentic-delivery-lab/agentic-delivery/issues/60) |
| ADR-0023 | [Use Projects for planning and Issues for execution authorization](0023-use-projects-for-planning-and-issues-for-execution-authorization.md) | [source](https://github.com/agentic-delivery-lab/agentic-delivery-architecture/issues/11) |
| ADR-0024 | [Centralize approved requirements in Requirements Authority](0024-centralize-approved-requirements-in-requirements-authority.md) | [source](https://github.com/agentic-delivery-lab/agentic-delivery-architecture/issues/11) |

ADP-0001 and ADD-0001 belong to other contexts. Their canonical text and all
other records are in the [pinned Authority index](https://github.com/agentic-delivery-lab/agentic-delivery-architecture/blob/0423533176ad6239fe5d828736605b5a6360293c/decisions/README.md); they are not copied here.
