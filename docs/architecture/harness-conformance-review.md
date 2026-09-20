# Harness architecture conformance baseline

Evidence cutoff: 2026-09-10, implementation base `b0c34fc3b7c104fb37c51b541bf16c4020d26539`.

Source issue: [#25](https://github.com/agentic-delivery-lab/agentic-delivery/issues/25).

This baseline is an evidence review, not a claim that documentation or tests
alone prove runtime behavior. It separates declared architecture, encoded
behavior, structural checks, semantic review, observed runs, traceability and
external enforcement.

The cutoff deliberately precedes the implementation proposed in section I.
Therefore references to ten ADRs, human-readable audit entries and missing
pull-request evidence describe the reviewed `main` baseline, not the
provisional ADR-0011 and automation files added by the earlier review issue or
the provisional ADR-0012 through ADR-0015 and automation files added by source
issue #29.

## A. Executive architecture assessment

The repository has a coherent governance architecture on `main`: ten MADR
records, one registered bounded context, deterministic issue intake, a
resumable Codex controller, portable validation tooling, and review-pull-request
delivery. The strongest evidence is encoded in the Node.js controller and its
focused tests. The weakest evidence is observation: this checkout contains no
readable `CODEX_DELIVERY_STATE_DIR`, live issue or pull-request payloads,
Actions results, or historical Codex session records.

The documented architecture is therefore more complete than the demonstrated
architecture. Local code and tests show that many controls are implemented and
structurally exercised. They do not prove that a real source issue travelled
through intake, a persistent session, validation, publication and human merge.
The repository's public visibility makes the repository Rulesets API available,
but no live branch rule has been verified on this review branch. Until an
authorized maintainer activates it after merge, the branch rule remains policy
plus post-event detection rather than an external prevention control.

The current evidence supports one `agentic-delivery-governance` bounded
context. The repository has technical components, but no conflicting domain
meaning that requires a second context.

## B. ADR evidence matrix

The matrix uses `unverifiable` when the required evidence source was not
available at the cutoff. A test or document is not counted as runtime
observation.

| ADR | Architectural invariant | Expected reflection | Repository evidence | Runtime/history evidence | Contradictory evidence | Missing evidence | Enforcement level | Confidence | Conformance | ADR action |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| ADR-0001 Use MADR and GitHub Issues | ADRs are branch-local Markdown; `main` is official; issues and review PRs are linked; no status-mutating acceptance workflow | `docs/decisions/README.md`, template, architecture skill, ADR validator, issue form, PR template | `scripts/validate-adrs.mjs`; `tests/adr/validate-adrs.test.mjs`; `tests/adr/repository-contract.test.mjs`; no status field in all ten records | First-parent history has merge commits for PRs #2, #4, #6, #8, #10, #13, #14, #16, #19, #20, #22, #23, #24 and #27 | README and ADR-0001 describe protected `main`, while repository policy states GitHub Free cannot technically enforce it | GitHub branch settings, issue discussions, review approvals and merge authorization are unavailable | structural and policy; external protection unverified | moderate | partially aligned | amend wording to separate policy from prevention; keep governance model |
| ADR-0002 Plain language | Follow the reader's Dutch/English language; new repository documentation is plain English; preserve technical precision | `AGENTS.md`, plain-language skill, communication tests, Markdown review | `AGENTS.md`; `.agents/skills/plain-language-communication/SKILL.md`; `tests/communication/*` | No human feedback or issue-comment quality evidence is available | No direct contradiction found; semantic quality is not machine-proven | Conversation samples and reviewer feedback are unavailable | policy and structural | moderate | aligned for declared/encoded behavior; runtime quality unverified | keep; recurring review should cite semantic evidence limits |
| ADR-0003 Context-scoped language | One canonical register; meanings are context-scoped; missing/conflicting terms require model changes; no global forbidden-word scan | `docs/domain/*`, ubiquitous-language skill, validator, domain tests, domain-bearing artifacts | `scripts/validate-domain-language.mjs`; `tests/domain/*`; registered context and terms; agent instructions load the skill | No independent semantic review or observed delivery artifact is available | Code and docs use important unregistered terms such as architecture-review/evidence-contract concepts | Meaning review across all historical issue and session text is unavailable | structural plus semantic policy | moderate | partially aligned | amend register and review guidance with the two missing concepts; retain one context |
| ADR-0004 Trunk-based delivery | Clean synchronized `main`, short-lived feature branch, PR head-to-main base, merge commit, human merge | `AGENTS.md`, delivery skill, branch starter, history validator, quality workflow, PR template | `scripts/start-issue-branch.mjs`; `scripts/validate-main-history.mjs`; `scripts/validate-pull-request-branch.mjs`; `tests/delivery/start-issue-branch.test.mjs`; `.github/workflows/delivery-quality.yml` | Local first-parent history is merge-based through `b0c34fc`; branch age and actual human merges unavailable | GitHub settings and direct-push prevention are unverified; a post-event validator cannot prevent a push | Hosting configuration, approvals and direct-push attempts unavailable | structural and policy; external prevention unverified | moderate | partially aligned | amend confirmation to state the platform boundary explicitly |
| ADR-0005 Conventional Commits/Gitmoji | New non-merge commits and PR titles use the local Conventional Commit plus Gitmoji grammar; merge commits ignored | commitlint config, Gitmoji validator, commit-range and PR-title workflows/tests | `commitlint.config.mjs`; `scripts/validate-gitmoji.mjs`; `scripts/validate-commit-range.mjs`; workflow checks; `tests/delivery/gitmoji.test.mjs` | First-parent merge history is visible; complete PR commit ranges and title checks are not available | Historical commit `ccc0735` predates the current grammar, which is allowed; semantic intent is review-only | Actual check results and reviewer intent judgments unavailable | structural; semantic policy | strong for structure, weak for meaning | aligned structurally | keep |
| ADR-0006 Curated changelog | Root `CHANGELOG.md` has `[Unreleased]`, curated categories, no invented release; relevance is reviewed by people | changelog, validator, tests, PR template, quality workflow | `CHANGELOG.md`; `scripts/validate-changelog.mjs`; `tests/delivery/validate-changelog.test.mjs`; PR checklist | No release or human relevance review evidence available | No contradictory release/tag found locally | GitHub release settings and reviewer decisions unavailable | structural plus semantic policy | strong for structure | aligned locally; review quality unverified | keep |
| ADR-0007 Issue-linked branch names | `<type>/issue-<number>-<summary>`; open source issue check before supported branch creation and in CI | branch starter, syntax/API validators, PR workflow, tests | `scripts/start-issue-branch.mjs`; `scripts/validate-branch-name.mjs`; `scripts/validate-source-issue.mjs`; `scripts/validate-pull-request-branch.mjs`; focused tests | Current branch `feat/issue-25-codex-delivery` is concrete local evidence; remote issue state is unavailable | Raw `git switch -c` can bypass the local helper until CI; API enforcement is not externally preventive | Live issue state, PR validation results and bypass attempts unavailable | structural and policy | strong locally, moderate overall | partially aligned | keep; recurring review should report helper-versus-CI boundary |
| ADR-0008 pnpm/release age/Node.js | Exact pnpm and lockfile, 2,880-minute strict age policy, frozen ignore-scripts install, Node ESM portability, Linux runner exception | package files, toolchain preflight, validators, portability workflow/tests | `package.json`; `pnpm-workspace.yaml`; `pnpm-lock.yaml`; `scripts/validate-toolchain.mjs`; `tests/delivery/package-policy.test.mjs`; portability job | No successful install/audit/matrix run is available in this sandbox; current dependency directory is absent | Planning-time install/test attempts were blocked by unavailable dependencies and sandbox network restrictions, not a repository failure | CI matrix, registry timestamps and audit result unavailable | structural; runtime portability unobserved | moderate | partially aligned | investigate runtime observation; keep decision |
| ADR-0009 Codex issue execution/budget | Source issue controls run; Sol High plans, Luna Max implements; exact persistent session; owner continuation; 98% quota boundary; safe sandbox; human merge | workflows, controller, Codex client/loop, state, issue comments, tests, runner smoke | `.github/workflows/codex-delivery.yml`; `.agents/codex-delivery.md`; `docs/delivery/codex-workflow.md`; `scripts/codex-delivery.mjs`; `scripts/lib/codex-client.mjs`; `scripts/lib/codex-loop.mjs`; controller/client/loop tests | No state directory, audit file, Actions run, issue comments or Codex session metadata is readable | `audit.jsonl` currently stores human comment bodies rather than a typed machine evidence contract; session/tool evidence is not published to PRs | Real issue-to-PR run, usage telemetry, exact session resume, tool calls, validation repair and publication evidence unavailable | encoded and structural; runtime/traceability unverified | moderate for implementation, weak for observation | partially aligned | amend with evidence contract and observability boundary |
| ADR-0010 Deterministic intake (baseline) | Work type, lifecycle, governance and readiness are separate; only `state:ready-for-plan` authorizes delivery; non-ready work consumes no model quota | lifecycle config, issue forms, intake workflow/router, controller handoff/tests | Baseline `main` contained `.github/issue-lifecycle.yml`; `.github/workflows/issue-intake.yml`; `scripts/issue-intake.mjs`; `scripts/lib/issue-routing.mjs`; intake/routing/controller tests | No live issue event or label transition was available | Its deterministic-only intake rule is superseded by ADR-0012's validated refinement boundary | Actual issue labels, event deliveries, state transitions and run correlation were unavailable | structural and policy; runtime unverified | strong for baseline code/tests | superseded and removed provisionally by ADR-0012 | retain history in Git; do not load as active context |
| ADR-0011 Layered architecture review | Deterministic checks are the failure gate; semantic review is advisory and cites bounded evidence | review map, deterministic/semantic scripts, read-only workflow | `scripts/lib/architecture-review.mjs`; `scripts/lib/architecture-review-agent.mjs`; `.github/workflows/harness-architecture-review.yml`; architecture tests | No live review run or Codex session evidence is available | None found in the baseline | Runtime review results and human findings unavailable | deterministic plus semantic advisory | moderate | aligned for declared/encoded behavior; runtime unverified | keep and extend with generated traceability |
| ADR-0012 GitHub lifecycle control plane | GitHub owns work state; Codex proposes; deterministic transition validation gates mutations; refinement and conditional child lineage are iterative; execution failures do not advance work state | lifecycle config, transition validator, refinement schema, controller state v3, coordination | `.github/issue-lifecycle.yml`; `scripts/lib/lifecycle-transitions.mjs`; `scripts/lib/codex-loop.mjs`; `scripts/codex-delivery.mjs`; lifecycle tests | No live issue or Actions run is available | Real GitHub labels, sub-issue linkage, and parent acceptance remain unobserved | End-to-end `boe` intake and child coordination | deterministic and policy; runtime unverified | strong for structural tests | provisional and awaiting review | keep on feature branch; verify after merge |
| ADR-0013 Primitive-owned ADR traceability | Primitives reference ADRs/domains locally; reverse index is generated; required enforcement and deletion outcomes are deterministic | metadata parser, generated index, review checks | `scripts/lib/adr-traceability.mjs`; `scripts/generate-adr-primitive-index.mjs`; `docs/architecture/adr-primitive-index.json`; traceability tests | No independent index regeneration run in CI is available at the cutoff | None found in the provisional tree | PR deletion/remapping scenarios and semantic intent review | deterministic plus semantic policy | strong for local generation/tests | provisional and awaiting review | keep on feature branch; fail stale/dangling indexes |
| ADR-0014 Repository-scoped GitHub App | App tokens are short-lived and least privilege; GITHUB_TOKEN remains default where sufficient; credentials never reach model tools | App provider, workflow secrets, publication boundary | `scripts/lib/github-app.mjs`; `.github/workflows/codex-delivery.yml`; `scripts/codex-delivery.mjs`; authentication tests | App installation and token refresh are unavailable in this environment | Legacy PAT compatibility remains in controller code but is not configured by workflows | Real installation permissions, rotation, event triggering, and revocation | deterministic security boundary; runtime unverified | moderate | provisional and awaiting installation smoke test | remove compatibility fallback after operational migration if desired |
| ADR-0015 Isolated resumable runner execution | Per-issue state and per-run temporary tools/home; auth bridge is ephemeral; completion cleans sensitive execution material | controller path isolation, cleanup, state migration | `scripts/codex-delivery.mjs`; `scripts/lib/codex-client.mjs`; `docs/delivery/codex-workflow.md`; controller tests | No live runner process or retained state directory is available | Shared service login remains only as the protected source for a temporary auth bridge | Kill/retry cleanup and self-hosted smoke evidence | deterministic security boundary; runtime unverified | strong for focused tests | provisional and awaiting smoke test | keep on feature branch; inspect runner retention |

## C. Domain-model conformance review

The register, guide, skill and structural validator correctly establish one
bounded context and avoid a repository-wide forbidden-word scan. The existing
validator proves YAML shape, duplicate detection, context references and
`avoid` integrity. It does not prove that `scripts/codex-delivery.mjs`, issue
comments, ADR prose, or test names use the registered meanings.

The core registered concepts are used consistently in the controller and
delivery guide: source issue, implementation plan, delivery run, continuation
state, `awaiting-human`, Codex session, budget boundary, waiting comment
boundary, review pull request, provisional decision and official decision.
The evidence review found two durable concepts introduced by the proposed
review mechanism but absent from the register: `architecture conformance
review` and `evidence contract`. They belong to the existing bounded context.
No second bounded context is justified.

Semantic DDD evidence remains weak because live issue comments, historical
session records and an independent reviewer are unavailable. The recurring
review therefore treats register validation as structural evidence and sends
meaning questions to a separate advisory semantic pass.

## D. Issue-driven harness conformance review

The encoded baseline lifecycle is:

`source issue` → `.github/workflows/issue-intake.yml` → deterministic
classification/readiness → `codex-delivery.yml` → Sol High Plan → persistent
thread UUID → Luna Max Implement → bounded verification → recorded branch and
review pull request → human merge.

At the baseline cutoff, owner continuation was guarded by workflow and
controller payload identity, repository-owner association, saved-state lookup,
comment boundary, consumed-comment IDs and exact `thread/resume`. The
provisional source-issue change broadens this to non-bot repository writers
after deterministic permission checking and adds iterative refinement and
conditional child coordination.

The traceability chain breaks at observation and publication. `state.json` can
hold the source issue, phase, session UUID, branch, validation and PR, while
`audit.jsonl` records issue-comment bodies, but no stable machine-readable
evidence projection currently connects those fields from a pull request. The
reviewer must otherwise search runner-local state. No real run was available
to prove that the intended chain works end to end.

## E. Architecture drift and ADR lifecycle findings

- ADR-0001 and ADR-0004 should be amended to distinguish repository policy
  from the unverified live branch-protection configuration.
- ADR-0003 should be amended with the two new registered concepts and the
  structural-versus-semantic review boundary.
- ADR-0009 should be amended with the evidence contract and the fact that
  runner-local state/session detail is not independently observable unless
  projected to a review pull request.
- ADR-0010 was the deterministic intake baseline and is now superseded by
  ADR-0012. Its history remains in Git, but it must not remain active runtime
  context after the replacement is merged.
- ADR-0012 through ADR-0015 are provisional on the source-issue branch. Their
  generated primitive index and deterministic checks are structural evidence;
  real GitHub App, runner cleanup, and end-to-end issue evidence remain open.
- ADR-0002, ADR-0005, ADR-0006, ADR-0007 and ADR-0008 remain aligned locally;
  their runtime or semantic confirmation is incomplete rather than contradicted.
- No unsupported ADR `status` field, automatic acceptance workflow, duplicate
  decision or clearly superseding record was found. ADR-0011 is a successor
  decision for recurring review, not a lifecycle status mechanism.

## F. Missing architectural decisions

The significant missing decision is the observability boundary for agent-created
pull requests: which operational references are canonical in runner state,
which are projected into the pull request, and which remain logs. The proposed
ADR-0011 records the layered review mechanism and its evidence contract. A
future ADR may be needed if session storage, credentials, model selection or
runner ownership changes materially.

## G. Evidence and observability gaps

- No live issue, PR, review, Actions, state-directory, audit, session or
  telemetry evidence was readable at the cutoff.
- Unit and contract tests prove implementation shape, not real Codex behavior,
  GitHub authorization, branch protection, quota telemetry, or human merge.
- The current audit file is human-readable but not a typed operational event
  stream; raw runner state is not reachable from a PR.
- The current controller does not publish a stable source issue/session/run/
  tree/validation evidence record for architecture review.
- A validator detects an invalid direct push after the fact; it cannot prevent
  another credential holder from pushing to `main`.

## H. Continuous PR architecture-review design

The selected design is a dedicated internal `pull_request` workflow with
read-only permissions and per-PR concurrency. It loads official ADRs from the
base revision and provisional changes from the head, computes the merge-base
diff, and produces one job/check summary plus a machine-readable result.

The deterministic layer validates the impact index, ADR schema and index,
domain-register structure, branch/source-issue linkage, evidence marker
correlation, required durable-artifact relationships, and forbidden state or
permission changes. It fails only for objective violations.

The semantic layer uses a read-only GPT-5.6 Sol High turn under the existing
subscription budget and sandbox boundary. It receives only a bounded bundle
of source issue intent, ADRs, diff, domain context, deterministic results and
whitelisted runtime evidence. It must return cited findings about decision
intent, domain meaning, ADR drift, missing decisions, test quality and
traceability. Findings and inability to review are advisory/inconclusive.

The workflow does not comment, modify the PR, merge, close issues or silently
repair files. Pull-request body evidence is a controller-generated projection;
the architecture workflow only reads it. This avoids duplicate mutable state
and duplicate synchronization comments.

## I. Proposed change set

| File or area | Purpose | Invariant | Evidence kind | Priority |
| --- | --- | --- | --- | --- |
| `docs/architecture/harness-conformance-review.md` | Store this baseline and its limitations | All ADRs and evidence-quality contract | documentation | high |
| `docs/decisions/0011-run-layered-harness-architecture-reviews.md` and index | Record recurring review alternatives and choice | ADR governance, domain, delivery observability | decision | high |
| `docs/architecture/harness-review.yml` | Map ADRs/contexts to affected paths | Continuous baseline comparison | deterministic enforcement | high |
| `docs/architecture/delivery-evidence.schema.json` | Define stable evidence fields | Issue/session/run/PR traceability | observability | high |
| `scripts/codex-delivery.mjs`, `scripts/lib/codex-client.mjs`, `scripts/lib/codex-loop.mjs` | Capture safe metadata and project evidence | ADR-0009 | runtime evidence | high |
| `scripts/lib/architecture-review.mjs`, `scripts/harness-architecture-review.mjs` | Run deterministic and semantic review | ADR-0011 | deterministic/semantic review | high |
| `.github/workflows/harness-architecture-review.yml` | Trigger read-only review on internal PRs | ADR-0011 and permission boundary | deterministic/semantic review | high |
| domain, agent, delivery and PR documentation | Explain terms and reviewer contract | ADR-0002/0003/0009/0011 | documentation | high |
| `tests/architecture/**` and affected delivery tests | Prove schemas, mapping, redaction, review outcomes and workflow permissions | ADR-0011 | structural/semantic test evidence | high |
| `CHANGELOG.md` | Record the new review capability | ADR-0006 | documentation | medium |

## J. Source issue #29 implementation boundary

The source-issue branch extends this historical baseline with four provisional
decisions. `docs/architecture/adr-primitive-index.json` is derived from the
primitive-local metadata comments and is checked for exact regeneration. The
review now orders deterministic checks as ADR validity, generated traceability,
domain compatibility, required enforcement, removal outcomes, dangling
references, supersession, and minimal runtime context before its advisory
semantic pass.

The branch keeps GitHub issue type, pinned Lifecycle Stage and Delivery
Readiness fields as work metadata, with governance labels remaining orthogonal,
and stores execution failures separately. It accepts iterative refinement and
validated conditional child issues, uses a repository-scoped App for
event-producing operations, and gives each source issue an isolated resumable
state directory with per-run temporary homes, tools, and authentication
bridges. The new organization metadata and orchestration contracts are ready
for controller-owned dependency, installation, and self-hosted end-to-end
verification; they do not claim that GitHub field provisioning, App
installation, or runner retention has been observed in this sandbox.

## K. Organization metadata and orchestration evolution

The active branch replaces the baseline repository-local lifecycle file with
`.github/issue-metadata.yml` and `.github/orchestration-policy.yml`. Native
Issue Types provide durable classification; `Lifecycle Stage` and `Delivery
Readiness` are organization-level pinned fields; governance labels are
cross-cutting; and the runner retains only execution state. The policy selects
composable profiles for research, requirements, architecture, planning,
implementation, validation, and coordination from structured issue and
execution context. `docs/delivery/organization-metadata.md` records the
organization provisioning and migration boundary.

## L. Provisional conversation-driven invocation extension

ADR-0017 adds a separate activation boundary for delivery requests expressed
through GitHub conversation events. The versioned actor catalog in
`.github/agent-actors.json` defines the `@agentic-delivery-lab-invoker-7f3a` mention, the
supported issue and pull-request comment/review event pairs, repository
permissions for human actors, and a one-hop limit for allowlisted automation
actors. It does not grant the App permission to invoke itself, and the initial
external-agent allowlist is empty.

The architecture map records `agent-invocation` as a runtime surface. Its
required evidence is the immutable conversation event, invocation boundary,
actor authorization, repository dispatch, idempotency key, hop limit, and
correlated Actions run. The current baseline has structural catalog and policy
evidence but no production webhook, App installation, Vercel request, or
end-to-end Actions observation. Those runtime gaps remain explicitly
unverified until the follow-up implementation is deployed and smoke-tested.
