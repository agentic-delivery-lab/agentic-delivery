# Agentic Delivery Repository Split and Organization-wide Control Plane Migration Plan

## Document status

This is the implementation-ready migration plan requested by [Issue #52](https://github.com/agentic-delivery-lab/agentic-delivery/issues/52). It defines target ownership, staged migration, validation, and rollback. It is not an architecture decision or authorization to execute migration or change organization settings. Architecture decisions become official only through merged ADR review pull requests.

Issue boundary: Issue #52 is the plan-persistence source issue. It does not authorize repository creation, organization or App setting changes, publication activation, lifecycle mutation, or migration execution. Implementation belongs to separately authorized successor issues linked with `Refs #52`, never `Closes #52`; each issue defines its own bounded scope and completion criteria.

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

The supplied main-branch snapshots establish the migration baseline:

- `agentic-delivery` at
  `8b9bd77e1cb6008ce9dab3bbe8652ab7979b4c99`;
- public `.github` at
  `58316e9bbfa48a9288e9d022266d3c8a3b52cc96`.

Those snapshots contain only the two repositories named in the original
inventory. The mixed implementation described below is the pre-extraction
baseline, not a claim that current `main` still has that repository-local
topology.

A read-only organization inventory on 2026-09-23 returns six repositories,
all with default branch `main`:

| Repository | Visibility | Current boundary |
| --- | --- | --- |
| `.github` | Public | Organization defaults and community-health surface |
| `.github-private` | Private | Member profile and agent-publication governance surface |
| `agentic-delivery` | Public | Central Control Plane |
| `agentic-delivery-architecture` | Public | Architecture Authority |
| `agentic-delivery-primitives` | Public | Canonical reusable capabilities |
| `agentic-delivery-distribution` | Public | Developer environment and consumer distribution |

The current organization repositories and their default branches were verified
with read-only GitHub CLI inspection. The organization plan was last observed
as GitHub Free. Private-repository ruleset inspection is restricted under that
plan, so the absence of an inspectable private ruleset is not treated as proof
of protection. Copilot billing metadata previously indicated a Business
configuration, but custom-agent availability, seat assignment, and supported
surface entitlement remain unverified.

The private `.github-private` repository is confirmed Private on `main`. Its
current default branch contains publication governance and provenance files,
but no `profile/README.md` or published organization agents. Its member-profile
activation pull request remains open and independently reversible. Keep the
default branch inactive for those member/Copilot surfaces until entitlement,
protection, ownership, and publication validation are reviewed.

The supplied public `.github` snapshot contains organization Issue Forms,
contribution templates, a pull-request-body workflow, a ruleset definition,
and deterministic validation. A separate read-only inspection of its current
remote `main` found nine Issue Form YAML files plus `ISSUE_TEMPLATE/config.yml`,
the public profile, `CODEOWNERS`, both governance workflows, the ruleset,
validator scripts and tests, and workflow templates. The public repository's
validator and the copy in `agentic-delivery` have different content hashes;
their behavior must be reconciled by tests rather than presumed equivalent.
Its community-health files remain the only public default inheritance source.
The split adds no inheritance behavior to `.github-private`.

The organization-level GitHub App setting was reported by the operator as
**All repositories** on 2026-09-23. That setting is not independently
verifiable through the current read-only identity. The last observable App
subscriptions omitted `issues` and the last observed permission set included
`workflows: write`; both must be rechecked with App-authorized evidence before
activation. Organization Actions settings/secrets, App installation details,
and current Copilot entitlement remain explicit evidence gates rather than
inferred absence.

This differs from the versioned `config/github-app-contract.json`, which still
declares `installation.access: selected-repositories`, lists `issues` in the
event contract, and sets `workflows: none`. Treat this as live-configuration
versus-contract drift: update the contract and App manifest only through the
approved ADR follow-up. The operator setting does not update code, and the
contract does not prove the live App configuration.

Issue #53 already exists as the successor architecture-gate issue and links to
this plan with `Refs #52`. Reuse that scoped issue for the distribution and
versioning decision after confirming that its acceptance criteria still match
the approved plan; do not create a duplicate gate issue.

### Supplied-snapshot implementation coupling

The current implementation is not an organization-wide Control Plane. It is a
repository-local implementation with some repository-generic internals.

| Concern | Current behavior |
| --- | --- |
| GitHub App registration | One App, ID `5011055`, slug `agentic-delivery-lab-invoker-7f3a` |
| App permissions | Metadata read; Contents, Issues, Pull requests, and Workflows write |
| App event subscriptions | `issue_comment`, `pull_request_review`, and `pull_request_review_comment` only |
| App installation | One organization installation, ID `163255060`; selected access was last observed on 2026-09-22 and **All repositories** was reported by the operator on 2026-09-23 |
| Effective repository access | Not independently readable: refreshed OAuth user-token requests to App-installation endpoints were rejected because App-authorized credentials are required |
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

The supplied-snapshot path is therefore:

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

### Current-main staged decoupling since the supplied snapshots

Current `main` has moved beyond the ZIP baseline. It now contains versioned
event, participant, release, App, and Primitive-selection contracts; a
repository-ID participant registry; signed dispatch/replay protection; a
central controller/origin identity boundary; and draft Architecture and
Primitive pins. All six organization repositories are present in the current
registry as `shadow` participants. Do not recreate these structures or treat
the draft release as proof of an approved production cutover.

The deterministic `pnpm acceptance:check` fixture demonstrates two repository
IDs using one controller, distinct namespaces for the same issue number,
origin-only write-back, upgrade/rollback, and `.github-private` participation
without local App credentials. Its report classifies itself as
`offline-fixture`; `liveGitHubVerification` and repository-local CI are not
proven by that check. Current live App settings also diverge from
`config/github-app-contract.json`, as noted above. Therefore Phase 0 must
reconcile this already-implemented draft with ADR-0018 and live evidence before
any further extraction, new activation, or removal of the legacy local route.

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

Before activation, an authorized owner must inspect Projects, the App
installation's effective repository access, event subscriptions, and
permissions using the GitHub UI or credentials explicitly authorized for the
App installation. A `gh auth refresh` OAuth token alone does not authorize
App-installation endpoints. Also inspect organization Actions settings and
secrets/variables, Copilot custom instructions, custom-agent policy, and any
enterprise relationship in their authoritative settings surfaces. Record
unavailable views as evidence gaps; do not infer absence.

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

The live public repository already owns the PR-body validator, its tests, and a
local `pull_request_target` workflow. Keep that validator canonical in public
`.github`, because it validates the organization contribution contract rather
than delivery lifecycle behavior. Publish a small composite Action beside the
public workflow so an opted-in consumer can call the same implementation at
an immutable `.github` commit. GitHub documents cross-repository Action
references by owner/repository/path and SHA, and exposes `github.action_path`
for scripts shipped with composite Actions ([creating a composite action](https://docs.github.com/en/actions/tutorials/create-actions/create-a-composite-action),
[Action metadata syntax](https://docs.github.com/en/actions/reference/workflows-and-actions/metadata-syntax)).
The public repository's own workflow uses its local Action; consumer workflows
are thin, explicitly installed callers. They pass only the PR author and body,
never check out or execute PR-head code, and receive no secrets or lifecycle
permissions. The Action does not enroll repositories or receive lifecycle
authority. The existing `validate-governance.yml` and
`scripts/validate-governance.mjs` also remain local checks of the
special-repository boundary; they are not thin Control Plane callers.

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

`.github-private` already exists as a private repository. Keep member-profile
and Copilot publication inactive until its effective access and available
branch/ruleset protections are verified; on the currently observed plan, do
not publish organization agents to a repository without adequate protection.
Member-profile activation and the first agent publication must be separate and
independently reversible.

## 3. Mandatory architecture decision

Use the existing ADR titled:

```text
Organization-wide Agentic Delivery control-plane distribution and versioning
```

This is ADR-0018 in the current repository. Do not create a duplicate record.
Before any content migration, onboarding, publication, or lifecycle activation,
review and amend or supersede ADR-0018 under a separately authorized successor
issue and pull request. The current ADR selects selected-repository access by
default, which conflicts with the operator-reported **All repositories**
installation setting; the successor decision must resolve this explicitly and
must keep registry enrollment as a separate authorization gate. Issue #52 is
the plan-persistence issue, not authorization to approve or implement the ADR.

During the first Architecture Authority extraction, preserve ADR-0018's history,
assign its global Architecture Authority ID, and retain a legacy alias. Migrate
ADR-0019 with history as the related Delivery State decision; do not duplicate
either rationale in arc42.

The ADR must record:

- the current repository-local implementation;
- `agentic-delivery` as the deliberate permanent Control Plane owner;
- central App webhook ingress and central lifecycle execution;
- the App organization-installation model;
- one organization installation configured for **All repositories**, as reported
  by the operator, with participant-registry enrollment as the independent
  authorization gate;
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
| Use organization-wide App installation access plus participant registry | Select |

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
2. `.github-private` — existing, private;
3. `agentic-delivery-architecture` — existing staged target, public;
4. `agentic-delivery` — existing, public, deliberately reduced to the Control
   Plane;
5. `agentic-delivery-primitives` — existing staged target, public;
6. `agentic-delivery-distribution` — existing staged target, public.

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
|   |-- actions/
|   |   `-- validate-pull-request-body/
|   |       `-- action.yml                 # canonical shared governance Action
|   `-- workflows/
|       |-- pull-request-body.yml         # local public-repo entry point
|       `-- validate-governance.yml       # local special-surface check
|-- scripts/
|   |-- validate-governance.mjs
|   `-- validate-pull-request-body.mjs    # canonical validator source
|-- tests/
|   `-- validate-pull-request-body.test.mjs
|-- workflow-templates/
|   |-- agentic-delivery-quality.yml
|   |-- agentic-delivery-quality.properties.json
|   |-- pull-request-body.yml             # optional thin caller; SHA pin required
|   `-- pull-request-body.properties.json
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
|   |-- rulesets/
|   |   `-- require-publication-review.json # versioned desired state; operator-applied
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
|-- decisions/                            # history-preserving ADR records
|   |-- README.md
|   |-- adr-template.md
|   `-- <stable-ADR-id>-<name>.md
|-- tools/
|-- tests/
|-- .github/CODEOWNERS
|-- .github/workflows/
|-- AGENTS.md
|-- README.md
|-- CHANGELOG.md
`-- package manifests
```

Architecture ADRs intentionally live in the top-level `decisions/` directory,
not in `architecture/decisions/`. The filtered history keeps source ADR paths
and URLs recognisable; `architecture/references/adr-aliases.json` maps the
historical `ADR-NNNN` names to canonical Architecture URNs. New records use
the `ADA-*` namespace in their metadata and filenames where a rename is safe;
a history-preserving import must not fabricate a new history for an existing
record.

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
2. **App installation:** one installation on `agentic-delivery-lab` configured
   for **All repositories**, as reported by the operator. This grants the App
   installation access to all current and future organization repositories;
   it does not enroll repositories or authorize mutation by itself. The
   participant registry remains the only participation gate. Confirm the
   effective setting through an App-authorized view before activation. See
   [installing a GitHub App](https://docs.github.com/en/apps/using-github-apps/installing-your-own-github-app).
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
   repository ID and the minimum permission subset for the operation. A
   participant registry record is required even when the App installation can
   access every repository; absent or disabled records fail closed.

The checked-in App contract is the starting permission ceiling, not proof of
the live registration. Keep the target permission set endpoint-driven and
minimal:

| Permission | Purpose | Boundary |
| --- | --- | --- |
| Metadata: read | Resolve repository identity and basic metadata | Always available; cannot authorize participation |
| Contents: write | Only operations that require content/dispatch writes | Installation token is limited to the controller repository for dispatch or the origin repository for approved branch writes |
| Issues: write | Approved issue/comment/type/field operations | Origin repository only; shadow mode requests read-only permissions |
| Pull requests: write | Approved PR creation or update | Origin repository only; omit on observation-only routes |
| Workflows: none | Not required for central workflow execution or pinned reusable-workflow calls | Keep `none`; Actions uses its own scoped token, and any endpoint-specific exception requires an ADR and test |
| Projects: none by default | No active Projects automation is established | Add only after the projection contract exists and official endpoint permissions are verified |

Resolve endpoint requirements against [Choosing permissions for a GitHub
App](https://docs.github.com/en/apps/creating-github-apps/registering-a-github-app/choosing-permissions-for-a-github-app)
and the endpoint-specific permission reference. Do not grant `workflows: write`
because Actions workflows exist or execute; reauthorize only the least
permission a concrete API call requires.

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
checkout uses the exact `bootstrapCommit` recorded in the controller release;
it does not follow the controller's moving `main` branch. That bootstrap code
authenticates the event, resolves the participant by repository ID, and
validates the signed controller/version pin against the participant registry.
It must not execute a payload-selected ref before that preflight succeeds. Only
then may a second checkout load the exact immutable controller commit for
intake and delivery; an invalid or duplicate invocation stops before that
checkout and before model execution. Legacy envelopes without a pin use the
current registry only as a compatibility bridge, and the resulting resolved
pin is still passed to the delivery job. Updating the bootstrap pin is an
explicit controller-release change and is tested as part of the release chain.

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
| Public governance Action | Exact `.github` commit SHA in each consumer; upgrade by reviewed caller/bundle PR |
| Primitive release | SemVer plus source commit and digest |
| Architecture release | SemVer plus source commit and digest |

Controller release manifest:

```json
{
  "version": "1.2.0",
  "commit": "<sha>",
  "contracts": {
    "eventEnvelope": "1.0.0",
    "lifecycle": "1.0.0",
    "stateMachine": "1.0.0",
    "evidence": "1.0.0"
  },
  "support": {
    "eventEnvelopeVersions": [1],
    "lifecycleVersions": ["1.0.0"],
    "stateMachineVersions": ["1.0.0"],
    "evidenceVersions": ["1.0.0"],
    "primitiveCompatibility": ["1.x"],
    "architectureCompatibility": ["1.x"],
    "minimumBootstrapVersion": "1.0.0",
    "policy": {
      "supportWindowDays": 90,
      "majorStrategy": "current-and-immediately-previous",
      "preReleaseException": "no-previous-ga-major",
      "securityRevocation": "fail-closed-with-incident"
    }
  }
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

The reference image is the attachment on [Issue #52's architecture-diagram
comment](https://github.com/agentic-delivery-lab/agentic-delivery/issues/52#issuecomment-5799402538).
The table below maps its concepts to bounded owners and records corrections
where the diagram's proposed GitHub behavior is unsupported or not verified.

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

`docToolchain/diag-agent` remains an experimental, optional adapter rather than
an architecture dependency. No pinned release, reproducible source-output
contract, or security review is currently present in the prepared checkout.
If it is piloted later, the pilot must prove deterministic local rendering,
preservation of the canonical Structurizr/PlantUML/Mermaid sources, explicit
PlantUML/Kroki network behavior, sandboxing of any external renderer, and a
reviewed immutable version before it can affect CI. External Kroki rendering is
never a required path; generated images remain disposable projections.

Use Structurizr DSL for coherent C4 views in arc42 sections 3, 5, and 7.
Use PlantUML or Mermaid for runtime views in section 6. Give each view exactly
one authoritative source format. Render locally with pinned tools; mandatory CI
must not depend on an external Kroki service.

## 14. Current-to-target artifact mapping

Paths below identify the supplied snapshot first and note a post-snapshot
current-main move when applicable. Do not mistake newer configuration paths or
staged repositories for content that existed in the supplied ZIPs.

| Supplied snapshot → current-main artifact | Target bounded context, repository, and path | Authority, GitHub behavior, and reason | Dependencies, bridge, and history |
| --- | --- | --- | --- |
| `.agents/codex-delivery.md` | Primitives / `agentic-delivery-primitives` / `agents/codex/codex-delivery.md` | Canonical reusable agent role; GitHub does not execute it directly; organization Copilot publication is a separate validated projection | Depends on released skills and capability policy; keep a compatibility adapter until CP pins the Primitive release; filter original history |
| `.agents/skills/architecture-decision/**` | Primitives / `agentic-delivery-primitives` / `skills/architecture-decision/**` | Canonical skill; not implicitly distributed by `.github` or `.github-private` | Consumes pinned Architecture ADR contract; bootstrap/plugin installs it; keep a pinned compatibility package during rollout; filter history |
| `.agents/skills/ubiquitous-language/**` | Primitives / `agentic-delivery-primitives` / `skills/ubiquitous-language/**` | Canonical reusable skill; GitHub special repos do not resolve it | Depends on Architecture terminology release; consumer installation is explicit; temporary forwarding adapter then remove; filter history |
| `.agents/skills/delivery-workflow/**` | Primitives / `agentic-delivery-primitives` / `skills/delivery-workflow/**` | Reusable workflow capability, not the lifecycle state machine | Depends on versioned CP contracts; CP composes it by Primitive ID; retain compatibility adapter until parity; filter history |
| `.agents/skills/plain-language-communication/**` | Primitives / `agentic-delivery-primitives` / `skills/plain-language-communication/**` | Canonical writing capability; organization governance does not make it a runtime dependency | Architecture owns the communication principle; bootstrap/plugin installs the skill; filter history |
| Primitive metadata comments across `.agents/**`, `scripts/**`, and `AGENTS.md` | Primitives / metadata beside each primitive; Architecture / generated traceability | Primitive implementation owns `id`, `kind`, `enforcement`, `adrs`, and `domains`; Architecture consumes metadata, never implementation | Pin metadata schema; generate traceability from released manifests; retain parsers for one compatibility window; preserve source history |
| Snapshot `.github/agent-actors.json` → current `config/agent-actors.json` | Control Plane / `agentic-delivery` / `config/agent-actors.json` | Canonical actor/invocation policy; GitHub stores actor identity but does not consume this file | Depends on App event identity and enrollment; one central versioned catalog replaces repo copies; preserve the `.github`→`config` move history |
| Snapshot `.github/issue-metadata.yml` → current `config/issue-metadata.yml` | Control Plane / `agentic-delivery` / `config/lifecycle.yml` and `config/issue-fields.yml` | Canonical schema/options and transition rules; actual Issue Type and field values remain in GitHub | Consumed by webhook, intake, mutation and tests; maintain `readiness` alias until ADR-0019 migration completes; preserve the `.github`→`config` history |
| Snapshot `.github/orchestration-policy.yml` → current `config/orchestration-policy.yml` | Control Plane / `agentic-delivery` / `config/orchestration-policy.yml` | Sole canonical pattern/profile policy; no issue state or agent copies in consumers | Selects immutable Primitive capabilities; consumers pass only bounded inputs; keep the old-path bridge until all participants upgrade; preserve move history |
| Current-main additions: `config/event-catalog.yml`, `participants.yml`, `controller-release.json`, and `schemas/**` | Control Plane / `agentic-delivery` / `config/**`, `schemas/**` | Canonical event, enrollment, release, and contract definitions; GitHub does not read them natively | App ingress and workflows validate these records; immutable release pins; retain versioned schemas and source commits; these files were not in the supplied ZIP baseline |
| `api/github/webhook.mjs` | Control Plane / `agentic-delivery` / `api/github/webhook.mjs` | Canonical App event receiver and router boundary; App webhook delivery invokes it | Depends on signed GitHub payload, installation, and registry; replace fixed repo filter, retain current endpoint during shadow; preserve history |
| Snapshot `.github/workflows/agent-invocation.yml` → current central workflow; current-main `agent-observation.yml` | Control Plane / `agentic-delivery` / `.github/workflows/**` | Central workflow entry points; GitHub runs them only in the repository hosting them, not by `.github` inheritance | App dispatches to central repository; local CI remains independent; retain local triggers until parity and exact cutover; preserve existing history; observation workflow is post-snapshot |
| `.github/workflows/issue-intake.yml` and `codex-delivery.yml` | Control Plane / `agentic-delivery` / reusable workflow and controller paths | Canonical lifecycle execution; GitHub Actions executes central jobs; consumers receive thin SHA-pinned callers only where local context is required | Depends on event envelope and participant pin; preserve the old workflow route for rollback until the active registry cutover; preserve history |
| `scripts/lib/issue-routing.mjs`, `lifecycle-transitions.mjs`, `orchestration-policy.mjs`, and associated scripts | Control Plane / `agentic-delivery` / `src/lifecycle/**` and `src/orchestration/**` | Canonical executable state machine and route authorization; issue words are not deterministic transitions | Consumes native Issue Type/fields and semantic proposal; do not copy into agents or participants; path-filter history and compatibility tests |
| `scripts/lib/github-app.mjs`, `replay-protection.mjs`, and `api/github/**` | Control Plane / `agentic-delivery` / `src/github-app/**` | Canonical App authentication and signed event boundary | Requires central secrets; installation tokens are scoped to origin ID; remove participant App secrets after cutover; preserve history |
| Repository App variables/secrets (`CODEX_DELIVERY_*`, dispatch/webhook keys) | Control Plane deployment / central Actions environment or App host | Credential values are not repository artifacts and never enter `.github-private` or consumer repos | Rotate only after central smoke evidence; remove old participant credentials after one rollback window; no historical secret values are migrated |
| `ISSUE_FIELD_BINDINGS_JSON` and organization field IDs | Control Plane / `agentic-delivery` / schema-validated organization-field binding | Binding IDs are configuration; actual values remain native GitHub fields | Requires authorized GraphQL scope; issue state stays GitHub-owned; migrate aliases without a second field; no secret material or copied values |
| `scripts/setup-runner-codex.mjs`, Codex client/session loop, and runner state | Control Plane / `agentic-delivery` / `src/runner/**` and `src/sessions/**` | Canonical execution runtime; runner/session state is operational, not durable Issue state | Key state by repository ID, issue, controller, and state-machine versions; keep resumable compatibility; preserve code history but never filter runtime state |
| `config/primitive-selection.yml` and Primitive catalog | Control Plane / `agentic-delivery` / `config/primitive-selection.yml`; source definitions in Primitives | CP selects capabilities, Primitives owns implementation; no duplicated agent source | Depends on immutable Primitive release and tool-policy version; update selection by reviewed release pin; filter source files to owning repo |
| `docs/architecture/adr-primitive-index.json` and `scripts/generate-adr-primitive-index.mjs` | Architecture / `agentic-delivery-architecture` / generated traceability index and generator | Derived index only; it is not a second manually maintained ADR/Primitive registry | Generate from Primitive manifests and Architecture ADRs; validate both pinned inputs; preserve generator/index history where practical |
| `docs/architecture/delivery-evidence.schema.json` | Control Plane / `agentic-delivery` / `schemas/delivery-evidence.v1.schema.json` | Canonical executable evidence contract; evidence links reference GitHub records rather than copying issue state | Consumed by orchestration/write-back and Architecture review; version migrations are explicit; filter with schema/tests |
| `docs/architecture/harness-review.yml` and `harness-conformance-review.md` | Architecture / `agentic-delivery-architecture` / `architecture/conformance/**` | Canonical conformance policy and human-readable review criteria | CP loads an immutable Architecture release; keep old policy as read-only bridge until pin parity; preserve history |
| Global architecture ADRs in `docs/decisions/**` | Architecture / `agentic-delivery-architecture` / `decisions/<global-id>-*.md` | Individual ADR files remain canonical; arc42 section 9 indexes them without copying rationale | Use history-preserving path filtering, stable global IDs and legacy aliases; local files remain until Architecture v1 release |
| Control Plane implementation ADRs in `docs/decisions/**` | Control Plane / `agentic-delivery` / `docs/decisions/ADCP-*.md` | Local implementation choices stay beside the runtime; not every ADR becomes global architecture | Reference global ADR URNs and immutable commits; filter history; maintain aliases for prior `ADR-NNNN` references |
| `docs/delivery/**` | Control Plane / `agentic-delivery` / `docs/operations/**` | Canonical runbooks for App, runner, upgrades, recovery, and operations | Depends on deployed release and central secret boundary; old links redirect via README during one support window; preserve history |
| `docs/domain/**` | Architecture / `agentic-delivery-architecture` / `architecture/domain/**` | Canonical bounded contexts and ubiquitous-language register | Primitives and CP consume pinned versions; old paths become link-only compatibility references after v1; preserve history |
| Current-main `automations/templates/*.automation.md` and manifest/schema | Control Plane / `agentic-delivery` / `automations/templates/**` | Canonical preview Automation definitions; local schedules, models, permissions, enablement, and run history remain client-local | Distribution emits reviewed Agent Plugin projections; no `.github-private` role; validate supported frontmatter and immutable source pins; preserve the source history that exists |
| Current-main `migration/repository-boundaries.yml` and `special-surfaces.yml` | Migration-only contracts in Control Plane until cutover; durable context map in Architecture | These files describe the extraction, not the runtime state machine; architecture context remains authoritative after migration | Convert accepted mappings into target-repo provenance/conformance manifests, then remove temporary migration ledgers after Phase 12; retain source commit maps and original Git history |
| `scripts/validate-repository-boundaries.mjs`, `validate-special-surfaces.mjs`, and `validate-extraction-source.mjs` | One-off migration validation in Control Plane; reusable Architecture conformance checks move to Architecture `tools/**` | Deterministically validate extraction, history ancestry, and special-surface paths; do not become a permanent control plane | Run before each target import; retain logs only with the implementation issue, remove migration-only scripts after all target manifests and releases are accepted; preserve history in the source repository |
| `scripts/validate-adrs.mjs`, `validate-domain-language.mjs`, and architecture review validators | Architecture / `agentic-delivery-architecture` / `tools/**` | Deterministic validators enforce Architecture-owned models and ADR structure | Run in Architecture CI and pinned CP review; migrate with fixtures and history; local callers remain read-only until parity |
| Branch, commit, changelog validators and general reusable deterministic primitive scripts | Primitives / `agentic-delivery-primitives` / `validators/**` | Reusable capability implementation; not organization special-repo defaults by itself | Consumers pin the Primitive version; bootstrap installs only approved utilities; filter history; retain old scripts as adapters until consumer migration |
| `agentic-delivery/.github/workflows/pull-request-body.yml`, `scripts/validate-pull-request-body.mjs`, and tests | Public governance / `.github` / `.github/actions/validate-pull-request-body`, `scripts/validate-pull-request-body.mjs`, and `tests/validate-pull-request-body.test.mjs` | The live public `.github` validator is canonical for the organization PR contract; its content is not assumed identical to the Control Plane copy. A public composite Action lets opted-in consumers reuse it without lifecycle permissions | Compare behavior against both fixture suites, then make the public suite authoritative. Update the Control Plane workflow and `repository-audit` test to call the immutable public Action; retain the local validator until parity and consumer checks pass, then delete only that duplicate. Keep its original commit history in `agentic-delivery`; do not fabricate a file move or include this governance check in lifecycle authorization |
| Other `tests/**` | Repository owning each tested artifact / adjacent `tests/**` | Tests move with canonical implementation, not to a central test-only repo | Cross-repo acceptance fixtures stay in CP and consume immutable test contracts; preserve path-filter history and test old/new compatibility |
| Historical `tasks/**` except this plan | Git history only | No runtime authority; only the consolidated migration plan is a current planning deliverable | Old task files are already absent from current `main`; keep their history, do not recreate or retain progress/audit logs |
| Root `AGENTS.md`, `.github/workflows/AGENTS.md`, and scoped instruction files | Split across each bounded repository in scoped `AGENTS.md` | Instructions are repository-local guidance, not a hidden control plane | Rewrite by mission, mutation limits, authorities, capabilities and validators; do not copy wholesale; preserve relevant history only |
| Current-main root `README.md` and scoped `README.md` files | Each target repository's root README, scoped to its mission | Human discovery/operations content, not GitHub special-surface behavior | Split only relevant mission content; link to canonical cross-repo docs by immutable release/reference; preserve source history where content moves |
| `CHANGELOG.md` | Control Plane / `agentic-delivery` / `CHANGELOG.md` | Curated human-facing history remains local to Control Plane; new repos keep their own changelogs | Continue Conventional Commits and curated entries; no audit dumps or generated chronology; preserve full history |
| `package.json`, `pnpm-workspace.yaml`, lockfile, and root scripts | Control Plane / reduced manifest and local workspace; each target repo gets an independent manifest | No cross-repository workspace or filesystem imports | Split packages only after API/contract tests; pin toolchains/dependencies; preserve original workspace history and use immutable release APIs |

### Public `.github` mapping

| Current/proposed artifact | Target path and authority | GitHub behavior and dependency/migration contract |
| --- | --- | --- |
| Public profile | `.github/profile/README.md`; canonical public content (already present on remote `main`) | GitHub renders publicly; retain existing content and history; no private member copy |
| Issue Forms | `.github/ISSUE_TEMPLATE/**`; canonical public community-health UX | GitHub inherits supported forms when a consumer has no local equivalent; keep IDs/types orthogonal to lifecycle; preserve current files/history |
| Pull-request template | `.github/pull_request_template.md`; canonical default contribution UX | GitHub uses it as a default if a consumer lacks a local template; consumers may override; keep `Source` and `Plan` separate |
| Pull-request-body workflow | `.github/workflows/pull-request-body.yml`; public repository's own local entry point | It invokes the canonical public governance Action; workflows are not inherited, so opted-in consumer workflows are installed explicitly and pinned to an immutable `.github` commit |
| Shared PR-body validator | `.github/actions/validate-pull-request-body/action.yml`, `scripts/validate-pull-request-body.mjs`, and `tests/validate-pull-request-body.test.mjs`; canonical public governance check | Test the supported author/body contract and injection safety in `.github`; consumer callers pass only event author/body and grant no secrets or lifecycle permissions |
| Special-surface governance workflow | `.github/workflows/validate-governance.yml` plus `scripts/validate-governance.mjs`; canonical local boundary check | Validates `.github` paths and exclusions on `.github` PRs/pushes; it is neither inherited nor a Control Plane caller |
| Ruleset definition | `.github/rulesets/require-pull-request-body.json`; desired-state governance | GitHub does not activate JSON by repository presence; an authorized maintainer applies and verifies live rules; no history rewrite |
| Workflow templates | `.github/workflow-templates/**`; starter files, not live defaults | GitHub copies templates only when a repository owner chooses them; governance Action calls pin an immutable `.github` commit, while lifecycle calls pin the Control Plane commit; no automatic synchronization |
| Other community-health files | None observed on remote `main` beyond the existing templates/forms; add a public root file only after policy approval | GitHub inheritance supports documented files only when no local equivalent exists; do not invent organization policies merely to fill the tree |
| `.github` instructions and README | `.github/AGENTS.md`, `.github/README.md`; repository-local governance | Not special GitHub-consumed paths; document ownership and override behavior; preserve relevant history |

### `.github-private` origins

There are no existing organization `.agent.md` files on its current default
branch. Do not directly copy `.agents/codex-delivery.md`; it is not a validated
GitHub Copilot custom-agent profile. Author each future Copilot agent first in
Primitives and start publication provenance at that immutable Primitive commit.

| Current/proposed artifact | Target path and authority | GitHub behavior and dependency/migration contract |
| --- | --- | --- |
| Member-only organization profile | `.github-private/profile/README.md`; canonical private member-facing content | GitHub renders for organization members only when exact repo name is Private and file is on default branch; keep activation in its own reversible PR |
| Organization custom-agent profiles | `.github-private/agents/*.agent.md`; generated/promoted projections from Primitives | GitHub Copilot consumes root `/agents` on supported org surfaces, subject to entitlement/preview; one canonical Primitive source; each projection has lock/provenance and PR-based promotion |
| Publication lock | `provenance/agents.lock.json`; generated manifest | Not directly consumed by GitHub profile resolution; validation verifies Primitive ID, agent ID, source SHA/ref, digest, ADRs, tool policy, release and compatibility; never hand-edit as a second registry |
| CODEOWNERS and publication rules | `.github/CODEOWNERS` and versioned ruleset desired state | GitHub uses CODEOWNERS only when protection requires it; actual ruleset must be separately activated and verified; protect `agents/**`, `provenance/**`, workflow, and profile owners |
| Publication validation workflow | `.github/workflows/validate-published-agents.yml`; thin SHA-pinned caller | GitHub Actions runs it only for this repository; it checks syntax/schema, secret patterns, tool/MCP allowlists, name collisions, exact source bytes/hash, and supported Copilot compatibility |
| Pull-request template | No private copy; inherit public `.github` default | GitHub default template inheritance applies; local override would create duplicated contribution UX and is excluded |
| `AGENTS.md` and README | Repository root; narrow member/publication instructions | Not GitHub special-consumed paths; document ownership, promotion, rollback and exclusions; no general private-document dump |
| Skills, hooks, plugins, MCP definitions, organization custom instructions | Excluded from `.github-private` | No assumed org-wide distribution; skills/plugins follow their separately documented Primitive/Distribution or GitHub settings mechanisms |

There is no `.github-private` source agent to history-filter. The new agent
projection starts at its actual promotion commit; the lock records the
canonical Primitive source commit and content hash. The member profile is new
content, not copied profile history.

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
| 0018 organization-wide Control Plane distribution and versioning | Global delivery-control architecture | Architecture; amend or supersede to resolve the reported All-repository installation model |
| 0019 canonicalize Delivery State | Cross-repository lifecycle architecture and governance | Architecture, with field/API migration implementation in Control Plane |

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

Required architecture decisions and ADR updates before migration:

1. review or supersede ADR-0018 to finalize the organization-wide App access,
   participation, Control Plane distribution, and versioning model; do not
   create a duplicate ADR;
2. bounded contexts, repository topology, and dependency direction;
3. ADR namespace and history migration;
4. ratify or revise ADR-0019 for Delivery State versus Delivery Readiness;
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

These phases describe the required dependency order, not permission to execute
them. Before each phase, compare current `main`, deployed behavior, and
operator evidence with its completion criteria. If a criterion is already
proven, record that evidence in the implementation issue and skip duplicate
work; do not infer completion from local draft branches or repository
existence.

### Phase 0 — Inventory, entitlement verification, and hard ADR gate

- **Prerequisites:** a separately authorized successor implementation issue
  that references the frozen plan with `Refs #52`; clean and synchronized
  `main`. Issue #52 requests the plan and does not authorize implementation.
- **Repositories:** current `agentic-delivery` and `.github`.
- **Create/change:** amend or supersede ADR-0018 to resolve the operator-
  reported All-repository App setting and explicit participation; align
  ADR-0019 and domain-language terms; finalize topology and versioning
  decisions. Do not create a duplicate ADR-0018.
- **Compatibility:** no runtime change.
- **Validate:** current tests, GitHub inventory, ADR and domain checks.
- **Rollback:** close or revert provisional ADR PR; no infrastructure changed.
- **Complete when:** ownership, enrollment, dispatch, versioning, credential,
  upgrade, and rollback decisions are official.

### Phase 1 — Establish Architecture Authority

- **Prerequisite:** Phase 0 gate.
- **Repository:** existing `agentic-delivery-architecture` target repository;
  verify its protections and staged contents before importing history.
- **Move/create:** history-filtered global ADR/domain material, official arc42
  structure, principles, schemas, tooling lock, and conformance baseline.
- **Bridge:** old architecture paths remain official until Architecture v1;
  then become read-only references.
- **Validate:** history manifest, aliases, links, model render, arc42 structure.
- **Rollback:** keep the existing Architecture target read-only, restore source
  paths as the authority, and retain target history for inspection; do not
  delete the repository or rewrite history.
- **Complete when:** immutable Architecture v1 exists.

### Phase 2 — Decouple the Control Plane inside `agentic-delivery`

- **Prerequisite:** Architecture v1.
- **Complete/verify:** participant registry, schemas, compatibility manifest,
  generic ingress, controller/target checkout separation, and repository-ID
  token scoping already present in current `main`; extend only where
  acceptance evidence identifies a gap.
- **Bridge:** current participant records remain `shadow`; retain the legacy
  local route for compatibility until the separate cutover phase.
- **Validate:** parameterized repository A/B tests, hard-coded reference scan,
  token-scope tests, state namespace tests, and the offline
  `pnpm acceptance:check` matrix.
- **Rollback:** current webhook and workflows remain available.
- **Complete when:** two repository fixtures can be processed without external
  mutation.

### Phase 3 — Central gateway and shadow execution

- **Prerequisite:** generic controller.
- **Change:** verify and complete the central gateway, signed envelope,
  dispatch authentication, replay protection, and shadow mode already present
  in current `main`; do not create a second gateway.
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

### Phase 5 — Establish Agentic Primitives

- use the existing `agentic-delivery-primitives` target repository and
  history-filter agents, skills, hooks, validators, and capability contracts
  into it;
- publish Primitive v1 with metadata, tool policy, and governing ADR references;
- point Control Plane selection manifests at the immutable release;
- compare local and released digests;
- remove local canonical copies only after parity and consumer-pin validation;
- rollback by restoring the previous exact Primitive pin while the local
  compatibility copy remains available.

### Phase 6 — Establish Distribution

- use the existing `agentic-delivery-distribution` target repository;
- implement Dev Container, Feature, bootstrap, thin workflow templates, source
  locks, and Agent Plugin packaging;
- make all adoption opt-in and PR-based;
- validate clean install, idempotency, offline/locked dependencies, and absence
  of copied lifecycle logic;
- rollback by closing the bootstrap PR or restoring the previous pin.

### Phase 7 — Onboard a second repository

Use `agentic-delivery-architecture` as the first second participant:

1. confirm the organization installation effectively has access to this
   repository; do not treat All-repository access as enrollment;
2. verify its existing shadow registry entry and repository-ID binding; do not
   duplicate the record;
3. compare event results;
4. activate the exact controller commit;
5. prove that the two repositories can use identical issue numbers without
   state collision;
6. rollback by disabling the registry record and verifying subsequent events
   fail closed; do not change organization-wide App access as a repository-
   specific rollback.

### Phase 8 — Migrate existing and future repositories

Verify or onboard in controlled order:

1. `.github` where issue/PR orchestration is useful;
2. the existing Primitives repository at its first immutable release;
3. the existing Distribution repository;
4. `.github-private` after publication ownership and protections are approved;
5. future application, platform, or documentation repositories.

For each existing repository, verify its current shadow record, effective App
access, and contract pins; do not duplicate registry records. For a future
repository, add an explicit shadow record through a reviewed PR. Use an
optional bootstrap PR, validate, activate intentionally, and retain signed
evidence. Keep repository-specific CI/CD independent.

### Phase 9 — Establish `.github-private` publication

- verify the existing repository is Private, review `main` protection and
  access, and pause publication if the GitHub plan cannot provide required
  controls;
- review baseline governance already on `main`; do not recreate it;
- keep member-profile activation in its separate, reversible PR;
- optionally enroll issue/PR orchestration without adding App credentials;
- verify Copilot entitlement before a separate first agent promotion;
- rollback publication by reverting/removing the promoted projection and its
  lock, without changing Primitive canonical content or lifecycle enrollment.

### Phase 10 — Reduce `.github`

- preserve the live public profile, Issue Forms, pull-request template,
  ruleset desired state, local governance workflow, validator, and tests;
- reconcile the public and Control Plane copies of the PR-body validator by
  running both suites against a shared fixture set;
- add a composite governance Action that invokes the public canonical
  validator; keep it free of lifecycle logic, credentials, and write
  permissions;
- change `.github`'s own pull-request-body workflow to use the local Action;
- offer an optional thin consumer workflow template and install it by reviewed
  Distribution PR only where the organization requires that check; pin the
  Action to an immutable `.github` commit and never check out PR-head code;
- retain the Control Plane's duplicate until the public Action passes parity
  and at least one real consumer check; then remove that duplicate and update
  the Control Plane's audit test without changing lifecycle behavior;
- add no profile or community-health file already present; prove inheritance
  in a repository without local overrides and prove that workflow files are
  not inherited.

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
- local PR-body workflow uses the canonical composite Action;
- composite Action contract and `github.action_path` script resolution;
- consumer-template Action references pin full immutable commit SHAs;
- callers pass event data as inputs and never execute PR-head code, receive
  secrets, or get issue-write permissions;
- ruleset JSON schema;
- community-health path/inheritance test;
- parity fixtures shared with the Control Plane copy until that copy is
  removed;
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
- optional checkout of the exact Primitive `sourceCommit` named by the lock,
  with byte-for-byte projection and release-metadata reproduction;
- provenance completeness and drift;
- member-profile lint;
- compatibility tests against actually used Copilot surfaces.
- unsupported organization-wide skill, instruction, hook, plugin, MCP, and
  alternate-agent directories are rejected from the private publication tree;
  those capabilities remain owned by Primitives or Distribution.
- the release-chain gate also validates the versioned private-publication
  ruleset desired state: default-branch targeting, required publication
  checks, code-owner review, non-fast-forward protection, and no bypass actors;
  live enforcement still requires operator verification.

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
- explicit extraction-source validation: each history map must point to the
  declared source snapshot and every old commit must be an ancestor of it;
- reusable workflows;
- explicit-root release-chain verification for Architecture, Primitives,
  Distribution, and `.github-private`, including digest and publication-ref
  reproduction using the exact pinned dependency source, including published
  agent content against the Primitive source at the pinned commit;
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
- publish the public PR-body governance Action from `.github`; install only
  reviewed, SHA-pinned thin callers where that organization check is required;
- reconcile the reported All-repository installation with the versioned App
  contract, verify effective access and event subscriptions through an
  App-authorized surface, and keep registry enrollment as the separate
  participation gate;
- add only approved App event subscriptions and permissions;
- store App credentials centrally;
- publish reusable workflows from Control Plane;
- keep `.github` public;
- verify the existing `.github-private` repository is Private and minimally
  accessible; resolve the GitHub Free protection gap or upgrade the plan before
  member/Copilot publication activation;
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
| PR-body governance check | Canonical validator and composite Action in public `.github`; optional thin caller in each opted-in repository | Public Action; consumer-owned workflow | Not inherited; pin Action SHA, pass only author/body, preserve repository CI |
| Issue-based lifecycle entry | Central App event gateway and Control Plane; thin local caller only for checks needing local Actions context | Central, version-pinned | Does not depend on `.github` workflow inheritance or PR-body Action enrollment |
| Thin workflow bootstrap | Local consumer; starter in `.github/workflow-templates` | Consumer-specific | Not inherited automatically; use a reviewed installation/update PR |
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

The current Control Plane source contains two manual, read-only pilots in
`automations/templates/`: `review-delivery-queue` and
`prepare-validation-evidence`. Their supported portable frontmatter is
validated by `pnpm automation:check`; no client-local workspace, provider,
model, permission, enabled-state, or run-history fields are admitted.

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

1. **App installation access:** verify the operator-reported All-repository
   mode and effective access using an App-authorized view or installation
   credential; the refreshed GitHub CLI OAuth token is still rejected by App
   installation endpoints.
2. **Projects:** the current GitHub CLI identity lacks `read:project`. An
   authorized owner must inventory current Projects, fields, and views and
   confirm whether the previously observed closed, empty Project #1 remains the
   only organization Project.
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

This is the dependency order, not a list of unstarted work. Current `main`
already contains draft contracts, shadow records, and offline acceptance
fixtures. Reuse them only when their evidence satisfies the gate; avoid
duplicate PRs, and do not treat draft code as production activation.

1. Revalidate Issue #53, which already references #52, as the architecture-gate
   implementation issue; do not create a duplicate issue. Freeze the plan at
   the merged commit before implementation.
2. Amend or supersede ADR-0018 to resolve the reported All-repository App
   installation and organization-wide Control Plane distribution/versioning.
3. Domain-language proposal for repository participation and controller
   releases.
4. Align ADR-0012, ADR-0014, ADR-0015, ADR-0017, and ADR-0019 with the approved
   global contracts; preserve local implementation decisions in Control Plane.
5. Architecture history-preserving import.
6. Architecture arc42, principles, contracts, and release v1.
7. Review/complete the existing Control Plane participant registry and schemas.
8. Verify the generic webhook has no fixed origin-repository assumption.
9. Verify the App token provider's origin repository-ID scope.
10. Verify controller/origin checkout separation.
11. Verify the signed envelope and replay protections.
12. Validate the existing central gateway workflow.
13. Run and close gaps from the two-repository acceptance fixtures.
14. Operator verification of the reported All-repository App installation,
    effective repository access, event subscriptions, and permissions through
    an App-authorized surface.
15. Operator approval of required event subscriptions.
16. Verify the existing `agentic-delivery` shadow enrollment.
17. Shadow parity evidence.
18. `agentic-delivery` central cutover.
19. Disable local normal intake.
20. History-preserving Primitive extraction and Primitive v1 release in the
    existing target repository.
21. Distribution bundle, thin bootstrap, Dev Container, and Feature release in
    the existing target repository.
22. Architecture App access verification, shadow enrollment, and parity.
23. Architecture active enrollment and multi-repository acceptance.
24. `.github` public governance Action and optional SHA-pinned consumer caller;
    keep it separate from central lifecycle enrollment.
25. GitHub plan/protection decision and operator verification.
26. Review current `.github-private` protections and baseline governance;
    activate no surface before that gate passes.
27. Review the existing member-profile PR separately; do not open a duplicate.
28. Optional `.github-private` issue-based enrollment without central App
    credentials.
29. First Copilot agent authoring PR in Primitives.
30. Separate `.github-private` agent-promotion PR with provenance and rollback.
31. Agent Plugin and Automation pilot.
32. Delivery State compatibility migration and field rename.
33. Projects projection.
34. Legacy config, workflow, secret, label automation, and bridge removal.

Repository creation, visibility, access, rulesets, App settings, secrets, and
organization fields are operator actions with their own issues and evidence.
Do not hide them inside content PRs.

## 28. Definition of done

The migration is complete only when deterministic evidence proves all of the
following:

- `.github` remains public and supplies the intended issue forms, PR template,
  and community-health defaults to a repository without local overrides;
- the public `.github` validator, its tests, and special-surface workflow stay
  canonical there; the PR-body Action is pinned in every opted-in consumer,
  checks only event author/body, and neither checks out PR-head code nor
  receives secrets or lifecycle write permission;
- the duplicate Control Plane PR-body validator is removed after public Action
  parity, while the Control Plane still owns lifecycle authorization;
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
- effective organization-App access and an explicit active registry record
  are both required; App access alone never enrolls or authorizes mutation;
- no production origin path is hard-coded to `agentic-delivery`;
- participants pin exact controller commits and do not silently follow `main`;
- the explicit-root release-chain check reproduces the pinned Architecture and
  Primitive digests and agrees with Distribution, Agent Plugin, and
  `.github-private` publication provenance;
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
