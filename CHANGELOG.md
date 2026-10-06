# Changelog

<!-- agentic-primitive: {"id":"curated-changelog","kind":"instruction","enforcement":"instructional","adrs":["ADR-0006","ADR-0018"],"domains":["agentic-delivery-governance","agentic-delivery-control-plane"]} -->

All notable changes to this repository are documented here.

The format follows [Keep a Changelog 1.1.0](https://keepachangelog.com/en/1.1.0/),
and releases use [Semantic Versioning](https://semver.org/).

## [Unreleased]

- [Issue #64](https://github.com/agentic-delivery-lab/agentic-delivery/issues/64) adds Neon-backed dispatch leases and controller receipts, persists cursors for bounded delivery-history scans, stores GitHub delivery IDs before advancing checkpoints, aggregates attempt outcomes across scan segments, and keeps active or uncertain webhook outcomes retryable.
- Failed deliveries are queued durably and drained 250 at a time. Accepted requests retry after a cooldown; unresolved final attempts and definitive rejections become exhausted and hold checkpoint progress until operator diagnosis and explicit retry. Rate-limited 403 responses honor GitHub's retry guidance.
- Unresolved exhausted redelivery requests no longer expire during ordinary queue claims; clearing their checkpoint hold requires operator diagnosis and an explicit requeue.
- Expired controller receipts at the eight-attempt limit become exhausted before bounded due selection; interrupted runs can no longer make a receipt reselectable forever.
- Architecture conformance review now includes only external ADRs cited by the pull request from its validated immutable Architecture Authority release, and the replay runbook records the daily 250-request limit and escalation threshold.
- The Harness fetches the complete history at its immutable Architecture Authority pin so release validation can verify the manifest's source commit.
- The controller release advances to `0.2.0-draft.65` at `103bea69b2f9a94bad6bdaa648df98635c193a5c`; Architecture Authority draft `0.1.0-draft.18` remains pinned, and draft64 stays available for rollback.
- Intake and delivery now use bootstrap commit `01503edac6533370b24f2e882e6ea1f7b2a21304`, which pins draft65's participant registry and checkpoint behavior.
- The controller release advances to `0.2.0-draft.64` at `29f9638ffcefdf50d3b6a24330b4bc6efe60b935`; Architecture Authority draft `0.1.0-draft.18` remains pinned, and draft63 stays available for rollback.
- Intake and delivery now use bootstrap commit `8c650ce2b76355c23f0e2ee47e4aeb67fab18b8c`, which pins draft64's participant registry and checkpoint behavior.
- The controller release advances to `0.2.0-draft.63` at `e840a775bc1b29867155c824e060660cf907b676`; Architecture Authority draft `0.1.0-draft.18` remains pinned, and draft62 stays available for rollback.
- Intake and delivery now use bootstrap commit `b0fee57e33ffd9285ebd3de5d326a775d9500449`, which pins draft63's participant registry and checkpoint behavior.
- The controller release advances to `0.2.0-draft.62` at `0145f5394eb6cb2cb080d609bb271fd5e308c932`; Architecture Authority draft `0.1.0-draft.18` supplies the cited ADR evidence, and draft61 remains available for rollback.
- Intake and delivery now use bootstrap commit `02e49824fe7886e1b73ee8be9a5a39daf6263fa3`, which pins draft62's participant registry and immutable Architecture Authority evidence source.
- The controller release advances to `0.2.0-draft.61` at `3f7efb8f1f51ba981dc17dd4cf6a74c579df0a6e`; the central participant moves to that immutable pin while draft60 remains available for rollback.
- The controller release advances to `0.2.0-draft.60` at `d3036197be223efa2050e9d795dac87c6b8df68c`; the central participant moves to that immutable pin while draft59 remains available for rollback.
- The controller release advances to `0.2.0-draft.59` at `2ab8bbe20c2ae01616af91ee224dcb1da881ed0c`; the central participant moves to that immutable pin while draft58 remains available for rollback.
- Reconciliation links every observed webhook attempt to its matching controller receipt before checkpointing, including receipts that are not due yet. Due-receipt batches exclude unlinked rows before applying the limit, preventing stale rows from starving eligible retries.
- Definitive GitHub errors and final attempts without observed success remain as exhausted requests for operator diagnosis and explicit retry. Rate-limited 403 responses remain retryable.
- Review follow-up pins invocation finalization to the validated participant controller commit and makes webhook ingress fail closed instead of selecting a configured local file store. Migration 0004 retains temporary webhook delivery observations until the full scan reaches its checkpoint.
- The controller release advances to `0.2.0-draft.58` at `cbf54a4e96643e5098c8478f1fb4219fed23774c`; the central participant moves to that immutable pin while draft57 remains available for rollback.
- The controller release advances to `0.2.0-draft.57` at `8483b16d2b106133538ecca5f642e781d0fdfcd8`; the central participant moves to that immutable pin while draft56 and earlier remain available for rollback.
- Draft57 used bootstrap commit `ea0148b5f8bb42b3e989f823c1892d5363948aac` for its webhook recovery code and participant registry.
- Intake and delivery now use bootstrap commit `054a2cc4ff6d5368d5f8c12300ca53d6bf81a877`, which pins draft61's webhook recovery code and participant registry.
- [Issue #52](https://github.com/agentic-delivery-lab/agentic-delivery/issues/52) pins the central intake bootstrap and manual recovery paths to the controller release `bootstrapCommit`; normal and recovery execution no longer fall back to a moving `main` ref.
- The controller release advances to `0.2.0-draft.39` at
  `53c76a68cf1a7cab2141034bd477d8cb761bf4c6`; the central participant moves
  to that immutable pin while draft38 and draft37 remain supported for
  rollback. The bootstrap uses commit
  `c83fb414a0b5637bf8b8ba3d3539a7e669958512`, which contains the draft39
  participant registry.
- [Issue #66](https://github.com/agentic-delivery-lab/agentic-delivery/issues/66)
  now keeps reusable delivery policy at the workflow boundary:
  callers cannot supply participant mode, controller pin, or read-only state;
  a hosted resolver checks the main-branch caller and source identity, then
  derives those values from the fixed participant-registry bootstrap.
- The GitHub App contract advances to version `2.0.0` with a version-2 schema;
  the draft40 controller release pins that contract version.
- The controller release advances to `0.2.0-draft.40` at
  `27eafd8003c4657742205e77739b4ee261482db4`; the central participant moves
  to this immutable pin while draft39 and earlier releases remain available
  for rollback.
- Intake and manual recovery now use bootstrap commit
  `b87ab48ab616e02a1cfba4b6bce57769a523c739`, which contains the draft40
  central participant pin.
- The controller release advances to `0.2.0-draft.41` at
  `4f8bacfef5bcd375459756d2a39ab77b9b9be95c`; the central participant moves
  to that pin while draft40 and earlier remain available for rollback.
- Intake and delivery now use bootstrap commit
  `286db47f1686becbe91e6339d90e7033015e21fa`, which contains the draft41
  central participant pin.
- The controller release advances to `0.2.0-draft.42` at
  `b17a2077b645e7eb861aeb75558d77fb1c46011c`; the central participant
  moves to this pin while draft41 and earlier remain available for rollback.
- Intake and delivery now use bootstrap commit
  `76ff0ff7bd35479251b9bfdf4bf420251d5738d5`, which contains the draft42
  central participant pin.
- The hosted intake gate now validates caller repository identity against the
  trusted App contract and participant registry before actor authorization or
  self-hosted classification; accepted and rejected event/workflow pairs have
  deterministic behavior coverage.
- The controller release advances to `0.2.0-draft.43` at
  `c4fcfdf58379af5a0df500af7e005388af93dfb9`; the central participant moves to
  this immutable pin while draft42 and earlier releases remain available for
  rollback.
- Intake and delivery now use bootstrap commit
  `a8f11cc70fbd16e4f31498fb68bf7a9a24841cac`, which contains the draft43
  central participant pin and caller provenance validator.
- Private agent publication validation can now reproduce each projection from
  the exact Primitive source commit named by its provenance lock; the release
  chain checks the same byte-for-byte relationship.
- Architecture review now requires an immutable Architecture Authority
  checkout, release digest reproduction, conformance policy, and tooling-lock
  validation before deterministic review evidence is trusted.
- Distribution draft22 and the private publication validator now pin the
  Architecture-aware workflow source at
  `6843c8e6a5ef3d7ec31400a9d7af282d07c5a37b`.
- The cross-repository release-chain check now requires the versioned
  `.github-private` publication ruleset desired state, including code-owner
  review, the publication validator check, and no bypass actors; this remains
  operator-applied desired state rather than proof of live GitHub protection.
- The persisted migration plan now records that the locally prepared
  Architecture and Primitive manifests still need a real history-filter run
  from the supplied `agentic-delivery` `main` snapshot before publication;
  changing provenance metadata alone is explicitly rejected.
- Private publication validation now rejects repository-local skill,
  instruction, hook, plugin, MCP, and alternate-agent directories so
  `.github-private` cannot become an implicit organization-wide capability
  distribution surface.

Entries that reference issue #52 use it only as the persisted-plan context;
they do not authorize migration, alter that issue's scope, or close it.

### Changed

- The controller release manifest and central participant registry now target
  `0.2.0-draft.52` at
  `8a2acddf07d0b70b11fc5d9c1f5143e54abf9185`, retaining draft51 and draft50
  for rollback. The participant remains in shadow mode. Its release PR kept
  the bootstrap at `b99fb89907da164b8b45a229e7569013ac093f60` pending this
  separate reviewed update.
- [Issue #60](https://github.com/agentic-delivery-lab/agentic-delivery/issues/60)
  advances `bootstrapCommit` and all intake and delivery workflow checkout
  refs to merge commit `7f71508ea4cf4ff881b8d1b7628dc5722fca24b5`, which
  contains the draft52 participant pin and issue-field masker. The central
  participant remains in shadow mode pending the post-merge canary.
- The controller release manifest and central participant registry now target
  `0.2.0-draft.51` at
  `0f7a40dbd475105bf39cb475d91e3903a78d250b`, retaining draft50 and draft49
  for rollback. Runtime intake and delivery use this pin from the trusted
  bootstrap snapshot at `b99fb89907da164b8b45a229e7569013ac093f60`.
- The controller release manifest and central participant registry now target
  `0.2.0-draft.48` at
  `28ea907b8346d8b63b45567d526ee5be536fcc49`, retaining draft47 and draft46
  for rollback. Runtime intake uses this pin after a separate reviewed
  bootstrap advance.
- The controller release manifest and central participant registry now target
  `0.2.0-draft.47` at
  `8011a3c09d9d4c764a3487022bfcb722541bdf2d`, retaining draft46 and draft45 for
  rollback. Runtime intake uses this pin after a separate reviewed bootstrap
  advance.
- The controller release manifest and central participant registry now target
  `0.2.0-draft.46` at
  `3eff353fb7c00b1931d874d08c0ddfa5500bbe6d`, retaining draft45 for rollback.
  Runtime intake uses the new pin after a separate reviewed bootstrap advance.
- [Issue #68](https://github.com/agentic-delivery-lab/agentic-delivery/issues/68)
  records sanitized Harness quota diagnostics with stop phase, trigger causes,
  bounded quota-window evidence, and retry eligibility only when supported by
  telemetry. The internal review schema is validated but remains outside the
  participant contract; review input excludes quota counters, credentials are
  redacted, and reruns refresh the current pull request and source issue.
- [Issue #60](https://github.com/agentic-delivery-lab/agentic-delivery/issues/60)
  advances `bootstrapCommit` to the merged controller snapshot
  `b99fb89907da164b8b45a229e7569013ac093f60`, which supplies the masker
  implementation used by the existing intake and delivery workflow steps.
  Supported participant pins do not need to carry a copy of the masker.
- The controller release manifest and central participant registry now target
  `0.2.0-draft.45` at
  `eed2505edaf4e1f839030697973dcaaf0c1b1bea`, retaining draft44 for rollback.
- Controller release validation checks that the primary release and bootstrap
  pin contain the issue-field binding masker used by shared intake and delivery.
- The controller release advances to `0.2.0-draft.44` at
  `331c433345519f00ecc15be0bd843a45651147f2`; the central participant
  moves to that immutable code pin while draft43 and earlier remain
  available for rollback.
- Read-only issue intake now requires the scoped `readOnlyIntake` App token and
  fails closed if its credentials are unavailable. The classify job's workflow
  token has repository read permissions only.
- Active intake and delivery now require origin-scoped GitHub App credentials
  in Actions and fail closed instead of falling back to publication or workflow
  tokens.
- ADR-0018 and the domain register distinguish participant contract versions
  from controller-wide interfaces, including the GitHub App contract pinned by
  the controller release manifest; the amendment records the alternatives and
  rationale.
- Origin-scoped App tokens now use explicit invocation-preflight, read-only
  intake, active intake, and delivery permission profiles. The versioned
  contract is validated against the code-defined permission profiles, and
  token requests use the selected profile's map. Origin repository IDs still
  narrow repository resources, while the approved issue-field and issue type
  reads remain organization-wide.
- The release-chain validator now requires both issue intake and Codex delivery
  to check out the bootstrap commit named by the controller release manifest.
- Harness review now includes the sanitized pull-request body and latest
  check-run status for the reviewed head; editing a pull request reruns the
  read-only review after its verification evidence is updated.
- Direct intake resolves the participant mode from the pinned registry by
  repository ID and verifies the expected repository name. A manual
  `force_read_only` override applies only to that run and cannot change or
  promote the registered participant mode; delivery requires an active
  participant and a non-read-only run.
- Direct manual intake and delivery recovery read their controller pin and
  participant mode from the fixed bootstrap registry. They default to
  read-only; the self-hosted delivery job receives write permissions only for
  an active, explicitly non-read-only run.

- Actions now use Codex CLI 0.159.3 pinned to the published Linux asset
  SHA-256 and its extracted package-tree digest; every runner setup verifies the
  cached or newly extracted package contents. A weekly updater verifies
  candidate assets, records both digests, creates a release-specific Task
  issue, and opens review PRs with a repository-scoped App token so normal
  PR checks start automatically. The updater waits for exact-head body,
  quality, portability, and applicable ADR-quality checks before dispatching
  the no-generation runner smoke, then starts Harness only after that smoke
  passes. It refetches and verifies the PR and Task immediately before smoke
  and again before Harness dispatch. It validates the exact smoke workflow run
  ID, head SHA, dispatch event, and `codex=true` run name. A base-revision classifier verifies that
  only a fully matching updater PR and source Task, including the Task's native
  issue type, can delay automatic Harness review; mismatches and unavailable
  evidence run normal review. The updater and Harness verify that required
  exact-head checks came from their expected workflow file and matching job,
  rather than trusting the check name alone. The updater paginates the
  pull-request list and exact-head check-run evidence and stops on incomplete
  or mismatched provenance. It paginates the release Task
  search and refuses to create an issue when search results are incomplete or
  exceed the GitHub Search API limit. Reusing an open updater PR or dispatching
  its runner smoke requires refetching the exact PR and verifying its
  registered App author, branch, title, marker, source line, release URL, and
  archive and package-tree digests against the verified candidate and linked
  native Task. The GitHub-hosted classifier applies the same release identity
  and digest match before delaying automatic
  Harness review; a copied marker or same-looking branch cannot suppress it.
  A closed update PR no longer blocks later releases after its linked Task
  issue is resolved.
- Codex delivery and Harness review now use phase-specific GPT-6 Luna
  Low/Medium/Max and GPT-6 Sol High profiles, with runner-catalog preflight,
  complete matching-entry capability checks, safe reporting for unsupported
  profile pairs, and no model fallback.
- Harness review excludes its own check run only after verifying its exact
  workflow path, keeps quota counters outside the semantic model input, limits
  primitive evidence to affected ADR metadata,
  waits for exact-head deterministic checks and their verified workflow
  provenance, and skips a model turn when a required check fails, stays
  incomplete, or comes from another workflow. It resumes interrupted Codex
  threads only when the full evidence fingerprint is unchanged; changed
  evidence starts in an isolated thread directory. Expired review state,
  including the current candidate directory, is pruned before review. It reuses
  a completed result for an exact evidence fingerprint without a new model
  turn. Identical check reruns no longer
  invalidate that fingerprint only because run IDs, links, or timestamps
  changed. Transient preflight and quota results do not invalidate that
  fingerprint. Protected runner-local session data is
  pruned after 30 days. A failed preflight still writes sanitized per-window
  usage and guard signals to the Actions summary and runner log. Deterministic
  quality and ADR checks run on ephemeral hosted runners so they can finish
  while Harness waits on the single persistent Codex runner.
- Semantic Harness review now includes all changed paths with five lines of
  context. Diffs above the 500,000-character safety limit stop before a model
  turn and report an explicit evidence gap instead of reviewing a truncation.
  Automatic updater suppression is restricted to the registered delivery App
  bot, and the semantic bundle omits its expected pre-turn result placeholder.
- Issue intake, delivery, and metadata migration now verify that the live
  Lifecycle Stage and Delivery Readiness fields are pinned to every enabled
  issue type and to issues without a type before authorizing field changes.

- The public `.github` governance candidate is now based on the supplied
  current snapshot in a clean worktree and is validated by its immutable
  evidence pin; the original dirty user checkout is not release evidence.
- The observed public `.github` repository is enrolled in the central
  participant registry as `shadow` only. Shadow intake requests read-only
  origin App permissions and cannot mutate issue state until explicit
  activation.

- Central `repository_dispatch` handoffs now carry a time-bounded HMAC signed
  envelope. The dispatch secret is separate from the GitHub webhook secret and
  remains confined to the gateway/controller boundary; preflight rejects
  tampering, stale timestamps, and missing production configuration.

- The draft controller release advances to `0.2.0-draft.37`, pinning
  Architecture Authority draft `0.1.0-draft.8` and its dispatch-auth ADR at
  immutable commit `9d4872c39e9c52075a7a299ad4584ac3eb704a1b`; draft36 remains
  the explicit rollback pin.

- The draft controller release advances to `0.2.0-draft.36` at
  `0ae64cb2b1560e7a9e73435e954e3be8bc3b2b88`; draft35 remains the explicit
  rollback pin after the central dispatch-envelope HMAC hardening.

- The clean public `.github` governance candidate advances to
  `ad9489fa860e7214084da6a5d834078084f4908f` so its thin workflow template
  carries the same draft36 Control Plane pin; this remains local evidence only.

- The draft controller release advances to `0.2.0-draft.35` at
  `02c29af7572ea0fc5a593786dc9583cb1d275f3f`, adopting the filtered
  Architecture draft7 candidate and the main-snapshot Primitive candidate;
  draft34 remains the explicit rollback pin.

- The draft controller release advances to `0.2.0-draft.34` at
  `825d808164ed747187490d50727bfe38061b0932`; repository identity checks now
  read the deployment contract instead of embedding the current controller
  repository, and draft33 remains the explicit rollback pin.

- The draft controller release advances to `0.2.0-draft.33` at
  `d8c77d5e68909c441066532a7bae2af994207316`, binding the canonical preview
  Automation templates to an immutable Control Plane source while retaining
  draft32 as the explicit rollback pin.

- The Control Plane now carries two manually triggered, read-only VS Code
  Automation templates with a strict portable-frontmatter validator and an
  explicit Distribution projection contract. Client-local schedule, model,
  permission, enabled-state, and run-history data remains outside GitHub
  lifecycle authority.

- The read-only organization inventory now probes `.github` and
  `.github-private` as GitHub special surfaces and records a private-surface
  404 as `not-found-unverified`, preserving the distinction between an absent
  repository and inaccessible private metadata.

- Migration evidence now validates `.github` and `.github-private` as narrow
  GitHub-defined special surfaces, keeping consumed paths, governance paths,
  non-inherited workflows, projection provenance, and private-surface
  exclusions explicit and outside the runtime control plane.

- The draft controller release now publishes and validates an explicit support
  matrix for event envelopes, lifecycle/state-machine/evidence contracts,
  Primitive and Architecture compatibility, minimum bootstrap, upgrade
  support windows, pre-release handling, and fail-closed security revocation.
  Validation also requires the matrix to include the current contract versions
  and the pinned dependency majors.

- Control Plane ingress, contract configuration, workflows, runtime libraries,
  and migration manifests now have scoped `AGENTS.md` boundaries so the
  repository's generic lifecycle implementation remains distinct from
  organization governance, architecture, and Primitive ownership.

- The draft controller release advances to `0.2.0-draft.32` at
  `00f2daf3a02ea0ca5610d44d8b17aa3b8bb228eb`; runtime invocation,
  observation, and lifecycle route maps now derive from the canonical event
  catalog, and draft31 remains the explicit rollback pin.

- The draft controller release advances to `0.2.0-draft.31` at
  `ba7a161b93f3f35849362139ee3a281318e9183c`, enforcing role semantics in
  the organization event catalog; draft30 remains the explicit rollback pin.

- The draft controller release advances to `0.2.0-draft.30` at
  `069475071cfa6b725446e8179ad1db164dc2d96e`, making the organization
  event/action catalog explicit and validating the GitHub App contract against
  that release-bound source; draft29 remains the explicit rollback pin.

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

- [Issue #64](https://github.com/agentic-delivery-lab/agentic-delivery/issues/64) adds a Neon-backed atomic webhook replay store, a repeatable minimal schema migration, and bounded cleanup of expired claims.

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

- [Issue #60](https://github.com/agentic-delivery-lab/agentic-delivery/issues/60) preserves exact large GitHub delivery IDs, repairs an exhausted retry only when fresh history confirms a different ID for the same GUID, and emits payload-free status evidence for webhook dispatch failures.
- [Issue #60](https://github.com/agentic-delivery-lab/agentic-delivery/issues/60) adds structured, payload-free logs for accepted webhook deliveries, individual redelivery outcomes, GitHub API status codes, and reconciler run totals; a known API result remains visible when Neon cannot persist it, while the run fails without advancing its checkpoint.
- [Issue #60](https://github.com/agentic-delivery-lab/agentic-delivery/issues/60)
  preserves safe Codex error categories and HTTP status codes on failed turns
  and start rejections, reports bounded error-message and additional-detail
  shapes, keeps specific correlated error codes across later generic errors,
  and reports completion and notification fields separately so each code stays
  paired with its HTTP status. It records terminal source and retry count
  capped at 99, and caps failure duration at 24 hours. Diagnostics remain
  scoped to the exact thread and turn; raw error text and additional details
  stay withheld. Sanitized startup hints survive app-server disconnects, and
  quota reset advice requires stop telemetry.
- [Issue #66](https://github.com/agentic-delivery-lab/agentic-delivery/issues/66) registers issue-field masks before the controller checkout cleans `trusted-intake`, allowing intake to reach routing after the validated controller is checked out.
- [Issue #60](https://github.com/agentic-delivery-lab/agentic-delivery/issues/60) verifies migrated issue fields and option IDs against bound live IDs and requires both values to be present, so legacy-label fallbacks cannot mask failed readback.
- [Issue #60](https://github.com/agentic-delivery-lab/agentic-delivery/issues/60) makes both issue-intake jobs resolve pnpm from the nested trusted checkout manifest, so issue events can reach actor authorization and classification.
- Issue intake and delivery now read the non-sensitive GitHub App and
  installation IDs from Actions variables while keeping the App private key
  in Actions secrets.

- The issue-intake workflow installs dependencies for the validated controller
  checkout before routing, so its `yaml` import resolves from the controller's
  own workspace.

- [Issue #60](https://github.com/agentic-delivery-lab/agentic-delivery/issues/60) requires both mandatory issue-field pin targets in the versioned contract, preventing partial configuration from skipping a live pin check.
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

- [Issue #60](https://github.com/agentic-delivery-lab/agentic-delivery/issues/60) stores organization-specific issue-field and option IDs in an Actions repository secret, then masks each runtime ID separately in every consuming job before use.
- [Issue #52](https://github.com/agentic-delivery-lab/agentic-delivery/issues/52) fails closed when the central GitHub App installation ID is absent instead of relying on a stale deployment default; tests must provide the verified installation explicitly.
- [Issue #52](https://github.com/agentic-delivery-lab/agentic-delivery/issues/52) makes unscoped GitHub App installation tokens an explicit non-production test opt-in; every production token path must provide the originating or controller repository ID.
- Subscription-only delivery pauses when credit spillover is possible or credit telemetry is unavailable, in addition to the 98-percent usage boundary.
