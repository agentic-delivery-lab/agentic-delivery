# Changelog

<!-- agentic-primitive: {"id":"curated-changelog","kind":"instruction","enforcement":"instructional","adrs":["ADR-0006"],"domains":["agentic-delivery-governance"]} -->

All notable changes to this repository are documented here.

The format follows [Keep a Changelog 1.1.0](https://keepachangelog.com/en/1.1.0/),
and releases use [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- [Issue #29](https://github.com/sjefsharp/agentic-delivery/issues/29) adds GitHub-controlled iterative refinement and conditional decomposition, deterministic lifecycle transition validation, separated work and execution state, generated ADR-to-primitive traceability, repository-scoped App publication credentials, and per-issue runner isolation.

- [Issue #25](https://github.com/sjefsharp/agentic-delivery/issues/25) adds a baseline architecture-conformance review, a versioned delivery evidence contract, and a read-only layered Harness Architecture Review for internal pull requests.

- [Issue #17](https://github.com/sjefsharp/agentic-delivery/issues/17) adds deterministic issue intake, work-type classification, lifecycle routing, readiness gating, structured forms, and automatic handoff to the reusable Plan → Implement workflow.

- [Issue #15](https://github.com/sjefsharp/agentic-delivery/issues/15) proposes immediate source issue intake with Codex planning, implementation, issue audit history, review pull requests, and resumable quota pauses on the self-hosted runner.

- [Pull request #2](https://github.com/sjefsharp/agentic-delivery/pull/2) established the issue-driven architecture decision workflow, including MADR records, linked GitHub Issues, feature-branch review and `main` as the official source.
- [Pull request #4](https://github.com/sjefsharp/agentic-delivery/pull/4) introduced adaptive Dutch/English human-agent communication, plain-English repository documentation, a reusable plain-language skill and contract checks.
- [Pull request #6](https://github.com/sjefsharp/agentic-delivery/pull/6) introduced context-scoped ubiquitous language for the `agentic-delivery-governance` bounded context, with a canonical register, guidance, validators and CI checks.
- [Pull request #8](https://github.com/sjefsharp/agentic-delivery/pull/8) introduced trunk-based delivery, Conventional Commits, Gitmoji, curated changelog validation, delivery-quality CI and repository settings that allow merge commits and delete merged head branches.
- [Issue #11](https://github.com/sjefsharp/agentic-delivery/issues/11) adds issue-linked branch names, early validation and an open-source-issue check for supported branch creation and internal pull requests.
- [Issue #12](https://github.com/sjefsharp/agentic-delivery/issues/12) adopts exact pnpm tooling with a strict 48-hour dependency release-age policy and portable Node.js ESM governance commands.

### Fixed

- [Issue #29](https://github.com/sjefsharp/agentic-delivery/issues/29) allows intentional gaps after ADR removal and shows the latest validation error in terminal recovery comments without relisting completed plan tasks.

- [Issue #26](https://github.com/sjefsharp/agentic-delivery/issues/26) lets issue intake create missing governance metadata labels instead of failing label reconciliation with a GitHub API validation error.

- [Issue #17](https://github.com/sjefsharp/agentic-delivery/issues/17) established a separate workflow-capable publication boundary; [Issue #29](https://github.com/sjefsharp/agentic-delivery/issues/29) moves that boundary to a repository-scoped GitHub App and keeps the credential away from model tools.

- [Issue #21](https://github.com/sjefsharp/agentic-delivery/issues/21) replaces absolute Codex turn deadlines with quota-led execution, starts the inactivity watchdog only after turn startup, continues multi-turn implementation automatically, and preserves exact tasks when a structured completion is rejected.

- [Issue #17](https://github.com/sjefsharp/agentic-delivery/issues/17) renders Codex progress as concise Markdown, clearly separates human questions from technical pauses, supports natural-language recovery requests, coalesces rapid updates, and prevents a planning-continuation prompt from leaking into implementation.

- [Issue #18](https://github.com/sjefsharp/agentic-delivery/issues/18) restores exact issue continuation with persistent Codex session UUIDs, trusted owner comments, explicit `awaiting-human` state, duplicate-event protection, and one-time legacy session reconstruction.

- Headless runner Codex authentication uses the service account's explicit file-backed credential store. Startup and protocol errors publish safe diagnostic hints without raw authentication data.
- Paused delivery runs return to planning when the source issue changes, preserve invalid saved state for inspection, and refuse to publish changes that no longer match the verified tree.

### Security

- Subscription-only delivery pauses when credit spillover is possible or credit telemetry is unavailable, in addition to the 98-percent usage boundary.
