# Changelog

<!-- agentic-primitive: {"id":"curated-changelog","kind":"instruction","enforcement":"instructional","adrs":["ADR-0006"],"domains":["agentic-delivery-governance"]} -->

All notable changes to this repository are documented here.

The format follows [Keep a Changelog 1.1.0](https://keepachangelog.com/en/1.1.0/),
and releases use [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Changed

- [Issue #52](https://github.com/agentic-delivery-lab/agentic-delivery/issues/52) advances the draft controller release to `0.2.0-draft.7` at `48bc83b2c52e0d9aeee47905d4877ba75657c354`, the first pin that contains the canonical executable `config/` boundary, while retaining immutable draft6 and draft2 rollback pins.
- [Issue #52](https://github.com/agentic-delivery-lab/agentic-delivery/issues/52) moves the executable issue metadata and orchestration contracts from the repository-local `.github/` bridge into canonical `config/` files; the public organization `.github` repository remains responsible only for GitHub-supported defaults.
- [Issue #52](https://github.com/agentic-delivery-lab/agentic-delivery/issues/52) advances the draft controller release to `0.2.0-draft.6` at `564a35fd798e75800a3bf15223afb8bd87d59581`, including the canonical `config/` enrollment boundary, origin-ID authorization, and default origin-scoped App tokens; existing participants remain shadow-only.
- [Issue #52](https://github.com/agentic-delivery-lab/agentic-delivery/issues/52) retains the prior immutable `0.2.0-draft.2` controller pin in the compatibility catalog so participant upgrades and exact-commit rollback remain intentional.
- [Issue #52](https://github.com/agentic-delivery-lab/agentic-delivery/issues/52) advances the draft Control Plane pin to the locally validated organization-aware controller commit and aligns its Architecture and Primitive dependency pins; the release remains draft and shadow-only pending authorized rollout.

- [Issue #52](https://github.com/agentic-delivery-lab/agentic-delivery/issues/52) binds webhook envelopes to the configured organization, App installation, origin repository, and controller repository identities; dispatch tokens are narrowed independently and production replay protection fails closed without a durable claim store.
- [Issue #52](https://github.com/agentic-delivery-lab/agentic-delivery/issues/52) decouples the delivery ingress and controller from the originating repository identity: enrolled repositories are resolved by numeric repository ID, central workflows normalize dispatch events, and issue/state/API/git operations use an origin-scoped GitHub App token.
- [Issue #52](https://github.com/agentic-delivery-lab/agentic-delivery/issues/52) keeps shadow participants read-only: central intake may evaluate a routed proposal and publish evidence, but skips lifecycle, issue-comment, native-type, and delivery execution mutations until explicit activation.
- [Issue #52](https://github.com/agentic-delivery-lab/agentic-delivery/issues/52) carries the participant's immutable controller commit through the signed dispatch envelope and checks out that revision for intake and delivery only after trusted bootstrap authorization and preflight, instead of executing payload-selected code before validation.

- [Issue #52](https://github.com/agentic-delivery-lab/agentic-delivery/issues/52) adds provisional ADR-0018, the organization-wide Control Plane ownership, selected-repository enrollment, signed event boundary, immutable controller pins, compatibility policy, credential boundary, upgrade path, and rollback contract required before the repository split.

- [Issue #52](https://github.com/agentic-delivery-lab/agentic-delivery/issues/52) consolidates the repository-split, organization-wide Control Plane, Architecture Authority, Agentic Primitives, private publication, developer-environment distribution, execution-pattern, and migration design into one implementation-ready plan.

- [Issue #42](https://github.com/agentic-delivery-lab/agentic-delivery/issues/42) makes the published organization issue forms canonical for this repository. The repository has no local issue-form override, blank issues remain available, and CI validates the live organization source.
- [Issue #48](https://github.com/agentic-delivery-lab/agentic-delivery/issues/48) aligns the invocation identity with the registered `Agentic Delivery Lab Invoker 7F3A` GitHub App name, slug, mention, and bot login across the actor catalog, code, tests, and agentic documentation.

### Added

- [Issue #52](https://github.com/agentic-delivery-lab/agentic-delivery/issues/52) adds a machine-validated organization GitHub App contract and a secret-free, SHA-pinned reusable consumer quality workflow; Distribution records separate workflow-source and Control-Plane release pins.
- [Issue #52](https://github.com/agentic-delivery-lab/agentic-delivery/issues/52) adds the versioned participant registry, repository-ID enrollment checks, central-origin webhook/preflight contracts, scoped App-token tests, and multi-repository routing fixtures required for the first Control Plane migration slice.

- [Issue #44](https://github.com/agentic-delivery-lab/agentic-delivery/issues/44) adds a tested pull-request-body check, an explicit Dependabot-only exemption, a versioned required-check ruleset, agent instructions, and a provisional architecture decision. The repository is now public; live ruleset activation remains an authorized post-merge operator step.

- [Issue #48](https://github.com/agentic-delivery-lab/agentic-delivery/issues/48) adds the explicit `@agentic-delivery-lab-invoker-7f3a` invocation boundary for issue comments, pull-request conversation comments, formal reviews, and inline review comments, with a versioned actor catalog, GitHub App webhook, Vercel dispatch ingress, and one-hop bot handoff policy.

- [Issue #35](https://github.com/agentic-delivery-lab/agentic-delivery/issues/35) evolves intake to native organization Issue Types, pinned Lifecycle Stage and Delivery Readiness fields, capability-aware orchestration profiles, independent research/requirements/architecture/validation routes, and an idempotent migration path from legacy metadata labels.

- [Issue #32](https://github.com/agentic-delivery-lab/agentic-delivery/issues/32) lets Codex interpret each eligible issue and comment in context, then checks its proposed route and labels against the approved catalog before applying them. People do not need to add labels or use special phrases to continue normal work.

- [Issue #29](https://github.com/agentic-delivery-lab/agentic-delivery/issues/29) adds GitHub-controlled iterative refinement and conditional decomposition, deterministic lifecycle transition validation, separated work and execution state, generated ADR-to-primitive traceability, repository-scoped App publication credentials, and per-issue runner isolation.

- [Issue #25](https://github.com/agentic-delivery-lab/agentic-delivery/issues/25) adds a baseline architecture-conformance review, a versioned delivery evidence contract, and a read-only layered Harness Architecture Review for internal pull requests.

- [Issue #17](https://github.com/agentic-delivery-lab/agentic-delivery/issues/17) adds deterministic issue intake, work-type classification, lifecycle routing, readiness gating, structured forms, and automatic handoff to the reusable Plan → Implement workflow.

- [Issue #15](https://github.com/agentic-delivery-lab/agentic-delivery/issues/15) proposes immediate source issue intake with Codex planning, implementation, issue audit history, review pull requests, and resumable quota pauses on the self-hosted runner.

- [Pull request #2](https://github.com/agentic-delivery-lab/agentic-delivery/pull/2) established the issue-driven architecture decision workflow, including MADR records, linked GitHub Issues, feature-branch review and `main` as the official source.
- [Pull request #4](https://github.com/agentic-delivery-lab/agentic-delivery/pull/4) introduced adaptive Dutch/English human-agent communication, plain-English repository documentation, a reusable plain-language skill and contract checks.
- [Pull request #6](https://github.com/agentic-delivery-lab/agentic-delivery/pull/6) introduced context-scoped ubiquitous language for the `agentic-delivery-governance` bounded context, with a canonical register, guidance, validators and CI checks.
- [Pull request #8](https://github.com/agentic-delivery-lab/agentic-delivery/pull/8) introduced trunk-based delivery, Conventional Commits, Gitmoji, curated changelog validation, delivery-quality CI and repository settings that allow merge commits and delete merged head branches.
- [Issue #11](https://github.com/agentic-delivery-lab/agentic-delivery/issues/11) adds issue-linked branch names, early validation and an open-source-issue check for supported branch creation and internal pull requests.
- [Issue #12](https://github.com/agentic-delivery-lab/agentic-delivery/issues/12) adopts exact pnpm tooling with a strict 48-hour dependency release-age policy and portable Node.js ESM governance commands.

### Fixed

- [Issue #52](https://github.com/agentic-delivery-lab/agentic-delivery/issues/52) makes every controller compatibility and rollback pin resolve to an actual commit in the Control Plane history before release validation succeeds.
- [Issue #52](https://github.com/agentic-delivery-lab/agentic-delivery/issues/52) requires delivery execution to carry an authenticated numeric origin repository ID and rejects mismatches before model startup or GitHub mutation; App installation tokens are never requested without an origin scope.
- [Issue #52](https://github.com/agentic-delivery-lab/agentic-delivery/issues/52) runs the central intake preflight from its checked-out trusted controller path, so dependency installation and explicit invocation normalization do not execute from an empty Actions workspace.

- [Issue #48](https://github.com/agentic-delivery-lab/agentic-delivery/issues/48) corrects conversation-comment revalidation to use GitHub's global issue-comment endpoint, allowing a tagged invocation to pass preflight and continue into the delivery controller.

- [Issue #47](https://github.com/agentic-delivery-lab/agentic-delivery/issues/47) pins the native issue-field GraphQL control plane to GitHub API version `2026-03-10`, so live Lifecycle Stage and Delivery Readiness fields are not hidden by an older schema version.

- [Issue #32](https://github.com/agentic-delivery-lab/agentic-delivery/issues/32) makes delivery pauses short and actionable, and reviews changed ADRs from the pull-request branch rather than the reviewer's working tree.

- [Issue #29](https://github.com/agentic-delivery-lab/agentic-delivery/issues/29) allows intentional gaps after ADR removal and shows the latest validation error in terminal recovery comments without relisting completed plan tasks.

- [Issue #26](https://github.com/agentic-delivery-lab/agentic-delivery/issues/26) lets issue intake create missing governance metadata labels instead of failing label reconciliation with a GitHub API validation error.

- [Issue #17](https://github.com/agentic-delivery-lab/agentic-delivery/issues/17) established a separate workflow-capable publication boundary; [Issue #29](https://github.com/agentic-delivery-lab/agentic-delivery/issues/29) moves that boundary to a repository-scoped GitHub App and keeps the credential away from model tools.

- [Issue #21](https://github.com/agentic-delivery-lab/agentic-delivery/issues/21) replaces absolute Codex turn deadlines with quota-led execution, starts the inactivity watchdog only after turn startup, continues multi-turn implementation automatically, and preserves exact tasks when a structured completion is rejected.

- [Issue #17](https://github.com/agentic-delivery-lab/agentic-delivery/issues/17) renders Codex progress as concise Markdown, clearly separates human questions from technical pauses, supports natural-language recovery requests, coalesces rapid updates, and prevents a planning-continuation prompt from leaking into implementation.

- [Issue #18](https://github.com/agentic-delivery-lab/agentic-delivery/issues/18) restores exact issue continuation with persistent Codex session UUIDs, trusted owner comments, explicit `awaiting-human` state, duplicate-event protection, and one-time legacy session reconstruction.

- Headless runner Codex authentication uses the service account's explicit file-backed credential store. Startup and protocol errors publish safe diagnostic hints without raw authentication data.
- Paused delivery runs return to planning when the source issue changes, preserve invalid saved state for inspection, and refuse to publish changes that no longer match the verified tree.

### Removed

- [Issue #52](https://github.com/agentic-delivery-lab/agentic-delivery/issues/52) removes superseded task plans and continuation notes after their relevant constraints are incorporated into the consolidated migration plan; their history remains available in Git.

- [Issue #44](https://github.com/agentic-delivery-lab/agentic-delivery/issues/44) removes the repository-local pull request template after the organization default is published, so this repository uses the organization template without a local override.

- [Issue #42](https://github.com/agentic-delivery-lab/agentic-delivery/issues/42) removes the repository-local issue-form files after the equivalent organization defaults were published and verified.

### Security

- [Issue #52](https://github.com/agentic-delivery-lab/agentic-delivery/issues/52) makes unscoped GitHub App installation tokens an explicit non-production test opt-in; every production token path must provide the originating or controller repository ID.
- Subscription-only delivery pauses when credit spillover is possible or credit telemetry is unavailable, in addition to the 98-percent usage boundary.
