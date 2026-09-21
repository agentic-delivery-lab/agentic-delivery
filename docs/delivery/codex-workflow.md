<!-- agentic-primitive: {"id":"codex-delivery-workflow-guide","kind":"instruction","enforcement":"instructional","adrs":["ADR-0009","ADR-0012","ADR-0015","ADR-0017","ADR-0018"],"domains":["agentic-delivery-governance","agentic-delivery-control-plane"]} -->

# Codex source issue workflow

The proposed workflow turns an open source issue into an implementation plan,
changes, validation, and a review pull request. Its decision is recorded in
[ADR-0009](../decisions/0009-run-codex-from-source-issues-with-a-budget-boundary.md).
The control-plane, traceability, App, and runner-isolation extensions are
recorded in [ADR-0012](../decisions/0012-use-github-as-the-lifecycle-control-plane.md),
[ADR-0013](../decisions/0013-derive-adr-traceability-from-agentic-primitives.md),
[ADR-0018](../decisions/0018-organization-wide-agentic-delivery-control-plane-distribution-and-versioning.md), and
[ADR-0015](../decisions/0015-isolate-resumable-runner-execution.md).

GitHub is the control plane: native issue types, pinned issue fields,
governance metadata, child-issue lineage, pull requests, and Actions own work
intent and lifecycle. Codex and the self-hosted runner are the execution plane.
Model output is an untrusted transition and orchestration proposal;
deterministic validation approves it before GitHub state changes. A run's
execution state (operation, Actions run identity, exact session, failure
reason, and recoverability) is stored separately, so retries do not silently
advance or corrupt the work item.

## Start and resume

After the workflow is merged and prerequisites are verified, open an issue
through an intake form or the blank-issue fallback. The intake workflow
uses a read-only Sol High routing turn to interpret the issue and conversation.
It proposes the native issue type, Lifecycle Stage, Delivery Readiness,
governance labels, and an allowed orchestration pattern. Deterministic code
validates that proposal against the two versioned catalogs and transition table
before changing issue fields or starting delivery. Title words, form headings,
keywords, and regular expressions do not decide the route. Incomplete,
ambiguous, Idea, and Research work remains in maturation; its stage and
readiness are represented by issue fields, not lifecycle labels.

A blank issue can enter iterative refinement: Codex asks one to three focused
questions, and a later repository-writer comment continues the same
conversation and saved session. A refined outcome selects one
delivery-capable parent work type and may contain multiple actionable work
items; those items are conditionally decomposed into at most ten idempotent
children. The parent remains the lineage root. An atomic goal continues from
the parent without a fixed child checklist. After discovery children provide
new evidence, a repository-writer comment can request another refinement wave
on the coordinating parent.

People do not set lifecycle fields during normal work. The routing model
proposes a stage and readiness value, and the deterministic readiness gate must
pass before GPT-5.6 Sol High starts Plan mode. After a successful plan, the
controller advances the issue fields through Planning and Execution and
automatically invokes GPT-5.6 Luna Max for Implement. Research, requirements,
architecture, validation, and coordination routes can stop or complete without
invoking an implementer.

The direct `issue_comment` workflow trigger is removed. A supported issue or
pull-request comment/review can enter through the explicit
`@agentic-delivery-lab-invoker-7f3a` invocation boundary after the
GitHub App webhook and deterministic preflight validate its signature, actor,
immutable conversation, source issue, and digest. The mention activates
processing; it does not select the route. Every accepted invocation is
interpreted with the full issue conversation, and the model may propose
`resume`, `refine`, or `hold` regardless of the words used. The deterministic
controller receives only the validated route and does not parse natural-
approved field values is the break-glass path when semantic routing is
unavailable.

Because this repository is public, ordinary `issues` events first pass a small
hosted-runner permission gate. It checks the event actor's repository
permission (or an exact internal automation identity) before the self-hosted
intake runner is allocated. Public users can therefore read and file issues
without consuming the trusted runner or reaching Codex; the normal issue
router still rechecks authorization before any state mutation.

## Conversation invocation operations

The follow-up invocation boundary is implemented by the GitHub App named
`Agentic Delivery Lab Invoker 7F3A` and the production Vercel Function at the configured
webhook URL. The organization-wide App contract registers `issues`, the
pull-request lifecycle observation events, and the conversation events
`issue_comment`, `pull_request_review`, and `pull_request_review_comment`.
Issue events are the lifecycle entry point for every active participant;
pull-request events are signed observations only, while conversation events
still require the explicit invocation mention. Install the App with
selected-repository access only; App access is necessary but does not enroll a
repository without the central participant registry.

The central pull-request observation dispatch workflow checks out the
participant's immutable controller commit from the signed event envelope before
loading its registry and validator. It never follows a moving `main` ref for
observation validation and it has no App private-key or webhook-secret input.
The issue-intake bootstrap uses the `bootstrapCommit` in the controller release
manifest for its trusted authorization and preflight checkout. The delivery
checkout and manual recovery input both require a 40-character controller SHA;
neither path falls back to `main`.

The Vercel ingress mints a repository-scoped read token for origin actor and
source checks, then a separate controller token narrowed to the controller
repository with only Contents write for the `repository_dispatch` handoff.
The runner's publication token follows the organization-wide ADR-0018
Contents, Issues, and Pull requests boundary; Actions `workflows:write` is not
required by the App contract. The webhook secret and App private key are stored only in
Vercel Production environment variables
(`AGENTIC_DELIVERY_WEBHOOK_SECRET`, `AGENTIC_DELIVERY_APP_ID`,
`AGENTIC_DELIVERY_APP_PRIVATE_KEY`, `AGENTIC_DELIVERY_APP_INSTALLATION_ID`,
`AGENTIC_DELIVERY_ORGANIZATION`, `AGENTIC_DELIVERY_ORGANIZATION_ID`, and
`AGENTIC_DELIVERY_CONTROLLER_REPOSITORY_ID`). The replay store must be a
durable atomic adapter in a multi-instance deployment; a file-backed store is
only valid for one process or a shared filesystem. The Actions controller receives the
corresponding `CODEX_DELIVERY_APP_ID`, `CODEX_DELIVERY_APP_PRIVATE_KEY`, and
optional `CODEX_DELIVERY_APP_INSTALLATION_ID` as repository Actions secrets.
Rotate both the webhook secret and private key through the GitHub App and
Vercel/Actions secret stores; never commit them.

The ingress verifies the signature and delivery ID, checks the exact actor
catalog, and calls GitHub `repository_dispatch` with only immutable source IDs
and a body digest. The self-hosted preflight re-fetches the current comment or
review, maps a pull request to its issue-linked source, and then invokes the
existing issue intake. A Vercel outage is fail-closed: it cannot authorize a
delivery run by itself. Native `@copilot` and other GitHub-managed agent
mentions remain outside this repository-owned invocation contract.

The controller reuses saved changes and a single branch. It never creates a
new task for a comment on missing, completed, running, stale, or inactive
execution state. It never merges the review pull request or closes the source
issue.

At publication, the controller derives a version-1 delivery evidence contract
from saved state, the verified tree, and the audit checkpoint. It stores the
record with the delivery state and publishes a concise projection in the
review pull request. The projection connects the source issue, workflow run,
branch, revision, Codex session, model turns, architecture context, validation,
bounded telemetry and audit checkpoint. It contains no credentials, hidden
reasoning or raw tool output and is replaced idempotently on publication retry.

## Issue communication

Issue comments use three short Markdown formats:

- **Progress update** reports concise, non-blocking work. Rapid updates in the
  same phase are saved but coalesced to avoid flooding the issue timeline.
- **Action required** lists only the questions that need a human
  decision and tells a repository writer to reply with those answers.
- **Delivery paused** names the stopped step, exact cause, and next action. It
  never asks for a field change or a continuation comment. When
  repository validation exhausts its repair attempts, this comment also shows
  the latest redacted validation error. Reading runner-local state is not
  required to identify that failure.

Structured model output remains machine-readable in saved delivery state. The
workflow publishes only the information a person needs to review the result or
take the stated next action. Session IDs, internal ownership terms, raw
protocol JSON, and hidden runner details are not issue instructions.

## Continuation state and session correlation

Persisted state is versioned and stores the repository, source issue, delivery
phase, exact Codex session UUID, a waiting comment boundary, consumed comment
IDs, and a separate execution record. The execution record contains the
operation, Actions run ID/attempt/URL, recoverability, and redacted failure
reason; it is evidence, not lifecycle authority. New app-server threads are
persistent (`ephemeral: false`). The
controller saves the returned UUID before the first model turn and resumes
later runs with `thread/resume` for that exact UUID. It does not use
`codex resume --last`, a global newest-session lookup, or a new-thread fallback
when a versioned state is missing or has an unresumable UUID.

The `awaiting-human` execution status is an intentional boundary, not a failed
Actions job. The handoff and its `CONTINUE.md` copy expose the same persisted identity:

```text
Codex session ID: <UUID>
Continuation state: awaiting-human
Issue: #<number>
Manual recovery: codex resume <UUID>
```

The next accepted repository-writer comment is supplied directly to the resumed
turn with
the saved issue brief, progress, implementation plan, remaining tasks, and
validation context. It is consumed by that first resumed turn; any further
implementation turns continue automatically from saved tasks without replaying
the comment or asking the writer to comment again. Comments at or before the
waiting boundary and duplicate event deliveries are ignored. Bot-authored
comments are excluded from issue
snapshots so automation cannot change the planning digest or create a loop.

Legacy state from the historical #17 and #18 runs had no persistent UUID. On
its first eligible recovery, the controller starts one persistent replacement
thread, records that reconstruction in the audit trail, and uses only the new
UUID thereafter.

The controller checks the source issue title, body, and discussion against the
saved planning snapshot before resuming dependent work and before publication.
New, edited, or removed human discussion returns the delivery run to planning
without discarding files. Its own audit comments, bot-authored comments, and
bare `/codex resume` commands do not invalidate the plan. Recognized
natural-language recovery requests have the same control-message treatment.
Other repository-writer comments remain part of the source snapshot, so new requirements
still return the run to planning. These checks are snapshots, not a lock on
issue edits.

## Runner prerequisites

- A dedicated Linux runner with labels `self-hosted`, `linux`, `x64`, `omarchy`.
- Node.js and exact pnpm as defined in `package.json`; workflows use the pinned
  pnpm setup action and frozen installations with lifecycle scripts disabled.
- Codex CLI 0.153.4, installed by `scripts/setup-runner-codex.mjs` from the
  official Linux x64 package after SHA-256 verification. The dedicated tool
  cache keeps this installation separate from personal tools. The runner verifies
  both model/effort combinations, ChatGPT login, Plan mode, and quota telemetry.
  The no-generation smoke check also probes persistent thread start and exact
  resume; this pinned CLI reports that a brand-new thread has no resumable
  rollout until its first model turn, so the check records that limitation
  without spending model quota.
- ChatGPT login for the installed `codex` executable under that user,
  `github-runner`. Another user's installation/login is not sufficient. For a
  headless runner, use the file-backed credential store so the service does not
  depend on an interactive desktop keyring:

  ```bash
  sudo install -d -o github-runner -g github-runner -m 700 \
    /var/lib/github-runner/.codex
  sudo -H -u github-runner env \
    HOME=/var/lib/github-runner \
    CODEX_HOME=/var/lib/github-runner/.codex \
    /opt/actions-runner/_work/_tool/codex-delivery/0.153.4/bin/codex \
    -c 'cli_auth_credentials_store="file"' login --device-auth
  ```

  Complete the device login in a browser, then verify it with the same
  `HOME`, `CODEX_HOME`, and `-c 'cli_auth_credentials_store="file"'` values.
  Never commit, print, copy, or paste the authentication file into an issue.
- Persistent writable state, defaulting to `.codex-delivery` beside
  `RUNNER_WORKSPACE`. Set repository variable `CODEX_DELIVERY_STATE_DIR` to an
  absolute directory outside disposable checkouts if needed. Restrict access
  to the runner service user and back it up as operational data.
- GitHub App secrets `CODEX_DELIVERY_APP_ID` and
  `CODEX_DELIVERY_APP_PRIVATE_KEY`, with optional secret
  `CODEX_DELIVERY_APP_INSTALLATION_ID`. Install the App only on this repository
  with Metadata read plus Issues, Contents, Pull requests, and Workflows write.
  The controller mints short-lived installation tokens only for child issue
  creation and publication. It keeps the private key and token in memory,
  redacts them, and never exposes them to Codex. `GITHUB_TOKEN` remains the
  default for reads, permission checks, governance labels, issue fields, and
  comments.

Run `self-hosted-runner-smoke` with input `codex=true` for a check without a
model turn. The setup step supplies the executable without copying
authentication. Complete the device login as `github-runner`, using the
file-backed store above. The smoke check also runs the actual tool-isolation
probes, without a model turn. It does not prove issue-to-PR operation.
Specify the repository explicitly when dispatching outside its checkout:

```bash
gh workflow run self-hosted-runner-smoke.yml \
  --repo agentic-delivery-lab/agentic-delivery --ref main -f codex=true
```

Before merge, replace `main` with the review pull request's head branch.
The Linux package setup is runner infrastructure; local governance
commands retain their separate cross-platform contract.

Use `node scripts/codex-sandbox-check.mjs` for an opt-in, zero-generation Linux
boundary check. It retains an isolated inspection fixture and checks filesystem
permissions, tool environment, child-process output, and denied external access.
The managed proxy feature must be enabled explicitly; declaring domain rules
alone does not enforce them. Tests have read-only workspace access and private
writable temporary directories. Only dependency installation and audit can use
the public npm registry. Governance validators run from the trusted checkout.
The trusted test wrapper bypasses the proxy only for loopback in the isolated
namespace, so local test servers work without access to runner-host services.

`node scripts/codex-handoff-check.mjs` is an opt-in local check that consumes
subscription allowance. It makes two bounded real model turns, verifies that
Sol High does not write during planning, and checks Luna Max's resulting file.
Do not add it to ordinary CI. An empty app-server environment list disables
filesystem tools; the controller deliberately retains the default local
environment with its named permissions.

## Budget boundary and saved work

The controller checks all returned usage windows and stops at 98 percent
usage. It also stops if telemetry cannot be read. Five hours describes the
subscription window and is the normal model-execution boundary. A turn has no
independent absolute duration limit: its 20-minute inactivity watchdog starts
after `turn/start` acknowledges the active turn and resets whenever that turn
produces activity. The 5.5-hour controller timeout and 350-minute Actions
timeout are recovery failsafes. Their gap gives the controller time to save a
handoff before Actions stops the job. Validation repairs are capped at three.

Implementation can span multiple model turns in one run. A `continue` outcome
records exact remaining implementation tasks and starts the next turn without
human intervention. A `complete` outcome must have no remaining tasks or
questions. Installation, repository verification, audit, commit, push, and
pull-request publication are performed by the workflow after model
implementation and therefore do not belong in the model's remaining task list.
A validation pause keeps an empty completed
task list empty instead of restoring the original plan as unfinished work. If
a structured completion is rejected, the controller preserves its reported
tasks in the handoff instead of showing an older plan.

Quota updates are not reservations. Other clients and in-flight requests may
consume the final reserve. There is no guarantee that arbitrary work completes
in one window. The controller never buys credits, consumes quota resets, or
switches billing or models to continue. It requires telemetry confirming that
no spendable or unlimited credits are available; available credits or missing
credit telemetry pause model execution. Do not enable automatic credit
recharging or add credits while a delivery run is active. Other account clients
and in-flight usage remain outside the controller's control.

Each issue directory retains `state.json`, an append-only `audit.jsonl`, and
the outbox. A working tree, Codex session home, and `CONTINUE.md` exist only
while a run is active or deliberately recoverable after a pause or human-input
boundary. Successful publication or explicit abandonment removes the checkout,
session home, temporary tools, and authentication bridge after the outbox is
flushed. Internal continuation details remain on the runner. A technical pause
states the exact rerun action; an `awaiting-human` state waits for the requested
answer. Comments use the semantic routing boundary, including comments that
contain the legacy `/codex resume` text.
Saved phases distinguish planning, branch creation, implementation,
verification, commit, and publication. Commit/publication retries do not start
a model or require available generation quota. Implementation questions preserve
the current phase and exact Codex session while retaining the existing branch
and work. The controller stops owned processes before committing and checks the
verified tree again.

Publication retries must still match that verified tree, even if somebody has
made another clean commit locally. Invalid saved state is left untouched for
operator inspection. Older state without a source snapshot returns to planning
before dependent work can continue.

Codex startup and protocol failures publish fixed diagnostic hints only. Raw
errors may contain authentication data, so the controller does not copy them
into logs or issue comments. Inspect unexpected failures locally as the runner
operator; never paste credential-bearing output into the audit trail.

If issue posting fails, the outbox remains in state for another attempt. A
hard process kill may leave `account.lock`; inspect the referenced run and
confirm that no Codex process is still active before removing that exact lock.
Do not delete issue workspaces to clear a lock. Retain lifecycle state and
audit history until the review pull request is merged or the work is abandoned;
archive or remove completed state deliberately, according to the runner's
retention policy.

## Review boundary

The controller restricts its own publication to its recorded feature branch;
that is not protection against other credentials. The dedicated publication
credential creates the review pull request so its required checks are started.
A human reviews the source issue, changed files, and checks, and separately
authorizes the merge. The repository is public, but branch protection and the
required-check ruleset still need an authorized post-merge activation and live
verification.

Internal pull requests also run the read-only Harness Architecture Review. The
deterministic layer compares the merge-base-to-head diff with the official base
ADRs, provisional head changes, the domain register, and the evidence contract.
The semantic layer uses a bounded Sol High review turn when quota and runner
evidence are available. Deterministic violations fail; semantic concerns and
inconclusive runtime evidence remain cited review findings. The review workflow
does not comment, modify, merge or close anything.

Review generated workflow and test changes before approving their execution.
Review PR CI runs repository code directly as the runner service account; it
does not inherit the model-tool sandbox. Contributors with repository write
access remain trusted to change workflows. Do not grant workflow approval to
unreviewed code simply because the controller's own sandbox checks passed.
