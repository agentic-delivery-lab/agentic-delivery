# Changelog

<!-- agentic-primitive: {"id":"curated-changelog","kind":"instruction","enforcement":"instructional","adrs":["ADR-0006"],"domains":["agentic-delivery-governance"]} -->

All notable changes to this repository are documented here.

The format follows [Keep a Changelog 1.1.0](https://keepachangelog.com/en/1.1.0/),
and releases use [Semantic Versioning](https://semver.org/).

## [Unreleased]

- [Issue #52](https://github.com/agentic-delivery-lab/agentic-delivery/issues/52) pins the central intake bootstrap and manual recovery paths to the controller release `bootstrapCommit`; normal and recovery execution no longer fall back to a moving `main` ref.

Entries that reference issue #52 use it only as the persisted-plan context;
they do not authorize migration, alter that issue's scope, or close it.

### Changed

- The draft controller release advances to `0.2.0-draft.29` at
  `7061773305054da9eb33b4ef872a7b7c63364d65`, carrying the corrected
  traceability metadata for the release-bound Primitive selection contract;
  draft28 remains the explicit rollback pin for that contract increment.

- The draft controller release advances to `0.2.0-draft.28` at
  `0956144e5b9229209ad0fb82299a1d99a366ac66`. The new
  `primitive-selection.yml` contract binds every orchestration profile to
  released Primitive identifiers and pins the Primitive release, commit,
  content digest, and capability-policy version; draft27 remains the explicit
  rollback pin.

- The draft controller release advances to `0.2.0-draft.27` at
  `b52464571e1c0d3adfa5986bd54668d3c7da4a13`, making the release-chain digest
  implementation itself immutable and commit-verifiable; draft26 remains the
  explicit rollback pin.

- Release-chain digest verification now executes the pinned Architecture and
  Primitive digest tools from their exact dependency commits, rather than a
  mutable sibling worktree copy; a regression fixture proves a modified
  worktree tool cannot satisfy the release gate.

- Release-chain validation now reads Architecture and Primitive release
  manifests from the exact immutable commits pinned by the Control Plane,
  preventing a drifted sibling worktree from satisfying the release gate.

- The draft controller release advances to `0.2.0-draft.26` at
  `81fa558aad0f998876bc29871080f2380b2c8582`, pinning Architecture draft
  `0.1.0-draft.6` at `5655c0fda81e9ebcc6e3f7e9805e966ce15ed96b` with its
  changelog-inclusive integrity digest; draft25 remains the explicit rollback
  pin.

- The draft controller release advances to `0.2.0-draft.25` at
  `81fa558aad0f998876bc29871080f2380b2c8582`, pinning Architecture draft
  `0.1.0-draft.5` at `2bfe92c8c641a2258d4393a37785c793d8a46c48` with a
  reproducible non-null content digest. Release-chain validation now also
  compares the Architecture release manifest's declared digest with the
  controller dependency pin; draft24 remains the explicit rollback pin.

- The draft controller release advances to `0.2.0-draft.24` at
  `1c33a16b9a5a7e6480410c69bdda32648126eabc`. The trusted intake bootstrap
  remains explicitly pinned to the supported draft23 commit while participant
  pins upgrade deliberately.

- The draft controller release advances to `0.2.0-draft.23` at
  `30197d5c8731ea6e682ae4de5e629b964e278aab`. The central pull-request
  observation workflow now validates the participant's immutable controller
  release instead of following a moving `main` ref; draft22 remains the
  explicit rollback pin.

- The draft controller release advances to `0.2.0-draft.22` at
  `ccbe92fffd41d0e5cdc906a170e74f2a723e7386`, moving pull-request
  observations to a dedicated read-only `agent_observation` dispatch workflow;
  draft21 remains the explicit rollback pin.

- The draft controller release advances to `0.2.0-draft.21` at
  `9634a711ded35f54a69e4c361fc3369100d84290`, adding centrally signed
  pull-request observation events without granting them issue-invocation or
  lifecycle-transition semantics; draft20 remains the explicit rollback pin.

- Added `release-chain:check` and `scripts/validate-release-chain.mjs`. An
  explicitly supplied set of Architecture Authority, Agentic Primitives,
  Distribution, and `.github-private` checkouts must now reproduce the
  Control Plane's immutable release pins, content digests, workflow source,
  Agent Plugin inputs, and publication provenance. The check is a release
  coordination gate and does not activate or mutate any GitHub surface.

- The draft controller release advances to `0.2.0-draft.20` at
  `213036f87776dcf75e349355ff7983ded476c42e`, carrying the explicit
  two-part enrollment fail-closed acceptance contract while retaining draft19
  and earlier rollback pins.

- The draft controller release advances to `0.2.0-draft.19` at
  `02b742c86f77700e8c787ae17f31959d22bbdf2e`, retaining the acyclic
  Architecture draft4 / Primitive draft4 release chain at immutable commits
  `61b2285334b5cff4ae2dba7875b132ad2a4a8502` and
  `51e94992c5f39c59046f752e0cf6cff2ed3fff32`; draft18 and earlier remain
  explicit rollback pins.

- The draft controller release advances to `0.2.0-draft.18` at
  `d34d37170c8bfaf944ee0a2bb7b52aac145febf4`, aligning the Primitive release
  `0.1.0-draft.4` at `13acf15d7d2c5ed12b9158d57ff45fcce93d1a06` with the
  Architecture draft4 pin while retaining draft17 and earlier rollback pins.

- The draft controller release advances to `0.2.0-draft.17` at
  `a788cd2eec8e92e9cad05530ed624fec80770f41`, aligning Architecture draft
  `0.1.0-draft.4` and Primitive draft `0.1.0-draft.4` with immutable content
  digests while retaining draft16 and earlier rollback pins.

- The offline organization acceptance matrix now exercises `.github-private`
  as an origin-event participant without placing central App credentials in its
  publication workflow.
- The same acceptance matrix now requires the private publication validator to
  use an immutable Control Plane pin and credential-free checkouts.
- The same matrix now proves that App repository access and participant-registry
  enrollment are both required, and that removing either condition fails closed.

- The draft controller release advances to `0.2.0-draft.16` at
  `9e4ca88eb69a4df69067162d0fbc7100bd6cf691`, aligning Architecture draft
  `0.1.0-draft.3` and Primitive draft `0.1.0-draft.3` with immutable content
  digests while retaining draft15 and earlier rollback pins.

- The draft controller release advances to `0.2.0-draft.15` at
  `ce6a0144edeefbb8125962c06f70b9c9c91cde78`, pinning Primitive release
  `0.1.0-draft.2` at `cfd86652d9f3a830c28d3dd40f6e762588c0af75` with its
  canonical content digest while retaining draft14 and earlier rollback pins.

- The draft controller release advances to `0.2.0-draft.14` at
  `707a4a74c8d331f2400fffa2714f04b8a7d59b9b`, requiring the pinned
  Architecture content digest in conformance requests and retaining draft13
  and earlier controller pins for rollback.

- The draft controller release advances to `0.2.0-draft.13` at
  `52e7a2092a1e7807ee091264a3dbbe97b8764593`, extending the offline
  multi-repository acceptance evidence through API, git, pull-request, and
  delivery-evidence projections while retaining draft12 and earlier rollback
  pins.

- The migration boundary manifest now distinguishes locally prepared
  Architecture, Primitives, and Distribution checkouts from remote-ready
  targets; local preparation does not imply publication or activation.

- The draft controller release advances to `0.2.0-draft.12` at
  `3ea621d64507c0ef187181a487e5f8ff190e5aa3`, adding deterministic lifecycle
  write-back coverage to the two-repository acceptance matrix while retaining
  draft11 and earlier rollback pins.

- The draft controller release advances to `0.2.0-draft.11` at
  `83f164388096e0e343b1641c27ee399e509bf68b`, retaining draft10, draft9, and
  earlier pins while making the acceptance validator repository-independent.

- The offline acceptance matrix now exercises the controller's deterministic
  lifecycle write-back contract independently for both fixture repositories;
  it still makes no claim about live GitHub mutation.

- The draft controller release advances to `0.2.0-draft.10` at
  `8c883b754dc03498788615160ee7f6cf2effb6fc`, adding the offline
  multi-repository acceptance matrix while retaining draft9 and earlier
  rollback pins.

- [Issue #52](https://github.com/agentic-delivery-lab/agentic-delivery/issues/52) advances the draft controller release to `0.2.0-draft.9` at `379fd73526054037e1f4dcf7ef728dcf01baaa6c`, requiring an explicit controller repository ID while retaining draft8, draft7, draft6, and draft2 rollback pins.
- [Issue #52](https://github.com/agentic-delivery-lab/agentic-delivery/issues/52) advances the draft controller release to `0.2.0-draft.8` at `eeef545c40d5b9e9a590e335c5ab193deaaac928`, requiring an explicit App installation identity while retaining draft7, draft6, and draft2 rollback pins.
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

- Added a redacted, read-only GitHub organization inventory command and v1
  evidence schema. It records repository boundaries, rulesets, workflows,
  open work, labels, cross-repository references, and capability gaps without
  inferring absence from an inaccessible endpoint or mutating GitHub state.

- Added an offline two-repository acceptance matrix that proves shared
  controller identity, isolated issue namespaces, compatibility rollback, and
  the central App credential boundary without claiming live GitHub activation.

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

- [Issue #52](https://github.com/agentic-delivery-lab/agentic-delivery/issues/52) removes the central controller repository-ID runtime default; the gateway now requires an explicit `AGENTIC_DELIVERY_CONTROLLER_REPOSITORY_ID` before dispatch.
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

- [Issue #52](https://github.com/agentic-delivery-lab/agentic-delivery/issues/52) fails closed when the central GitHub App installation ID is absent instead of relying on a stale deployment default; tests must provide the verified installation explicitly.
- [Issue #52](https://github.com/agentic-delivery-lab/agentic-delivery/issues/52) makes unscoped GitHub App installation tokens an explicit non-production test opt-in; every production token path must provide the originating or controller repository ID.
- Subscription-only delivery pauses when credit spillover is possible or credit telemetry is unavailable, in addition to the 98-percent usage boundary.
