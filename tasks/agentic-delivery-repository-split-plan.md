# Agentic Delivery Repository Split and Organization-wide Control Plane Migration Plan

## Document status

This document is the implementation plan for
[Issue #52](https://github.com/agentic-delivery-lab/agentic-delivery/issues/52).
It is planning input, not an official architecture decision and not an active
control-plane contract. Architecture decisions become official only after their
own review pull requests are merged into `main`.

Issue boundary: Issue #52 is the plan-persistence source issue. It must not be
used as authorization to create repositories, change GitHub settings, activate
the control plane, or execute the migration. Any implementation work must use
a separately authorized successor issue that references this plan and records
the approved migration slice. This keeps the plan from silently changing the
meaning, lifecycle state, or completion criteria of the issue that requested
its persistence.

### Successor-issue handoff contract

When implementation starts, create or identify a separate issue for one
approved migration slice. That issue must:

1. use `Refs #52` (not `Closes #52`) when linking the persisted plan;
2. state the exact phase, repositories, artifact families, external changes,
   compatibility bridge, deterministic checks, rollback, and completion
   evidence in scope;
3. name the architecture decision or explicitly state why the slice is
   already covered by an approved decision;
4. state which parts are deliberately out of scope, especially repository
   creation, App installation, organization settings, `.github-private`
   activation, and lifecycle-field mutation unless separately authorized;
5. use its own issue type, lifecycle stage, delivery state/readiness, and
   pull-request closure reference; and
6. never redefine #52's completion criteria or close #52 as a side effect.

The first implementation issue should be the hard architecture gate for
organization-wide Control Plane ownership, participation, distribution, and
versioning. Later issues may implement the approved extraction slices. A
pull request for this planning issue may therefore contain only the persisted
plan and deletion of superseded task documents; implementation commits belong
to the separately authorized successor issue even when they are developed on
the same local worktree.

The source snapshots match the current default branches at these commits:

- `agentic-delivery`: `8b9bd77e1cb6008ce9dab3bbe8652ab7979b4c99`;
- `.github`: `58316e9bbfa48a9288e9d022266d3c8a3b52cc96`.

### Issue-creation safety gate

This plan can change the scope and acceptance criteria of a future
implementation issue, so the issue must not be opened from memory or from a
moving branch. Before creating the successor issue:

1. freeze this plan at an identified commit and put that commit in the issue;
2. confirm that the issue is a successor to #52 and uses `Refs #52`, never
   `Closes #52`;
3. select one bounded migration slice, name its affected repositories and
   files, and state the compatibility bridge, deterministic checks, rollback,
   and explicit exclusions;
4. include the hard organization-wide Control Plane gate when the slice can
   affect lifecycle, routing, orchestration, App ingress, workflow
   distribution, enrollment, or versioning; and
5. obtain human confirmation of any visual/reference material that cannot be
   independently retrieved by the implementation agent.

The supplied ChatGPT share URL for the reference image currently resolves to
an unauthenticated landing page for the available read-only browser, not to
the image or its conversation contents. The plan therefore records the
diagram concepts explicitly provided in the task and treats the image as
unverified evidence. No successor issue may claim that the image was fully
validated until an authorized reviewer confirms the image contents or supplies
an accessible export. This is an evidence boundary, not permission to broaden
the issue or to block the already persisted plan.

The current open issue remains #52, whose only requested outcome is plan
persistence and cleanup of superseded task documents. The local implementation
work recorded below is not authorization to alter #52, create repositories,
activate the App, change organization fields, or open a migration pull
request. The first successor issue must explicitly state whether it consumes
the image-reference confirmation or leaves that confirmation as a separate
precondition.

### Local implementation progress

The implementation branch has begun Phase 2 without activating any external
GitHub surface: enrollment, release, and App contracts live under the Control
Plane `config/` boundary, and the executable issue metadata and orchestration
contracts now live at `config/issue-metadata.yml` and
`config/orchestration-policy.yml`. This progress note records local state only;
it does not change Issue #52's scope, lifecycle, or completion criteria, and it
does not make the Control Plane active for any repository.

The locally prepared Architecture Authority and Agentic Primitives extractions
now also carry `migration/manifest.json`, a pinned `git-filter-repo` tool
identity, and a complete `migration/source-commit-map.csv`. Their repository
CI and tests validate that evidence before either target is considered for
operator publication. The central boundary manifest records Architecture,
Primitives, and Distribution as `local-prepared`; that status does not claim
that a remote repository, branch protection, or organization access exists.

The Control Plane gateway now requires both the App installation ID and the
central controller repository ID from protected deployment configuration; it
has no fallback for either identity. Draft controller `0.2.0-draft.16` at
`9e4ca88eb69a4df69067162d0fbc7100bd6cf691` pins Architecture draft
`0.1.0-draft.3` at `d4714c9489fb14824ef0967903d34a73c3e437fb` and Primitive
draft `0.1.0-draft.3` at `8d99a4a7a7240a02090ab2ac81cdb7676b8a42ad`, including
canonical content digests. Draft15 and earlier remain explicit rollback pins.
The Distribution workflow source is pinned to
`267484a7b2f1a232ce44951e70042981dad20301`, and the private publication
validator uses that same source chain. This is still local, draft, and
shadow-only; it does not activate a GitHub App or change any organization
issue.

Distribution now also validates a schema-backed capabilities lock, includes
the Primitive source in its source lock, and carries the Architecture content
digest into the consumer provenance lock. Cross-file checks reject drift
between the Primitive release, Architecture release, Control Plane release,
workflow source, and Agent Plugin projection.

The offline acceptance matrix additionally exercises `.github-private` as an
origin-event participant with an isolated issue namespace and no central App
credentials in its publication workflow. Its repository ID remains a fixture
until the private repository and App access are verified by an authorized
operator. The matrix also requires the private validator to use the central
Control Plane repository at an immutable SHA and credential-free checkouts.

The gateway contract test also dispatches an enrolled second repository through
an explicitly configured controller name and repository ID different from the
current repository, proving that the central controller identity is a
deployment contract rather than a repository-name fallback.

The offline multi-repository acceptance matrix now exercises two repositories
with the same issue number through the shared controller contract, confirms
distinct repository-ID state namespaces, runs the deterministic lifecycle
write-back contract once per originating issue, carries identity through API,
git, pull-request, and evidence projections, checks retained rollback pins,
and verifies that private publication validation receives no App credentials.
Its report is explicitly fixture evidence; live App installation, webhook
delivery, organization fields, and repository-local CI remain operator/runtime
checks.

The read-only `pnpm organization:inventory` command now captures the current
organization repository, visibility, default-branch, ruleset, workflow, open
issue/PR, label, cross-reference, and capability evidence without persisting
issue bodies or mutating GitHub. An unavailable endpoint is recorded as an
evidence gap rather than interpreted as absence. Live reports are temporary
operator evidence and are not committed as authoritative configuration.

## Executive summary

Split the mixed-responsibility `agentic-delivery` repository into six minimum
physical repositories:

| Repository | Permanent responsibility |
| --- | --- |
| `.github` | Public organization profile, community-health defaults, contribution UX, and thin workflow starters |
| `.github-private` | Private member profile and promoted organization Copilot agent projections |
| `agentic-delivery-architecture` | Single authority for domain architecture, principles, arc42, global ADRs, models, quality, risks, and conformance |
| `agentic-delivery` | Deliberately retained as the central Agentic Delivery Control Plane |
| `agentic-delivery-primitives` | Canonical reusable agents, skills, instructions, hooks, validators, capabilities, and MCP/tool contracts |
| `agentic-delivery-distribution` | Dev Container, Features, bootstrap, Agent Plugin, and thin consumer integration distribution |

The target issue-based operating model is organization-wide:

```text
GitHub App events from enrolled repositories
                    |
                    v
signed central event gateway
                    |
                    v
agentic-delivery Control Plane
                    |
                    +-- resolve repository identity and pinned controller version
                    +-- semantic proposal
                    +-- deterministic authorization
                    +-- lifecycle/orchestration execution
                    +-- evidence and write-back
                    |
                    v
originating repository

Optional repository-local workflows
                    |
                    `-- thin SHA-pinned callers for local checks only
```

The generic lifecycle, state machine, routing semantics, orchestration policy,
and governance have exactly one executable source in `agentic-delivery`.
Participating repositories do not copy that implementation.

Enrollment requires two independent conditions:

1. the organization installation of the GitHub App has access to the
   repository; and
2. a reviewed record keyed by immutable GitHub repository ID is active in the
   central participant registry.

Each participant pins an exact Control Plane commit. A change to `main` or a
new release must not silently change an existing participant's behavior.

## Hard implementation gate

> **Do not begin implementation of the repository split until the
> organization-wide control-plane ownership, participation contract,
> distribution mechanism, and versioning strategy are resolved sufficiently
> to prevent the split from reproducing repository-local orchestration.**

Satisfy this gate by approving the mandatory organization-wide Control Plane
ADR in the current repository before creating the split repositories. Move
that ADR with history into Architecture Authority during the first extraction.

## 1. Current-state assessment

### Organization and repository evidence

Read-only GitHub inspection found:

- organization `agentic-delivery-lab` is currently on GitHub Free;
- `.github` and `agentic-delivery` are public;
- `.github-private` does not exist, and the organization reports zero private
  repositories;
- both repositories use `main` as their default branch;
- `agentic-delivery` has no open pull requests and only the `main` branch;
- `.github` has four stale feature branches and no open pull requests;
- repository rulesets require `Validate pull request body` on both repositories;
- no classic branch-protection resource was returned;
- `agentic-delivery` has secret scanning and push protection enabled;
- `.github` does not currently have those security features enabled;
- the full current repository test suite passes;
- GitHub still lists a removed `adr-approval-signal` workflow registration;
- legacy `type:*` and `state:*` labels remain as migration evidence;
- project inspection is blocked by the current token's missing `read:project`
  scope.

The repeatable read-only inventory was also run on 2026-09-21 (UTC). It
observed exactly the two public repositories `agentic-delivery` and `.github`,
both on `main`, with active pull-request-body rulesets. It observed the nine
organization Issue Types and a GitHub Free organization plan. The Copilot
billing endpoint reported a Business Copilot configuration, but that does not
by itself prove custom-agent availability, seat assignment, preview access, or
the existence of a private `.github-private` repository. The current identity
could not read the App installation, organization Actions policy/secrets, or
Projects v2; each is recorded as an evidence gap rather than absence. The
inventory report is temporary live evidence and is not authoritative
configuration.

### Actual repository coupling

The current implementation is not an organization-wide Control Plane. It is a
repository-local implementation with some repository-generic internals.

| Concern | Current behavior |
| --- | --- |
| GitHub App registration | One App, ID `5011055`, slug `agentic-delivery-lab-invoker-7f3a` |
| App permissions | Metadata read; Contents, Issues, Pull requests, and Workflows write |
| App event subscriptions | `issue_comment`, `pull_request_review`, and `pull_request_review_comment` only |
| App installation | One organization installation, ID `163255060`, with selected-repository access |
| Exact selected repositories | Not readable with the current user token because `read:user` is missing |
| Webhook reception | `api/github/webhook.mjs` verifies signatures and filters invocation events |
| Webhook repository filter | Falls back to `agentic-delivery-lab/agentic-delivery` and rejects every other repository |
| Webhook handoff | Sends `repository_dispatch` back to the same repository |
| Central execution | Does not exist |
| Workflow execution | Local `agent-invocation.yml` calls local `issue-intake.yml`, which calls local `codex-delivery.yml` |
| Workflow distribution | None; all core workflows are checked into `agentic-delivery` |
| Controller checkout | Checks out `main` of the triggering repository as trusted controller code |
| Target checkout | The controller clones `GITHUB_REPOSITORY`; target and controller are currently the same repository |
| Lifecycle definitions | `.github/issue-metadata.yml` |
| Routing/orchestration definitions | `.github/orchestration-policy.yml` |
| Agent configuration | `.github/agent-actors.json` plus repository-local agents and skills |
| Issue-field bindings | Repository variable `ISSUE_FIELD_BINDINGS_JSON` |
| App identity and installation | Repository variables `CODEX_DELIVERY_APP_ID` and `CODEX_DELIVERY_APP_INSTALLATION_ID` |
| App credential | Repository secret `CODEX_DELIVERY_APP_PRIVATE_KEY` |
| Legacy publication credential | Repository secret `CODEX_DELIVERY_PUBLISH_TOKEN` still exists |
| Issue forms | Inherited from public `.github`; they are UX, not runtime control logic |
| Issue fields | Organization-native fields read and mutated with GraphQL |
| Projects automation | No active Projects runtime implementation was found |
| Execution state | Runner-local and already namespaced by repository ID and issue number |
| API mutation target | Derived from `GITHUB_REPOSITORY` in most controller code |
| Installation token scope | Permissions are narrowed, but `repository_ids` is not supplied, so a token can cover all selected repositories |

The current path is therefore:

```text
App webhook
-> fixed agentic-delivery repository check
-> repository_dispatch to agentic-delivery
-> local workflows
-> local controller checkout
-> repository-scoped variables and secrets
-> agentic-delivery mutation
```

Reusable migration foundations already exist:

- REST and GraphQL helpers accept an owner/repository input;
- event validation compares the event repository with the configured target;
- invocation envelopes already include `repository_id`;
- runner state is namespaced by repository ID and issue number;
- git, branch, issue, comment, field, and pull-request operations already use a
  selected repository value;
- tests already use generic fixtures such as `fixture/repo` and `owner/repo`.

### Work-state model and architecture drift

The live organization fields are:

- `Lifecycle Stage`: Intake, Discovery, Definition, Decision, Planning,
  Execution, Validation, Acceptance, Done, Parked;
- `Delivery Readiness`: Not ready, Needs information, Ready, Working, Waiting,
  Awaiting human, Blocked.

`Delivery Readiness` contains both readiness and active coordination states.
The recommended decision is that it represents the intended `Delivery State`
dimension under a stale name. Confirm that interpretation with an ADR before
renaming it. Readiness then becomes a derived deterministic gate, not a third
pinned field.

Preserve the separation between:

```text
native Issue Type
Lifecycle Stage
Delivery State
governance metadata
runner execution state
```

Issue Type must not become another pinned lifecycle field. Labels must not
recreate the lifecycle state machine.

### Evidence gaps

Before organization changes, an authorized owner must inspect:

```bash
gh auth refresh -s read:project -s read:user
gh project list --owner agentic-delivery-lab
gh project field-list <project-number> --owner agentic-delivery-lab
gh api /user/installations/163255060/repositories
```

The owner must also inspect organization secrets/variables, custom Copilot
instructions, custom-agent policy, selected App repositories, and any enterprise
relationship in the GitHub UI.

## 2. GitHub special-repository findings

### Public `.github`

GitHub uses a public `.github` repository for default community-health files
when a repository does not define a local equivalent. Supported issue and pull
request templates remain here. A local issue-template directory replaces the
organization issue-template set. See
[Creating a default community health file](https://docs.github.com/en/communities/setting-up-your-project-for-healthy-contributions/creating-a-default-community-health-file).

Workflows in `.github/.github/workflows` are not inherited. `workflow-templates`
offers starter files that are copied into consumers; it is not live execution
or synchronization. Ruleset JSON in the repository is desired-state evidence,
not active enforcement by itself.

Position `.github` as a public organization-governance adapter, not a runtime
repository.

### Private `.github-private`

A member-only organization profile requires a repository named exactly
`.github-private`, with Private visibility, and `profile/README.md`. Internal
visibility does not activate the feature. See
[Customizing an organization profile](https://docs.github.com/en/organizations/collaborating-with-groups-in-organizations/customizing-your-organizations-profile).

Organization Copilot custom agents can be published from root
`agents/*.agent.md` files in `.github` or `.github-private` on the default
branch. They are available to organization members even without direct
repository access, subject to current product entitlement and preview support.
See
[Preparing custom agents for an organization](https://docs.github.com/en/copilot/how-tos/administer-copilot/manage-for-organization/prepare-for-custom-agents)
and
[Custom agents configuration](https://docs.github.com/en/copilot/reference/custom-agents-configuration).

Do not infer unsupported behavior:

- `.github-private` does not distribute issue/PR templates;
- it does not distribute reusable workflows;
- it does not make skills, hooks, instructions, plugins, or MCP definitions
  organization-wide;
- organization custom instructions remain GitHub organization settings;
- enterprise managed settings require verified enterprise entitlement and
  configuration;
- it is not a secret store, runtime state store, documentation dump, or second
  control plane.

Create `.github-private` only after private-repository ruleset or branch
protection is available. On the current plan, do not publish organization
agents to an unprotected private repository. Member-profile activation and the
first agent publication must be separate and independently reversible.

## 3. Mandatory architecture decision

Create an ADR titled:

```text
Organization-wide Agentic Delivery control-plane distribution and versioning
```

Because Architecture Authority does not yet exist, first merge this ADR under
the current ADR process in `agentic-delivery`. During the first architecture
extraction, preserve its history, assign its global Architecture Authority ID,
and retain the legacy ADR alias.

The ADR must record:

- the current repository-local implementation;
- `agentic-delivery` as the deliberate permanent Control Plane owner;
- central App webhook ingress and central lifecycle execution;
- the App organization-installation model;
- selected-repository access as the default;
- the two-part participation contract;
- repository ID as primary identity;
- the signed event envelope;
- thin local workflows for repository-local checks only;
- per-participant controller version pins;
- controller, event, lifecycle, state-machine, evidence, bootstrap, and
  primitive versioning;
- onboarding, upgrades, deprecation, rollback, and credential ownership;
- compatibility guarantees and emergency security exceptions;
- coexistence with local CI/CD;
- implications for `.github` and `.github-private`;
- why Projects and client-local automation state are projections, not
  authoritative lifecycle state.

Alternatives and outcomes:

| Alternative | Outcome |
| --- | --- |
| Copy the full runtime into every repository | Reject: duplicated state machine, routing, agents, secrets, and upgrades |
| Require a thin consumer workflow for all core event intake | Reject as the primary event path: still requires local triggers everywhere |
| Execute every participant from current Control Plane `main` | Reject: silent behavior changes |
| Create one App definition per repository | Reject: GitHub does not require it and credentials multiply |
| Use `.github` as runtime | Reject: workflows are not inherited |
| Use `.github-private` as runtime | Reject: unsupported special-repository behavior and wrong boundary |
| Use App access alone as enrollment | Reject: accidental App access would activate delivery |
| Use registry alone as enrollment | Reject: the App may lack actual repository access |
| Use selected App access plus participant registry | Select |

## 4. Target bounded contexts

### Architecture Authority

- **Purpose:** provide the single architectural authority for Agentic Delivery.
- **Owns:** principles, arc42, global ADRs, bounded contexts, ubiquitous
  language, models, diagrams, quality requirements, risks, technical debt,
  ADR-to-Primitive traceability, and conformance rules.
- **Must not own:** runtime control code, GitHub work state, participant
  activation, or primitive implementation.
- **Upstream:** reviewed Git history and source issues.
- **Downstream:** Control Plane, Primitives, Distribution, publication surfaces,
  and reviewers.
- **Executable responsibility:** deterministic documentation, model, and
  conformance validation only.

### Agentic Delivery Control Plane

- **Purpose:** operate the organization-wide issue-based delivery lifecycle.
- **Owns:** App source, webhook ingress, participant registry, event catalog,
  lifecycle, routing, authorization, orchestration, reusable workflows, runner
  and session control, Projects projection, evidence, and GitHub write-back.
- **Must not own:** architecture authority, canonical reusable agents/skills,
  member profile, or application-specific CI/CD.
- **Upstream:** pinned Architecture and Primitive releases and signed GitHub
  events.
- **Downstream:** GitHub Issues, pull requests, Projects, participant
  repositories, and evidence consumers.
- **Authoritative data:** executable lifecycle and policy versions. GitHub
  Issues and fields remain the authoritative work state.

### Agentic Primitives

- **Purpose:** author reusable agent capabilities once.
- **Owns:** agents, skills, instructions, hooks, deterministic primitive
  scripts, validators, capability definitions, MCP/tool contracts, metadata,
  packaging, and releases.
- **Must not own:** organization enrollment, lifecycle fields, participant
  state, or GitHub App runtime.
- **Upstream:** Architecture identifiers and ADRs.
- **Downstream:** Control Plane, Distribution, `.github-private`, and consumer
  repositories.

### Distribution and Developer Environment

- **Purpose:** reproduce the supported developer environment and thin consumer
  integrations.
- **Owns:** Dev Container, Dev Container Features, bootstrap, Agent Plugin,
  consumer workflow templates, source locks, and distribution packages.
- **Must not own:** canonical agents or generic lifecycle implementation.
- **Upstream:** immutable Control Plane and Primitive releases.
- **Downstream:** product, service, platform, governance, and architecture
  repositories.

### Public and private GitHub adapters

`.github` and `.github-private` are GitHub-defined adapters and governance
repositories, not generic domain bounded contexts.

## 5. Target repository topology

Use these exact repositories:

1. `.github` — existing, public;
2. `.github-private` — new, private;
3. `agentic-delivery-architecture` — new, public;
4. `agentic-delivery` — existing, public, deliberately reduced to the Control
   Plane;
5. `agentic-delivery-primitives` — new, public;
6. `agentic-delivery-distribution` — new, public.

Keeping `agentic-delivery` avoids rewriting existing issue and pull-request
URLs and preserves the functioning implementation as the incremental migration
source. Its permanent ownership must be an explicit ADR outcome, not an
accidental consequence of history.

Do not create separate repositories for the GitHub App, webhooks, reusable
workflows, participant registry, state machine, Projects automation, diagrams,
architecture review, Automations, or generated publications.

## 6. Target repository trees

### `.github`

```text
.github/
|-- profile/
|   `-- README.md                         # canonical public profile
|-- .github/
|   |-- CODEOWNERS
|   |-- ISSUE_TEMPLATE/
|   |   |-- architecture-decision.yml
|   |   |-- bug.yml
|   |   |-- feature.yml
|   |   |-- idea.yml
|   |   |-- implementation.yml
|   |   |-- requirements.yml
|   |   |-- research.yml
|   |   |-- task.yml
|   |   `-- validation.yml
|   |-- pull_request_template.md
|   |-- rulesets/
|   |   `-- require-pull-request-body.json
|   `-- workflows/
|       `-- validate-governance.yml       # thin pinned caller
|-- workflow-templates/
|   |-- agentic-delivery-quality.yml
|   `-- agentic-delivery-quality.properties.json
|-- AGENTS.md
`-- README.md
```

### `.github-private`

```text
.github-private/
|-- profile/
|   `-- README.md                         # canonical member-only content
|-- agents/
|   `-- <approved-agent>.agent.md         # generated promoted projection
|-- provenance/
|   `-- agents.lock.json                  # generated publication lock
|-- .github/
|   |-- CODEOWNERS
|   `-- workflows/
|       `-- validate-published-agents.yml # thin pinned caller
|-- AGENTS.md
`-- README.md
```

Do not add a local pull-request template; inherit the public organization
template. Keep provenance outside the agent prompt and frontmatter.

### `agentic-delivery-architecture`

```text
agentic-delivery-architecture/
|-- architecture/
|   |-- arc42/
|   |   |-- 01-introduction-and-goals.arc42.md
|   |   |-- 02-architecture-constraints.arc42.md
|   |   |-- 03-context-and-scope.arc42.md
|   |   |-- 04-solution-strategy.arc42.md
|   |   |-- 05-building-block-view.arc42.md
|   |   |-- 06-runtime-view.arc42.md
|   |   |-- 07-deployment-view.arc42.md
|   |   |-- 08-cross-cutting-concepts.arc42.md
|   |   |-- 09-architecture-decisions.arc42.md
|   |   |-- 10-quality-requirements.arc42.md
|   |   |-- 11-risks-and-technical-debt.arc42.md
|   |   `-- 12-glossary.arc42.md
|   |-- principles/
|   |   |-- index.yml
|   |   `-- AP-<nnn>-<name>.md
|   |-- decisions/
|   |   |-- README.md
|   |   |-- template.md
|   |   `-- ADA-<nnnn>-<name>.md
|   |-- domain/
|   |   |-- bounded-contexts.yml
|   |   |-- context-map.yml
|   |   `-- ubiquitous-language.yml
|   |-- models/
|   |   |-- workspace.dsl
|   |   `-- uml/*.puml
|   |-- diagrams/
|   |   |-- mermaid/*.mmd
|   |   `-- generated/*.svg
|   |-- quality/quality-scenarios.yml
|   |-- risks/
|   |   |-- risks.yml
|   |   `-- technical-debt.yml
|   |-- policies/conformance.yml
|   |-- contracts/
|   |   |-- architecture-release.schema.json
|   |   |-- primitive-reference.schema.json
|   |   |-- conformance-request.schema.json
|   |   `-- conformance-result.schema.json
|   |-- generated/
|   |   |-- adr-primitive-index.json
|   |   `-- architecture-release.json
|   `-- references/
|       |-- adr-aliases.json
|       |-- source-provenance.yml
|       `-- tooling-lock.json
|-- tools/
|-- tests/
|-- .github/CODEOWNERS
|-- .github/workflows/
|-- AGENTS.md
|-- README.md
|-- CHANGELOG.md
`-- package manifests
```

### `agentic-delivery` Control Plane

```text
agentic-delivery/
|-- api/github/webhook.mjs                # thin deployment adapter
|-- config/
|   |-- organization.yml
|   |-- participants.yml                  # canonical enrollment and pins
|   |-- event-catalog.yml
|   |-- issue-fields.yml
|   |-- lifecycle.yml                     # canonical lifecycle/state machine
|   |-- routing.yml
|   |-- orchestration-policy.yml
|   |-- agent-actors.json
|   `-- compatibility.yml
|-- src/
|   |-- ingress/
|   |   |-- webhook.mjs
|   |   |-- signature.mjs
|   |   `-- envelope.mjs
|   |-- gateway/
|   |   |-- enrollment.mjs
|   |   |-- version-resolver.mjs
|   |   |-- dispatch-auth.mjs
|   |   `-- replay-protection.mjs
|   |-- lifecycle/
|   |-- routing/
|   |-- authorization/
|   |-- orchestration/
|   |-- github-app/
|   |-- github/
|   |-- runner/
|   |-- sessions/
|   |-- projects/
|   |-- evidence/
|   `-- validation/
|-- schemas/
|   |-- event-envelope.v1.schema.json
|   |-- participant-registry.v1.schema.json
|   |-- controller-release.v1.schema.json
|   |-- lifecycle.v1.schema.json
|   `-- delivery-evidence.v1.schema.json
|-- automations/templates/*.automation.md
|-- docs/
|   |-- operations/
|   |   |-- onboarding.md
|   |   |-- upgrades.md
|   |   |-- rollback.md
|   |   |-- credential-rotation.md
|   |   `-- incident-recovery.md
|   `-- decisions/ADCP-*.md
|-- .github/
|   |-- CODEOWNERS
|   |-- rulesets/
|   `-- workflows/
|       |-- control-plane-gateway.yml
|       |-- control-plane-manual-recovery.yml
|       |-- reusable-repository-quality.yml
|       |-- reusable-architecture-review.yml
|       `-- control-plane-quality.yml
|-- tests/
|   |-- contracts/
|   |-- integration/
|   `-- fixtures/repositories/
|-- AGENTS.md
|-- README.md
|-- CHANGELOG.md
`-- package manifests
```

### `agentic-delivery-primitives`

```text
agentic-delivery-primitives/
|-- agents/
|   |-- codex/codex-delivery.md
|   `-- copilot/*.agent.md
|-- skills/
|   |-- architecture-decision/
|   |-- delivery-workflow/
|   |-- plain-language-communication/
|   `-- ubiquitous-language/
|-- instructions/
|-- hooks/
|-- validators/
|   |-- repository-delivery/
|   `-- primitive-metadata/
|-- capabilities/
|   |-- catalog.yml
|   `-- tool-policy.yml
|-- mcp/contracts/
|-- schemas/
|   |-- primitive.schema.json
|   `-- primitive-release.schema.json
|-- manifests/
|   |-- primitive-catalog.yml
|   `-- primitive-release.json
|-- scripts/
|-- tests/
|-- docs/decisions/ADP-*.md
|-- .github/CODEOWNERS
|-- .github/workflows/
|-- AGENTS.md
|-- README.md
|-- CHANGELOG.md
`-- package manifests
```

### `agentic-delivery-distribution`

```text
agentic-delivery-distribution/
|-- .devcontainer/
|   |-- devcontainer.json
|   `-- Dockerfile
|-- features/src/agentic-delivery/
|   |-- devcontainer-feature.json
|   `-- install.sh
|-- bootstrap/
|   |-- src/
|   `-- templates/consumer/
|       |-- AGENTS.md
|       `-- .github/workflows/
|           |-- agentic-delivery-quality.yml
|           `-- agentic-delivery-architecture-review.yml
|-- packages/agent-plugin/
|   |-- plugin.json
|   |-- agents/                       # generated projection
|   |-- skills/                       # generated projection
|   |-- automations/                  # generated projection
|   `-- hooks/                        # generated projection
|-- manifests/
|   |-- sources.lock.json
|   |-- capabilities.lock.json
|   `-- workflow-bundle.json
|-- docs/decisions/ADD-*.md
|-- tests/onboarding/
|-- .github/CODEOWNERS
|-- .github/workflows/
|-- AGENTS.md
|-- README.md
|-- CHANGELOG.md
`-- package manifests
```

## 7. Organization-wide Control Plane design

### Separate platform concerns

1. **App registration:** one definition with the minimum organization-wide
   superset of required events and permissions.
2. **App installation:** one installation on `agentic-delivery-lab`, using
   selected-repository access by default.
3. **Webhook reception:** one ingress validates signature, organization,
   installation, event/action, repository identity, actor context, and delivery
   ID.
4. **Central execution:** only `agentic-delivery` executes generic lifecycle,
   routing, orchestration, and write-back.
5. **Workflow execution:** core orchestration is central; local workflows run
   only checks requiring local Actions context.
6. **Workflow distribution:** Distribution creates thin, immutable callers by
   reviewed PR.
7. **Configuration distribution:** generic policy stays central; only explicit,
   schema-validated domain overrides may live locally.
8. **Credential storage:** App private key, webhook secret, and dispatch-signing
   secret remain in central secret stores.
9. **Mutation:** the controller mints a short-lived token limited to the origin
   repository ID and the minimum permission subset for the operation.

### Participant registry

```yaml
schemaVersion: 1
organization: agentic-delivery-lab

repositories:
  "123456789":
    expectedFullName: agentic-delivery-lab/example-repository
    mode: shadow              # disabled | shadow | active
    controller:
      version: 1.2.0
      commit: 0123456789abcdef0123456789abcdef01234567
    contracts:
      eventEnvelope: 1
      lifecycle: 1
      stateMachine: 1
      evidence: 1
    configurationProfile: standard
    events:
      - issues
      - issue_comment
      - pull_request
      - pull_request_review
      - pull_request_review_comment
    localIntegration:
      workflowBundle: none
      managedByApp: false
```

Activation requires:

```text
valid signed App event
AND expected organization
AND App installation access
AND exact repository ID in registry
AND mode active
AND supported contract versions
AND controller release resolves to the registered commit
```

`expectedFullName` is readable verification metadata. The numeric repository ID
remains the identity across repository renames.

### Event catalog

Initial subscriptions:

- `issues`: opened, edited, reopened, typed, untyped, closed;
- `issue_comment`: created, edited;
- `pull_request`: opened, edited, synchronize, reopened, ready_for_review,
  closed;
- `pull_request_review`: submitted, edited;
- `pull_request_review_comment`: created, edited;
- `installation_repositories`: added, removed (future onboarding audit event;
  not enabled in the current issue-lifecycle contract until a dedicated
  participant-change dispatcher exists).

An event is input, not a transition. The lifecycle policy determines whether it
is ignored, observed, routed, or authorized. New issue events may enter intake.
Comments and reviews require the explicit invocation boundary when they request
agent execution. PR and workflow events remain observations until a versioned
policy gives them a specific meaning.

### Signed event envelope

```json
{
  "schemaVersion": 1,
  "deliveryId": "<GitHub delivery UUID>",
  "receivedAt": "<RFC3339>",
  "organizationId": "<numeric ID>",
  "installationId": "<numeric ID>",
  "repository": {
    "id": "<numeric ID>",
    "nodeId": "<node ID>",
    "fullName": "agentic-delivery-lab/repository",
    "defaultBranch": "main"
  },
  "event": {
    "name": "issues",
    "action": "opened",
    "objectId": "<immutable object ID>",
    "issueNumber": 123,
    "pullRequestNumber": null
  },
  "actor": {
    "id": "<numeric ID>",
    "login": "name",
    "type": "User"
  },
  "payloadDigest": "sha256:<digest>",
  "hop": 0
}
```

The ingress sends bounded metadata and signs the envelope with a separate
dispatch HMAC secret. The central gateway verifies the HMAC, timestamp,
delivery ID, and replay state. The controller fetches the current GitHub object
again before reasoning or mutation.

### Controller and target separation

Central execution uses separate directories:

```text
/controller  exact Control Plane commit from participant registry
/workspace   origin repository default branch or authorized feature branch
```

The Actions workflow is a two-stage trust boundary. Its fixed bootstrap
checkout runs the trusted controller default branch only to authenticate the
event, resolve the participant by repository ID, and validate the signed
controller/version pin against the participant registry. It must not execute a
payload-selected ref before that preflight succeeds. Only then may a second
checkout load the exact immutable controller commit for intake and delivery;
an invalid or duplicate invocation stops before that checkout and before model
execution. Legacy envelopes without a pin use the current registry only as a
compatibility bridge, and the resulting resolved pin is still passed to the
delivery job.

Replace implicit `GITHUB_REPOSITORY` coupling with explicit values:

```text
CONTROL_PLANE_REPOSITORY
ORIGIN_REPOSITORY_ID
ORIGIN_REPOSITORY
ORIGIN_DEFAULT_BRANCH
ORIGIN_INSTALLATION_ID
SOURCE_ISSUE
CONTROL_PLANE_VERSION
STATE_MACHINE_VERSION
```

The central workflow's `GITHUB_TOKEN` belongs only to `agentic-delivery`. All
origin reads and writes use a just-in-time App token scoped to exactly one
repository ID. Never pass the App private key or installation token to a model
process or untrusted repository code.

### Workflow coexistence

- Keep existing repository CI/CD, security, Dependabot, release, and deployment
  workflows independent.
- Namespace central checks with `agentic-delivery-*`.
- Add a thin caller only when local Actions execution is genuinely required.
- Pin every cross-repository workflow call to a 40-character commit SHA.
- Pass only named secrets; prohibit `secrets: inherit`.
- Give the caller explicit least-privilege permissions.
- Use concurrency keys containing repository ID and issue or PR number.
- Change required checks only in a separately reviewed repository ruleset
  operation.

## 8. Versioning, upgrades, and rollback

| Artifact | Versioning rule |
| --- | --- |
| Controller release | SemVer plus immutable Git commit |
| Participant pin | Exact 40-character commit; SemVer is descriptive |
| Event envelope | Integer major; additive changes within one major |
| Lifecycle contract | SemVer |
| State-machine contract | SemVer |
| Evidence contract | SemVer |
| Participant registry schema | Integer major |
| Thin bootstrap bundle | SemVer plus exact source SHA |
| Reusable workflow | Exact commit SHA in caller |
| Primitive release | SemVer plus source commit and digest |
| Architecture release | SemVer plus source commit and digest |

Controller release manifest:

```json
{
  "version": "1.2.0",
  "commit": "<sha>",
  "eventEnvelopeVersions": [1],
  "lifecycleVersions": ["1.0"],
  "stateMachineVersions": ["1.0"],
  "evidenceVersions": ["1.0"],
  "primitiveCompatibility": ["1.x"],
  "architectureCompatibility": ["1.x"],
  "minimumBootstrapVersion": "1.0.0"
}
```

Support the current major and the immediately preceding major for at least 90
days after the successor becomes generally available, unless published support
metadata extends that window. A critical security revocation requires an
explicit incident record and fail-closed handling.

Upgrade one participant at a time:

1. publish and verify an immutable controller release;
2. validate compatibility against all active registry entries;
3. run the participant in shadow mode on the new commit;
4. compare proposals and deterministic results without duplicate mutation;
5. update the registry through a reviewed PR;
6. activate;
7. repeat in controlled batches.

Rollback updates the participant registry to the previous exact commit.
Persist `controllerVersion` and `stateMachineVersion` with runner state. Use
expand/migrate/contract migrations and make no irreversible state or field
change while a supported old controller must still read it.

## 9. Execution patterns

The supplied architecture diagram distinguishes quick experiments from
long-running work. Preserve that intent without introducing a second lifecycle
or bypassing governance.

### Rapid-delivery pattern

Use for a PoC or small, well-bounded task:

```text
validated source issue and pinned contract
-> bounded implementation attempt
-> deterministic checks
-> semantic validation where required
-> adjust within the same authorized scope or stop
-> human-reviewed PR
```

Requirements:

- the issue has an allowed native type and valid lifecycle fields;
- the plan or pinned contract states scope, acceptance criteria, allowed
  mutations, and maximum iterations;
- every loop revalidates current GitHub state and scope digest;
- no loop skips architecture, security, dependency, or human-merge gates;
- rapid delivery is an orchestration pattern, not a separate state machine;
- a scope change exits the loop and returns to Definition, Decision, or
  Planning as appropriate.

### Long-running orchestrated pattern

Use for research-heavy or multi-stage work:

```text
orchestrator
-> parallel read-only research subruns
-> bounded evidence fan-in
-> single-writer implementer
-> independent validator
-> architecture/security review where required
-> human merge or next authorized stage
```

Requirements:

- research subruns are read-only and use explicit approved capabilities;
- each result carries source links, tool versions, scope, and confidence;
- fan-in deduplicates and bounds evidence before it enters model context;
- exactly one implementation writer owns a branch at a time;
- the validator does not reuse the implementer's mutable session;
- failed or inconclusive research does not become deterministic proof;
- the orchestrator records lineage and evidence but cannot bypass transition
  validation;
- merge remains a human-authorized operation.

The Control Plane owns both patterns. Agent roles compose Primitive releases;
agents do not embed the lifecycle state machine.

## 10. Continuous-improvement feedback loop

Make the diagram's feedback loop explicit:

```text
Issue and runtime evidence
-> classify as defect, architecture concern, risk, debt, or capability gap
-> ADR or local engineering decision when warranted
-> Control Plane, Primitive, Architecture, or Distribution change
-> deterministic and bounded semantic validation
-> immutable release with provenance
-> PR-based participant upgrade or publication promotion
-> operational evidence from the upgraded participant
-> next review cycle
```

Rules:

- runtime evidence never edits Architecture, Primitives, or participant
  configuration directly;
- Issues remain the assignment and audit record;
- ADRs remain separate reviewed records;
- derived indexes and evidence links replace manually synchronized registries;
- every rollout identifies the source issue, decision, commit, release,
  participant, and result;
- Distribution or the App opens update PRs only for repositories explicitly
  enrolled for managed bootstrap;
- no repository silently tracks a moving Control Plane, Primitive, or
  Architecture branch.

## 11. Diagram coverage and corrections

The reference image is
[`GitHub Organization Automation (Free)`](https://chatgpt.com/s/m_6ab02b51ffbc8191bed2d20b522e4673).
This plan covers its architectural intent but does not reproduce unsupported
GitHub assumptions.

| Diagram concept | Target treatment |
| --- | --- |
| Organization templates and shared standards | Public `.github` community-health files and Distribution packages |
| `.github-private` | Private member profile and Copilot agent projections only |
| Control Plane repository | `agentic-delivery`, with one generic lifecycle implementation |
| Architecture repository | Dedicated Architecture Authority with arc42, ADRs, context map, models, quality, and risks |
| GitHub App distribution | Explicit enrollment and PR-based bootstrap/update distribution |
| Work-item types | Native organization Issue Types, optionally preselected by issue forms |
| Pinned fields | Lifecycle Stage plus Delivery State after the drift ADR |
| Simplified lifecycle | Mapped to the canonical universal lifecycle below |
| PoC/quick task | Rapid-delivery pattern |
| Long-running task | Read-only research fan-out, single writer, independent validator |
| Dev Containers and Features | Distribution bounded context |
| Agent Automations | Preview templates owned by Control Plane and packaged by Distribution |
| Thin product/service/platform bootstrap | Optional local callers and configuration only |
| Issues-to-ADR-to-rollout feedback | Explicit continuous-improvement loop |

Correct these diagram assumptions:

- `.github-private` must be Private, not Internal;
- it does not provide community-health inheritance, reusable workflow
  inheritance, skill distribution, or a general policy-document location;
- `.github` workflows are not inherited;
- GitHub Free does not provide every desired protection or Copilot entitlement;
- the App must not silently install or synchronize runtime logic;
- canonical skills and agents live in Primitives, not the Control Plane;
- Issue Type is native classification, not another lifecycle field;
- Research, Requirements, Architecture, Implementation, and Validation may be
  Issue Types or routes and must not replace the universal lifecycle;
- all merges remain human-authorized.

Canonical lifecycle:

```text
Intake
-> Discovery
-> Definition
-> Decision
-> Planning
-> Execution
-> Validation
-> Acceptance
-> Done
```

Use `Parked` where appropriate. Map diagram terms as follows:

| Diagram term | Canonical representation |
| --- | --- |
| Research | Research Issue Type and/or Discovery stage |
| Requirements | Requirements Issue Type and/or Definition stage |
| Architecture / ADR | Architecture Decision Issue Type and Decision stage |
| Implementation | Implementation Issue Type and Execution stage |
| Validation | Validation Issue Type and Validation stage |
| Acceptance | Acceptance stage |

## 12. arc42 architecture design

Use the official arc42 9.0 structure from the
[arc42 template repository](https://github.com/arc42/arc42-template). Split the
official Markdown headings into twelve `*.arc42.md` files without changing
their meaning.

| Section | Content |
| --- | --- |
| 1 Introduction and Goals | Scope, stakeholders, concerns, quality goals, and repository landscape |
| 2 Architecture Constraints | GitHub special repositories, entitlements, human merge, trunk, and immutable pins |
| 3 Context and Scope | Context map; GitHub, Copilot, VS Code, runners, and participants |
| 4 Solution Strategy | Bounded contexts, central event execution, proposal/authorization split, and distribution |
| 5 Building Block View | Repositories, App, ingress, gateway, controller, runner, and adapters |
| 6 Runtime View | Intake, invocation, rapid delivery, fan-out/fan-in, promotion, upgrade, and rollback |
| 7 Deployment View | GitHub App, Vercel ingress, central Actions, runner, repositories, and developer environment |
| 8 Cross-cutting Concepts | Identity, security, provenance, versioning, evidence, state ownership, and compatibility |
| 9 Architecture Decisions | Index and context; never duplicate ADR rationale |
| 10 Quality Requirements | Concrete security, integrity, rollback, availability, and audit scenarios |
| 11 Risks and Technical Debt | Owned risk/debt register with mitigation and review dates |
| 12 Glossary | References to the machine-readable ubiquitous-language register |

Principles use stable `AP-*` identifiers. Section 9 links ADRs. Section 12 links
the terminology register. Diagrams link their model/source files. Rendered
images are never the only source.

## 13. Architecture tooling

| Tool or method | Classification | Decision |
| --- | --- | --- |
| arc42 | Canonical | Documentation structure, official version pinned |
| `@doctc/arc42` / arc42-language | Experimental supporting adapter | Pin exact `0.24.0` and integrity; advisory initially |
| MADR | Canonical | Individual ADR format |
| TOGAF-style principles | Supporting | Use statement, rationale, and implications; no compliance claim |
| ISO/IEC/IEEE 42010 terminology | Supporting | Use stakeholders, concerns, viewpoints, and views; no compliance claim |
| C4 | Supporting viewpoint strategy | Context, container, component, and deployment views |
| Structurizr DSL | Canonical C4 source | One coherent C4 model-as-code source |
| UML | Supporting | Behavioral or type detail not represented well by C4 |
| PlantUML | Canonical UML source | Sequence, state, class, and detailed deployment diagrams |
| Mermaid | Supporting | Simple local explanatory flows |
| docToolchain | Optional, initially not adopted | Add only for a concrete publishing need |
| diag-agent | Experimental, excluded from required CI | Local drafting only after security review |

The observed arc42-language CLI supports `validate`, `get`, `coverage`,
`rules`, `explain`, `guide`, `diff`, `serve`, and `build`. The assumed
`arc42 init template` and `arc42 init skill` commands do not exist in the
tested version. Plain readable Markdown remains canonical. Upgrade only through
a reviewed PR with fixture comparison.

Use Structurizr DSL for coherent C4 views in arc42 sections 3, 5, and 7.
Use PlantUML or Mermaid for runtime views in section 6. Give each view exactly
one authoritative source format. Render locally with pinned tools; mandatory CI
must not depend on an external Kroki service.

## 14. Current-to-target artifact mapping

| Current artifact or family | Target owner and path | Canonical status, bridge, and history |
| --- | --- | --- |
| `.agents/codex-delivery.md` | Primitives `agents/codex/codex-delivery.md` | Canonical Primitive; temporary local fallback; filter history |
| architecture-decision skill | Primitives `skills/architecture-decision` | Canonical reusable skill; resolve Architecture release by immutable ref |
| ubiquitous-language skill | Primitives `skills/ubiquitous-language` | Canonical reusable skill; read pinned terminology release |
| delivery-workflow skill | Primitives `skills/delivery-workflow` | Canonical reusable skill; temporary local forwarding path |
| plain-language skill | Primitives `skills/plain-language-communication` | Canonical reusable skill |
| `config/agent-actors.json` (historically `.github/agent-actors.json`) | Control Plane `config/agent-actors.json` | Canonical organization-wide invocation catalog; history-preserving move |
| `config/issue-metadata.yml` (historically `.github/issue-metadata.yml`) | Control Plane `config/lifecycle.yml` and `config/issue-fields.yml` | Canonical executable contract during the extraction bridge; future split remains versioned and must not duplicate state |
| `config/orchestration-policy.yml` (historically `.github/orchestration-policy.yml`) | Control Plane `config/orchestration-policy.yml` | Canonical executable orchestration source; history-preserving move |
| `api/github/webhook.mjs` | Control Plane ingress | Remove fixed repository; retain deployment adapter |
| `agent-invocation.yml` | Control Plane gateway | Central `repository_dispatch` target only |
| `issue-intake.yml` | Control Plane controller | Remove repository-local normal event trigger after cutover |
| `codex-delivery.yml` | Control Plane execution | Separate controller and origin checkouts |
| App token provider | Control Plane App broker | Add repository-ID scoping and operation permissions |
| repo App variables/secrets | Central protected environment | Remove from participants after cutover |
| `ISSUE_FIELD_BINDINGS_JSON` | Control Plane field lock | No per-repository duplicate |
| runner state | Control Plane runner | Preserve repository-ID/issue namespace; add contract versions |
| architecture ADR/primitive index | Architecture `generated/adr-primitive-index.json` | Derived from released Primitive manifests |
| delivery evidence schema | Control Plane `schemas/delivery-evidence.v1.schema.json` | Canonical executable evidence contract |
| architecture review policy | Architecture `policies/conformance.yml` | Canonical conformance rules |
| architecture review execution | Control Plane reusable workflow/controller | Pinned Architecture release |
| global ADRs | Architecture `decisions/ADA-*` | History-filtered; legacy aliases retained |
| local Codex/App/runner ADRs | Control Plane `docs/decisions/ADCP-*` | Repository-local engineering architecture |
| `docs/delivery/**` | Control Plane `docs/operations/**` | Operational documentation |
| `docs/domain/**` | Architecture `architecture/domain/**` | Canonical domain model; temporary old-path reference |
| ADR/domain validators | Architecture `tools/**` | Deterministic architecture validation |
| branch/commit/changelog validators | Primitives `validators/repository-delivery/**` | Reusable repository governance primitives |
| pull-request-body validator | Control Plane reusable validation | `.github` and consumers use thin callers |
| runner/preflight/sandbox/session logic | Control Plane `src/runner` and `src/sessions` | Remains central runtime |
| issue routing/transitions | Control Plane lifecycle/routing | Compatibility alias for field rename only |
| git branch/PR publication | Control Plane | Target origin with scoped App token |
| current tests | Move with the artifact under test | Preserve history with source path filters |
| historical `tasks/**` | Git history only | Superseded by this plan; no runtime responsibility |
| root `AGENTS.md` | Split scoped instructions across repositories | Do not copy wholesale |
| `CHANGELOG.md` | Remains Control Plane history | New repositories start their own changelogs |
| package/workspace files | Control Plane reduced manifest plus new repo manifests | No cross-repository relative imports |

### Public `.github` mapping

- Keep all issue forms and the pull-request template in place.
- Replace the local PR-body implementation with a thin pinned Control Plane
  caller only after fixture parity.
- Keep the ruleset JSON as desired-state evidence.
- Add a public profile only when public-facing content is approved.
- Keep `workflow-templates` explicitly documented as starter copies.

### `.github-private` origins

There are no existing organization `.agent.md` files. Do not directly copy
`.agents/codex-delivery.md`; it is not a validated GitHub Copilot custom-agent
profile. Author each future Copilot agent first in Primitives and start its
publication provenance at that Primitive commit.

## 15. ADR ownership and identifiers

Future physical ownership of current ADRs:

| ADR | Classification | Future owner |
| --- | --- | --- |
| 0001 MADR | Cross-repository governance | Architecture |
| 0002 plain language | Cross-repository governance | Architecture |
| 0003 ubiquitous language | Domain architecture | Architecture |
| 0004 trunk-based delivery | Cross-repository governance | Architecture |
| 0005 Conventional Commits and Gitmoji | Shared repository policy | Architecture |
| 0006 changelog | Shared repository policy | Architecture |
| 0007 issue-linked branches | Shared repository policy | Architecture |
| 0008 pnpm/toolchain | Repository-local engineering | Control Plane |
| 0009 Codex execution | Delivery-control architecture | Control Plane |
| 0010 | Removed/superseded | Legacy history only |
| 0011 architecture review | Domain architecture | Architecture |
| 0012 GitHub lifecycle control plane | Global domain architecture | Architecture, with local implementation ADRs in Control Plane |
| 0013 ADR/Primitive traceability | Domain and Primitive architecture | Architecture |
| 0014 repository-scoped App | Delivery-control architecture | Superseded by organization-wide ADR |
| 0015 resumable runner | Delivery-control architecture | Control Plane |
| 0016 structured PR descriptions | Organization governance | Architecture |
| 0017 invocation boundary | Global invocation architecture | Architecture, with ingress implementation in Control Plane |

Canonical ADR URN:

```text
urn:agentic-delivery:adr:<repository-key>:<number>
```

Human prefixes:

- `ADA-*` — Architecture Authority;
- `ADCP-*` — Control Plane;
- `ADP-*` — Primitives;
- `ADD-*` — Distribution;
- `ADG-*` — public organization governance;
- `ADPUB-*` — private publication.

Preserve every old `ADR-NNNN` through an alias file that resolves to exactly one
canonical ID. Never reuse an old number. Cross-repository references include
the canonical ID, repository URL, and immutable commit.

Required new ADRs before migration:

1. organization-wide Control Plane distribution and versioning;
2. bounded contexts, repository topology, and dependency direction;
3. ADR namespace and history migration;
4. Delivery State versus Delivery Readiness;
5. canonical architecture/tooling/diagram strategy;
6. cross-repository architecture conformance and pinning;
7. organization-agent ownership and `.github-private` promotion;
8. Primitive metadata, release, and capability contract;
9. Distribution, Dev Container, bootstrap, and Agent Plugin strategy;
10. preview governance for VS Code Automations.

## 16. Cross-repository contracts

Every contract has `$schema` and `schemaVersion`.

### Architecture to Primitive

`architecture-release.json` contains architecture version, source repository,
immutable commit, content digest, ADR/principle/context IDs and digests,
conformance policy, and tooling-lock digest.

Primitive metadata contains primitive ID, kind, version, enforcement,
governing ADR URNs, bounded-context IDs, source path/digest, capabilities,
tool/MCP policy version, and compatibility targets. Architecture derives its
index from released manifests and does not import Primitive implementation.

### Primitive to Control Plane

A selection manifest maps orchestration profiles to Primitive ID, version,
commit/digest, required capabilities, model/tool/MCP profile, and fallback
behavior.

### Primitive to `.github-private`

`provenance/agents.lock.json` contains, per projection:

```json
{
  "schemaVersion": "1.0",
  "primitiveId": "urn:agentic-delivery:primitive:<id>",
  "agentId": "architecture-reviewer",
  "targetPath": "agents/architecture-reviewer.agent.md",
  "sourceRepository": "agentic-delivery-lab/agentic-delivery-primitives",
  "sourceCommit": "<40-character-sha>",
  "sourceRef": "refs/tags/<release>",
  "contentSha256": "<digest>",
  "governingAdrs": ["urn:agentic-delivery:adr:<id>"],
  "toolPolicyVersion": "<version>",
  "promotionRelease": "<release-id>",
  "promotedAt": "<RFC3339>",
  "compatibilityTargets": ["github-copilot"]
}
```

The commit is mandatory; a mutable ref alone is invalid.

### Control Plane to participant

The participant record pins controller, event, lifecycle, state-machine,
evidence, Architecture, and Primitive versions. Optional local bootstrap files
pin reusable workflows by commit SHA.

### Architecture review

Request/result contracts contain affected architecture IDs, base/head commits,
exact Architecture pin, deterministic findings, semantic findings and
confidence, evidence URLs, and tool versions. Missing or mismatched pins fail
closed. Semantic reviewer unavailability is `inconclusive`, not `passed`.

## 17. Git history and traceability

Do not create empty repositories and copy files into them.

For Architecture and Primitives:

1. mirror `agentic-delivery` at the recorded source commit;
2. run a pinned `git filter-repo` version with a reviewed path and rename spec;
3. import the filtered history;
4. publish `migration/manifest.json` with source URL, source SHA, filter spec,
   tool version, and result digests;
5. publish `migration/source-commit-map.csv` because filtering changes commit
   IDs.

Keep the complete original history in `agentic-delivery`. Remove extracted
files there only after target releases and compatibility bridges exist.

`.github` keeps its own history. `.github-private` starts new history: the
member profile is new, and agent projections record their real Primitive source
commit and digest. Do not fabricate pre-publication history.

Distribution starts new unless a specific existing artifact is extracted with
its actual history.

Preserve this chain:

```text
Issue
-> ADR
-> source commit
-> pull request
-> Primitive release
-> published agent or Distribution digest
-> participant controller pin
-> workflow/runtime evidence
```

## 18. Migration phases

### Phase 0 — Inventory, entitlement verification, and hard ADR gate

- **Prerequisites:** Issue #52 or a successor implementation issue; clean and
  synchronized `main`.
- **Repositories:** current `agentic-delivery` and `.github`.
- **Create/change:** current-state inventory, organization-wide Control Plane
  ADR, domain-language proposal, topology and versioning decisions.
- **Compatibility:** no runtime change.
- **Validate:** current tests, GitHub inventory, ADR and domain checks.
- **Rollback:** close or revert provisional ADR PR; no infrastructure changed.
- **Complete when:** ownership, enrollment, dispatch, versioning, credential,
  upgrade, and rollback decisions are official.

### Phase 1 — Establish Architecture Authority

- **Prerequisite:** Phase 0 gate.
- **Repository:** new `agentic-delivery-architecture`.
- **Move/create:** history-filtered global ADR/domain material, official arc42
  structure, principles, schemas, tooling lock, and conformance baseline.
- **Bridge:** old architecture paths remain official until Architecture v1;
  then become read-only references.
- **Validate:** history manifest, aliases, links, model render, arc42 structure.
- **Rollback:** archive the new repository; current source remains intact.
- **Complete when:** immutable Architecture v1 exists.

### Phase 2 — Decouple the Control Plane inside `agentic-delivery`

- **Prerequisite:** Architecture v1.
- **Move/create:** participant registry, schemas, compatibility manifest,
  generic ingress, controller/target separation, repository-ID token scoping.
- **Bridge:** current repository remains the only active participant; existing
  workflows remain mutating.
- **Validate:** parameterized repository A/B tests, hard-coded reference scan,
  token-scope tests, state namespace tests, and the offline
  `pnpm acceptance:check` matrix.
- **Rollback:** current webhook and workflows remain available.
- **Complete when:** two repository fixtures can be processed without external
  mutation.

### Phase 3 — Central gateway and shadow execution

- **Prerequisite:** generic controller.
- **Change:** add central gateway, signed envelope, dispatch authentication,
  replay protection, and shadow participant mode.
- **Organization:** subscribe the App to the approved additional events and
  approve only required permissions.
- **Bridge:** local route remains the only mutating route; central route reads
  and compares.
- **Validate:** routing/authorization/transition parity and duplicate-event
  behavior; retain the acceptance report as fixture evidence and label live
  App/webhook evidence separately.
- **Rollback:** disable central dispatch.
- **Complete when:** shadow results match without duplicate mutation.

### Phase 4 — Cut over `agentic-delivery`

- set its participant record to active at an exact controller commit;
- disable local normal event intake;
- retain manual emergency recovery for one release window;
- validate a real issue/comment through webhook, central workflow, and origin
  mutation;
- rollback by disabling the registry entry and re-enabling the local route;
- complete when all normal issue delivery is central.

### Phase 5 — Establish Distribution

- create `agentic-delivery-distribution`;
- implement Dev Container, Feature, bootstrap, thin workflow templates, source
  locks, and Agent Plugin packaging;
- make all adoption opt-in and PR-based;
- validate clean install, idempotency, offline/locked dependencies, and absence
  of copied lifecycle logic;
- rollback by closing the bootstrap PR or restoring the previous pin.

### Phase 6 — Onboard a second repository

Use `agentic-delivery-architecture` as the first second participant:

1. grant selected App access;
2. add a shadow registry entry;
3. compare event results;
4. activate the exact controller commit;
5. prove that the two repositories can use identical issue numbers without
   state collision;
6. rollback by disabling the record and removing App access.

### Phase 7 — Migrate existing and future repositories

Onboard in controlled order:

1. `.github` where issue/PR orchestration is useful;
2. Primitives after its creation;
3. Distribution;
4. `.github-private` after its creation;
5. future application, platform, or documentation repositories.

For each: App access, registry shadow, optional bootstrap PR, validation,
activation, and signed evidence.

### Phase 8 — Establish Primitives

- history-filter agents, skills, and reusable validators;
- publish Primitive v1;
- point Control Plane selection manifests at the release;
- compare local and released digests;
- remove local canonical copies after parity.

### Phase 9 — Establish `.github-private`

- confirm private protection entitlement;
- create the exact private repository and protect `main`;
- merge baseline governance without agents;
- publish the member profile in a separate PR;
- optionally enroll issue/PR orchestration without adding App credentials;
- verify Copilot entitlement before a separate first agent promotion.

### Phase 10 — Reduce `.github`

- preserve public community-health files;
- replace local validator implementation with a thin pinned caller after
  parity;
- add public profile and workflow starters only where approved;
- prove inheritance in a repository without local overrides.

### Phase 11 — Delivery State and Projects

- approve the field-semantic ADR;
- make all supported controllers understand old and new names;
- rename the existing field in place while retaining field and option IDs;
- verify every issue type and untyped issue mapping;
- connect Projects only as a projection;
- remove the compatibility alias after all participants upgrade.

### Phase 12 — Remove compatibility bridges

After at least one complete supported release cycle with zero fallback use,
remove:

- fixed repository fallback;
- local normal intake workflows;
- participant App key/ID/installation variables;
- legacy publication PAT;
- old config paths;
- local Primitive copies;
- Delivery Readiness name alias;
- legacy type/state automation;
- architecture path stubs.

## 19. CI and deterministic validation

### `.github`

- Issue Form and YAML validation;
- pull-request-template fixtures;
- exact reusable workflow pins;
- ruleset JSON schema;
- community-health path/inheritance test;
- secret scanning.

### `.github-private`

- agent filename and `.agent.md` frontmatter/schema;
- required description and supported target;
- explicit tools; omitted or wildcard tools fail policy;
- tool and MCP allow-list;
- secret value, credential pattern, and high-entropy detection;
- duplicate agent name and filename collision detection;
- prompt length limits;
- source commit and SHA-256 verification;
- provenance completeness and drift;
- member-profile lint;
- compatibility tests against actually used Copilot surfaces.

### Architecture

- official arc42 chapter structure and coverage;
- ADR/MADR validation;
- principle, term, context, and alias uniqueness;
- JSON/YAML schema validation;
- Structurizr validation and local rendering;
- PlantUML/Mermaid local rendering;
- generated-output drift;
- broken links;
- conformance fixtures;
- advisory pinned arc42-language validation.

### Control Plane

- participant registry schema and unique IDs;
- repository rename behavior;
- disabled/shadow/active modes;
- installation mismatch;
- event/action allow-list;
- HMAC, timestamp, digest, and replay tests;
- controller tag/SHA and compatibility manifest;
- lifecycle transition matrix;
- routing proposal schema and deterministic authorization;
- webhook signature/idempotency;
- token request with exactly one repository ID;
- permission subset by operation;
- runner/session continuation and versioned state;
- Projects projection;
- evidence contract;
- reusable workflows;
- production scan for hard-coded origin repository;
- proof that central `GITHUB_TOKEN` cannot mutate origin repositories.

### Primitives

- primitive metadata and release schemas;
- ADR/context resolution against a pinned Architecture release;
- agent/skill/hook tests;
- tool/MCP policy;
- deterministic validators;
- no-secret checks;
- package and digest reproducibility;
- Copilot profile compatibility.

### Distribution

- clean Dev Container builds;
- Feature install on supported base images;
- idempotent bootstrap;
- shell/security validation;
- immutable external dependency refs;
- approved capability locks;
- Agent Plugin schema;
- generated projection drift;
- SBOM and provenance.

### Multi-repository acceptance matrix

Use at least two repositories with different repository IDs and the same issue
number. Prove:

- events reach one central gateway;
- identity remains intact in envelope, state, API calls, git remote, PR, and
  evidence;
- lifecycle fields change only on the origin issue;
- duplicate delivery in one repository does not affect another;
- participant A can remain on an older compatible controller while B upgrades;
- intentional upgrade and rollback both work;
- local CI/CD still runs independently;
- `.github-private` can participate without local App credentials;
- removal of App access or registry enrollment fails closed.

## 20. GitHub organization changes

Plan, but do not combine with repository content PRs:

- inspect and approve native Issue Types;
- retain Lifecycle Stage and resolve Delivery State/Readiness by ADR;
- inventory Projects and map fields/views as projections;
- stop writing legacy type/state labels;
- configure and verify live rulesets per repository;
- verify exact App selected repositories;
- add only approved App event subscriptions and permissions;
- store App credentials centrally;
- publish reusable workflows from Control Plane;
- keep `.github` public;
- upgrade the plan before protected `.github-private` activation;
- create `.github-private` as Private with minimal access;
- verify Copilot custom-agent availability and policy;
- keep organization custom instructions in GitHub settings;
- exclude enterprise-only managed settings without entitlement;
- remove the legacy PAT only after App-only smoke evidence;
- remove stale workflow registration and branches through separate reviewed
  operations.

## 21. `.github` versus `.github-private` responsibility matrix

| Item | Authority and GitHub resolution | Visibility/entitlement | Override behavior |
| --- | --- | --- | --- |
| Public organization profile | `.github/profile/README.md` | Public | GitHub renders publicly |
| Member-only profile | `.github-private/profile/README.md` | Private | Exact name and visibility required |
| Default community-health files | Public `.github` | Public | Local equivalent wins |
| Issue forms | `.github/.github/ISSUE_TEMPLATE` | Public | Local template directory replaces organization set |
| PR template | `.github/.github/pull_request_template.md` | Public | Local template wins |
| Thin workflow bootstrap | Local consumer; starter in `.github/workflow-templates` | Consumer-specific | Not inherited automatically |
| Organization custom agents | Canonical in Primitives; projection in `.github-private/agents` | Copilot entitlement/preview | Default-branch projection only |
| Organization custom instructions | GitHub organization settings | Supported Copilot plan | Not sourced from `.github-private` |
| Agent skills | Primitives, then bootstrap/plugin/local install | Client/repository-specific | No `.github-private` inheritance |
| Agent Plugins | Distribution release | Client compatibility | Not natively resolved from `.github-private` |
| Enterprise managed settings | Designated enterprise source | Configured enterprise only | Do not assume availability |
| Secrets/variables | GitHub environments/App/deployment secret stores | Least privilege | Never repository content |
| Runtime state | GitHub work state plus bounded runner state | Operational | Never either special repository |
| Architecture authority | Architecture repository | Public read | No special-repository role |
| Control Plane code | `agentic-delivery` | Public protected writes | No special-repository role |

## 22. Architecture review redesign

```text
changed paths
-> affected architecture identifiers
-> retrieve exact Architecture commit/release
-> verify digest and cache by SHA
-> deterministic conformance
-> read-only semantic review
-> check run and retained evidence
```

Consumers require read access only. Missing/mismatched architecture fails
closed. Semantic review failure or unavailability is cited, not treated as
deterministic proof.

For a provisional architecture and implementation pair:

1. implementation PR pins the architecture PR head SHA;
2. both PRs link a joint review record;
3. Architecture merges first;
4. implementation updates its pin to the merged Architecture commit;
5. checks rerun;
6. implementation may then receive human merge authorization.

Never use a moving Architecture `main` as unrecorded review context.

## 23. Automations and Agent Plugins

VS Code shareable Automations are preview/gradual-rollout functionality. Keep
canonical `*.automation.md` templates in Control Plane and publish reviewed
projections through Distribution. `.github-private` has no documented role.

Templates may contain the supported portable definition, including ID, name,
prompt, schedule, and schema version. They must not pretend to configure local
workspace, provider/model, permissions, enabled status, or run history. Those
remain client-local and non-authoritative.

Initial pilots:

- `review-delivery-queue`: manual, read-only summary;
- `prepare-validation-evidence`: manual, read-only evidence preparation.

Do not introduce recurring or mutating automations until an ADR, pilot, and
rollback test exist. Withdrawing a plugin does not necessarily delete a user's
already imported local automation; rollback documentation must include manual
deactivation.

## 24. Repository instructions

Every target root `AGENTS.md` defines:

- mission;
- bounded context;
- allowed mutations;
- authoritative sources;
- required skills;
- external capabilities;
- deterministic validators;
- cross-repository dependencies.

Use folder-scoped instructions only for a genuinely separate subdomain.

- Architecture instructions cover architecture content and conformance only.
- Control Plane instructions cover lifecycle runtime, participant safety,
  credentials, App boundaries, and evidence.
- Primitives instructions cover reusable capability authoring and metadata.
- Distribution instructions cover reproducibility, supply chain, bootstrap,
  and generated projections.
- `.github` instructions cover public profile and defaults.
- `.github-private` instructions cover member profile, publication,
  provenance, security, and validation.

Skills encapsulate reusable capabilities. Agents remain narrow roles composing
skills. Do not encode Control Plane state machines inside agents.

## 25. Compatibility and cutover

During shadow execution:

- the current local route is the only mutating path;
- the central route may read and compare but not write;
- both results correlate to the same delivery ID;
- differences block cutover.

At cutover:

1. activate the participant registry entry at an exact commit;
2. disable the local event trigger;
3. confirm one event creates exactly one mutating run;
4. retain manual recovery temporarily;
5. delete the local workflow only after one complete release cycle.

Central evidence records origin repository ID/full name, source issue/PR,
delivery ID, installation ID, envelope version, controller SHA, lifecycle and
state-machine version, Architecture release, Primitive release, central Actions
run, and origin mutation IDs/URLs.

Failure behavior:

- App access without registry: audit and ignore;
- registry without App access: fail closed;
- unknown contract or controller: fail closed, never fall back to `main`;
- stale full name with matching ID: reverify and require registry update;
- HMAC/digest mismatch: reject before model or Actions execution;
- unsupported event: acknowledge without route;
- origin unavailable: record execution failure, do not advance lifecycle;
- local CI failure: do not mutate lifecycle unless a versioned contract gives
  that check explicit meaning.

## 26. Risks and open decisions

Only genuine evidence gaps remain:

1. **App repository selection:** obtain `read:user` and record the exact current
   selected repositories.
2. **Projects:** obtain `read:project` and inventory actual Projects, fields,
   and views.
3. **Delivery State ADR:** confirm the recommended in-place rename or stop the
   field migration and redesign the concept.
4. **Private repository protection:** obtain GitHub Team or equivalent before
   activating `.github-private` publication.
5. **Copilot entitlement:** verify seats, custom-agent policy, preview status,
   and supported clients before publishing an agent.
6. **App GraphQL capability:** prove issue-field read/write with an installation
   token before removing the current token path. Do not add a PAT fallback.

Default visibility is public for Architecture, Control Plane, Primitives, and
Distribution. Any future confidential capability family requires a separate
decision and must not turn `.github-private` into a private monolith.

## 27. Recommended PR and operator sequence

1. Current-state evidence and migration source issue.
2. Organization-wide Control Plane distribution/versioning ADR.
3. Domain-language proposal for repository participation and controller
   releases.
4. Amend or supersede ADR-0012, ADR-0014, ADR-0015, and ADR-0017.
5. Architecture history-preserving import.
6. Architecture arc42, principles, contracts, and release v1.
7. Control Plane participant registry and schemas.
8. Generic webhook without fixed origin repository.
9. App token provider with repository-ID scope.
10. Controller/target checkout separation.
11. Signed envelope and replay protection.
12. Central gateway workflow.
13. Two-repository fixtures and compatibility tests.
14. Operator verification of selected App repositories and permissions.
15. Operator approval of required event subscriptions.
16. `agentic-delivery` shadow enrollment.
17. Shadow parity evidence.
18. `agentic-delivery` central cutover.
19. Disable local normal intake.
20. Distribution repository and thin bootstrap bundle.
21. Architecture App access and shadow enrollment.
22. Architecture active enrollment and multi-repository acceptance.
23. Primitives history-preserving import.
24. Primitive v1 release and Control Plane pin.
25. `.github` thin validation caller and optional enrollment.
26. GitHub plan/protection operator change.
27. Empty private `.github-private` creation and immediate protection.
28. `.github-private` baseline governance PR, without profile or agents.
29. Separate member-profile PR.
30. Optional `.github-private` issue-based enrollment.
31. First Copilot agent authoring PR in Primitives.
32. Separate first `.github-private` agent promotion PR.
33. Dev Container and Feature release.
34. Agent Plugin and Automation pilot.
35. Delivery State compatibility and field rename.
36. Projects projection.
37. Legacy config, workflow, secret, label automation, and bridge removal.

Repository creation, visibility, access, rulesets, App settings, secrets, and
organization fields are operator actions with their own issues and evidence.
Do not hide them inside content PRs.

## 28. Definition of done

The migration is complete only when deterministic evidence proves all of the
following:

- `.github` remains public and supplies the intended issue forms, PR template,
  and community-health defaults to a repository without local overrides;
- workflows are not described as inherited;
- `.github-private` is exactly Private, protected, and narrowly accessible;
- `.github-private/profile/README.md` renders for members and not publicly;
- an approved organization agent is discoverable on every supported Copilot
  surface in actual use;
- organization-agent availability is tested with a member who lacks direct
  repository access;
- each published agent matches its pinned Primitive content and SHA-256;
- published agents contain no credentials, implicit unrestricted tools, or
  unauthorized MCP definitions;
- publication rollback by reviewed removal/revert is tested;
- skills, hooks, custom instructions, plugins, and Automations are not
  mistakenly placed in `.github-private`;
- enterprise-only behavior is not assumed without entitlement;
- all twelve arc42 sections exist and refer to canonical ADRs, terms, and model
  sources without duplicating rationale;
- every diagram has a version-controlled, reproducibly rendered source;
- Architecture, Control Plane, and Primitives are separate bounded contexts and
  repositories;
- `agentic-delivery` contains no canonical architecture or Primitive
  implementation;
- one authoritative generic lifecycle, routing, state-machine, and
  orchestration implementation exists;
- the App organization installation serves at least two participating
  repositories;
- selected App access and registry enrollment are both required;
- no production origin path is hard-coded to `agentic-delivery`;
- participants pin exact controller commits and do not silently follow `main`;
- two repositories using the same issue number do not collide;
- repository identity is preserved through ingress, gateway, state, API, git,
  PR, and evidence;
- lifecycle transitions affect only the originating repository;
- an older compatible participant version, intentional upgrade, and rollback
  are all demonstrated;
- installation tokens are scoped to one repository ID and the minimum current
  permissions;
- no participant contains the App private key;
- `.github-private` can participate without central credentials;
- local CI/CD, security, release, and Dependabot workflows operate
  independently;
- thin workflows contain no lifecycle, routing, or agent-selection logic;
- all reusable workflow calls are SHA-pinned and do not inherit secrets;
- Issues and organization fields remain the only durable work-state authority;
- Projects remain a projection;
- Issue Type, Lifecycle Stage, Delivery State, governance metadata, and
  execution state remain distinct;
- the field migration preserves field and option IDs and issue values;
- rapid-delivery and long-running orchestration patterns use the same validated
  lifecycle and preserve human merge authority;
- the continuous-improvement loop uses issues, decisions, immutable releases,
  reviewed promotions, and evidence rather than silent synchronization;
- new repositories have history-preserving extraction evidence where source
  history existed;
- old issue and PR URLs remain valid historical references;
- all temporary path, config, controller, Primitive, and field-name bridges are
  removed;
- the legacy publish token and legacy state/type automation are removed;
- repository-specific CI, cross-repository provenance, and end-to-end lifecycle
  suites pass;
- no coding agent can merge, bypass protection, or close a source issue without
  explicit human authorization.
