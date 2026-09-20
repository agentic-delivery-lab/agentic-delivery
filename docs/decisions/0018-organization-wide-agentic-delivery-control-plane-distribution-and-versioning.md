---
date: 2026-09-20
source-issue: https://github.com/agentic-delivery-lab/agentic-delivery/issues/52
decision-makers: Repository maintainers
consulted: Official GitHub Actions, GitHub Apps, and webhook documentation
informed: None
domains:
  - agentic-delivery-control-plane
  - agentic-delivery-governance
required-enforcement:
  - deterministic
  - semantic
supersedes:
  - ADR-0014
---

# Organization-wide Agentic Delivery control-plane distribution and versioning

## Context and Problem Statement

The current implementation is a working issue-based delivery harness, but it
is coupled to `agentic-delivery-lab/agentic-delivery`. The webhook rejects
events from another repository, `repository_dispatch` targets the controller
repository, and the Actions workflows check out and mutate the same repository
that contains the controller. Repository-scoped App variables and secrets
reinforce that coupling. This prevents another organization repository from
using the same lifecycle without copying the runtime.

The repository-split plan makes an organization-wide lifecycle a hard target:
every enrolled repository may use one Agentic Delivery lifecycle, while local
CI/CD remains local. A split that moves the current assumptions into a new
repository would preserve the smell rather than solve it. The decision is
therefore required before extracting Architecture Authority, Agentic Primitives
or Distribution repositories.

The linked Issue #52 is the plan-persistence and intake record for this
repository split. It is not implementation authorization, does not define the
acceptance criteria for this ADR, and must not be closed as a side effect of
this local extraction. The ADR becomes an official implementation decision only
through a separately authorized successor issue and its review pull request.

The GitHub platform supplies several separate mechanisms, and they must not be
collapsed into one contract:

- an App registration and organization installation grant event and API access;
- webhooks deliver signed events with installation and repository identity;
- the central controller executes routing, authorization, orchestration and
  write-back;
- Actions execute workflows in a repository or call a reusable workflow;
- reusable workflows and bootstrap artifacts distribute thin integration code;
- GitHub secrets and variables hold credentials and configuration; and
- Issues, pull requests and organization fields remain the durable work-state
  authority.

The platform references for this decision are [GitHub reusable workflows](https://docs.github.com/en/actions/how-tos/reuse-automations/reuse-workflows),
[GitHub App permissions](https://docs.github.com/en/apps/creating-github-apps/registering-a-github-app/choosing-permissions-for-a-github-app),
[installation access tokens](https://docs.github.com/en/rest/apps/apps#create-an-installation-access-token-for-an-app),
and [webhook events and payloads](https://docs.github.com/en/webhooks/webhook-events-and-payloads).

## Decision Drivers

- Keep exactly one authoritative implementation of the generic lifecycle,
  semantic routing, deterministic authorization, orchestration policy and
  evidence contract.
- Preserve issue-based work while allowing the technical implementation to be
  event-driven.
- Identify the originating repository from the signed event and repository ID,
  never from a hard-coded controller repository name.
- Make participation explicit and reversible for existing and future
  repositories.
- Prevent a central release from silently changing a participant's behavior.
- Keep App credentials out of participating repositories unless a local
  operation genuinely needs them.
- Preserve repository-local CI/CD, security, Dependabot, release and validation
  workflows.
- Provide a safe shadow, upgrade and rollback path before mutation is enabled.
- Keep `.github` and `.github-private` as GitHub-defined adapters rather than
  runtime locations.

## Considered Options

- Central App webhook and controller with a selected-repository participant
  registry, plus optional thin reusable-workflow callers.
- Copy the complete lifecycle runtime into every participating repository.
- Require a thin consumer workflow in every repository as the primary event
  intake path.
- Execute every participant from the current controller `main` branch.
- Register a separate GitHub App for every repository.
- Use App installation access alone as implicit enrollment.
- Use `.github` or `.github-private` as the runtime repository.

## Decision Outcome

Chosen option: **A central App webhook and Delivery Control Plane with a
selected-repository participant registry, using thin reusable-workflow or
bootstrap integrations only where repository-local execution is needed.**

The existing `agentic-delivery` repository remains the deliberate owner of
the Delivery Control Plane during and after the split. It is not a generic
organization repository and must not remain a hub by accident. Its future
bounded context owns the App source and webhook boundary, participant
registry, event envelope, lifecycle and transition contracts, semantic routing,
deterministic authorization, orchestration policy, reusable workflows, runner
and session control, GitHub Projects projection, evidence and controlled
write-back.

### Organization-wide App installation

One GitHub App definition serves the organization. Its installation uses
selected-repository access by default and subscribes only to the event types
required by the versioned event catalog. Adding a repository to the App's
selected access is necessary but not sufficient for participation. The App
private key remains only in the central deployment or central workflow secret
boundary. Installation tokens are minted just in time and narrowed to the
originating repository ID when the controller reads or mutates that repository.

The App source is part of the Delivery Control Plane; a second App repository
is not created. The organization owner must separately verify the live App
registration, installation repository selection, event subscriptions and
least-privilege permissions before activation.

### Participation contract

Participation is the conjunction of two independently auditable conditions:

1. the organization App installation has access to the exact numeric
   repository ID; and
2. the central `participants.yml` registry contains that repository ID with
   `mode: shadow` or `mode: active`, an expected full name, a controller
   release commit, supported event/lifecycle/state-machine/evidence contract
   versions, and a declared local integration profile.

The repository ID is the primary identity and survives a rename. The full name
is a verification value, not an identity key. App access without a registry
entry does not activate delivery; a registry entry without App access fails
closed. Enrollment and mode changes are reviewed pull requests in the Control
Plane, not side effects of an arbitrary repository workflow or Project field.

### Event and execution boundary

The App webhook verifies the signature, installation, organization, supported
event/action, delivery ID and repository identity. It emits a signed,
versioned event envelope to the central controller. The controller fetches the
current GitHub object again, resolves the participant's pinned controller and
contract versions, asks the semantic router for a proposal, and applies only
deterministically authorized mutations to the originating repository.

An event is input, not a lifecycle transition. The lifecycle policy decides
whether an issue, comment, pull request, review, workflow or Project event is
ignored, observed, routed or authorized. Conversation-driven execution still
requires the explicit invocation boundary from ADR-0017. Repository identity,
issue number, delivery ID, source revision and controller version are carried
through orchestration and evidence.

The central workflow's `GITHUB_TOKEN` is used only for the controller
repository. Origin reads and writes use a just-in-time App installation token
scoped to the originating repository. The App private key and installation
tokens are never passed to Codex, a primitive, a model process or untrusted
consumer-repository code.

When a participant needs Actions execution in its own repository, it receives a
thin caller or bootstrap bundle. The caller pins the reusable workflow to an
immutable commit SHA, passes named inputs and secrets only, and owns no copy of
the lifecycle, routing or agent definitions. `secrets: inherit` is prohibited.
Local CI/CD and security workflows remain independent; central checks use a
distinct `agentic-delivery-*` namespace and do not assume ownership of all
workflow files.

### Versioning and compatibility

The controller release is SemVer plus an immutable Git commit. Each participant
stores the exact controller commit and compatible contract versions in the
registry. Event envelopes use an integer major with additive changes within a
major. Lifecycle, state-machine and evidence contracts use SemVer. Reusable
workflow callers and bootstrap bundles use SemVer plus an exact source SHA.
Primitive and Architecture dependencies use a release version, source commit
and content digest.

The controller publishes a release manifest containing supported event,
lifecycle, state-machine, evidence, primitive, Architecture and minimum
bootstrap versions. It supports the current major and immediately preceding
major for at least 90 days after a successor is generally available unless the
published support policy extends that window. Incompatible changes require an
expand/migrate/contract migration and a reviewed participant update; they may
not be hidden behind a mutable `main` reference. A critical security revocation
may fail closed through an incident record and explicit registry changes.

An upgrade publishes and validates an immutable release, evaluates every
active participant, runs the new version in shadow mode, compares proposals and
deterministic results without duplicate mutation, then updates participants one
at a time through reviewed registry changes. Rollback restores the previous
exact commit and contract versions. Runner state records the controller and
state-machine versions so a resume cannot silently cross an incompatible
boundary. An existing participant may remain on an older supported version
until its intentional upgrade window or the support policy's end date.

### Consequences

- Good, because one implementation serves all enrolled repositories without
  copying the lifecycle or secrets.
- Good, because repository identity and authorization remain explicit from
  webhook ingress through write-back and evidence.
- Good, because enrollment, upgrades and rollback are reviewable and
  independently reversible.
- Good, because repository-local workflows can continue without central
  ownership of their files.
- Bad, because the organization needs a central registry, release manifests,
  shadow execution, App operations and cross-repository contract tests.
- Bad, because App permissions and central credential storage become shared
  infrastructure that requires careful operational ownership.
- Neutral, because a small thin bootstrap may still be present in a consumer,
  but it is an adapter rather than a second control plane.

### Confirmation

Deterministic tests and an operator smoke run must prove:

- events from two different repositories enter one controller and retain their
  repository IDs through routing, execution and evidence;
- a repository not present in the registry is rejected even when App access is
  present, and a registry entry without App access fails closed;
- lifecycle transitions mutate the originating repository only;
- no generic controller path depends on the literal name
  `agentic-delivery`;
- installation-token requests are narrowed to the origin repository and the
  App permissions are sufficient but minimal;
- a new repository can enroll with the documented two-part contract;
- an older supported participant can remain pinned while another participant
  upgrades;
- a deliberate upgrade and exact-commit rollback work without duplicate
  mutation;
- `.github-private` events can participate without receiving the central App
  private key; and
- participant-local CI/CD remains independently executable.

## Pros and Cons of the Options

### Central App and controller with registry (chosen)

- Good, because the lifecycle, state machine, routing, credentials and
  evidence have one owner and can be tested centrally.
- Good, because selected App access and registry enrollment prevent accidental
  activation.
- Bad, because central availability and release operations affect enrolled
  participants.

### Copy the complete runtime into every repository

- Good, because each repository appears self-contained.
- Bad, because it duplicates state machines, routing, agents, secrets and
  security fixes, and makes drift and incompatible upgrades likely.

### Thin workflow in every repository as primary intake

- Good, because repository-local Actions are familiar and can use local
  permissions.
- Bad, because every repository must maintain triggers and event filtering;
  it is a poor primary path for organization-wide webhook and enrollment
  policy. It remains an optional adapter for local execution.

### Run every participant from current `main`

- Good, because it is initially simple.
- Bad, because a merge silently changes behavior for every participant and
  makes rollback and compatibility evidence ambiguous.

### One App definition per repository

- Good, because access appears isolated.
- Bad, because GitHub organization installations already support selected
  repository access; multiple registrations multiply credentials, event
  configuration and operational failure modes without a platform requirement.

### App access alone as enrollment

- Good, because it has one setting.
- Bad, because granting an App access would unexpectedly activate lifecycle
  processing. It cannot express a shadow mode, contract pin or local profile.

### `.github` or `.github-private` as runtime

- Good, because those names have organization-wide meaning.
- Bad, because GitHub's documented special-repository behavior does not make
  either repository the canonical runtime. `.github` supplies public default
  community health files; `.github-private` supplies the private profile and,
  where supported, organization-level agent publication. Neither owns App
  execution or lifecycle state.

## More Information

- Refines [ADR-0012: Use GitHub as the lifecycle control plane](0012-use-github-as-the-lifecycle-control-plane.md): GitHub remains the work-state authority, while the executable controller becomes organization-aware.
- Supersedes the historical [ADR-0014: Use a repository-scoped GitHub App for event-producing mutations](https://github.com/agentic-delivery-lab/agentic-delivery/blob/1212568eeb80960696385f04a1dd6313e38e4e04/docs/decisions/0014-use-a-repository-scoped-github-app.md): the App installation is organization-wide with per-origin repository token narrowing. Its record is removed from the active tree, but the commit history remains the historical source.
- Refines [ADR-0015: Isolate resumable runner execution](0015-isolate-resumable-runner-execution.md): runner namespaces and continuation records must include repository ID, issue and pinned controller/state-machine versions.
- Refines [ADR-0017: Use an explicit agent-invocation boundary for conversation-driven delivery](0017-use-an-explicit-agent-invocation-boundary.md): invocation envelopes retain the originating repository and are authorized centrally.
- The selected architecture is an intermediate implementation boundary as the Architecture Authority, Agentic Primitives and Distribution repositories are extracted. The Control Plane remains in `agentic-delivery` to preserve existing issue and pull-request URLs.
- `Delivery Readiness` remains the current live field. Renaming it to `Delivery State` is a separate architecture decision and migration; this ADR does not silently change that vocabulary.
- This record is provisional until its review pull request is merged into `main`.
