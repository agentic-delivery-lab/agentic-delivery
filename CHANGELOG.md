# Changelog

<!-- agentic-primitive: {"id":"curated-changelog","kind":"instruction","enforcement":"instructional","adrs":["ADR-0006"],"domains":["agentic-delivery-governance"]} -->

All notable changes to this repository are documented here.

The format follows [Keep a Changelog 1.1.0](https://keepachangelog.com/en/1.1.0/),
and releases use [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Changed

- [Issue #42](https://github.com/agentic-delivery-lab/agentic-delivery/issues/42) makes the published organization issue forms canonical for this repository. The repository has no local issue-form override, blank issues remain available, and CI validates the live organization source.

### Added

- [Issue #44](https://github.com/agentic-delivery-lab/agentic-delivery/issues/44) adds a tested pull-request-body check, an explicit Dependabot-only exemption, a versioned required-check ruleset, agent instructions, and a provisional architecture decision. The repository is now public; live ruleset activation remains an authorized post-merge operator step.

- [Issue #48](https://github.com/agentic-delivery-lab/agentic-delivery/issues/48) adds the explicit `@agentic-delivery-bot` invocation boundary for issue comments, pull-request conversation comments, formal reviews, and inline review comments, with a versioned actor catalog, GitHub App webhook, Vercel dispatch ingress, and one-hop bot handoff policy.

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

- [Issue #44](https://github.com/agentic-delivery-lab/agentic-delivery/issues/44) removes the repository-local pull request template after the organization default is published, so this repository uses the organization template without a local override.

- [Issue #42](https://github.com/agentic-delivery-lab/agentic-delivery/issues/42) removes the repository-local issue-form files after the equivalent organization defaults were published and verified.

### Security

- Subscription-only delivery pauses when credit spillover is possible or credit telemetry is unavailable, in addition to the 98-percent usage boundary.
