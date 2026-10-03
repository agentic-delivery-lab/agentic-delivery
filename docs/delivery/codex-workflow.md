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
uses a read-only GPT-6 Luna Low routing turn to interpret the issue and
conversation.
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
pass before GPT-6 Sol High starts Plan mode. After a successful plan, the
controller advances the issue fields through Planning and Execution and
automatically invokes GPT-6 Luna Max for Implement. Refinement, discovery,
research, requirements, architecture, validation, and coordination routes can
stop or complete without invoking an implementer.

The remaining profiles use GPT-6 Luna Medium for refinement, discovery,
research, requirements, and coordination. Planning, architecture decisions,
and semantic review use GPT-6 Sol High. Implementation and its first
verification pass use GPT-6 Luna Max. Preflight checks these exact model and
effort combinations against the runner's Codex catalog and stops before a
model turn if one is unavailable. Automatic profiles do not use GPT-6 Astra
and do not fall back to another model.

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
manifest for its trusted authorization and preflight checkout. Direct manual
intake and recovery resolve participant mode and controller pin from the
registry loaded at the fixed bootstrap commit after checking the event
repository ID and expected name. They do not accept a caller-selected
controller SHA. `force_read_only` defaults to `true`. The standalone delivery
workflow resolves policy in a hosted job with contents-read permission only;
its self-hosted delivery job runs only for an active participant with an
effective non-read-only run. Reusable delivery checks out the immutable
controller SHA selected from the registry. Its hosted resolver also verifies
the main-branch caller and source repository, then re-reads participant mode
and the controller pin from the fixed bootstrap registry. The reusable workflow
does not accept those policy values from its caller. Neither path falls back
to a moving `main` ref.

The Vercel ingress mints a repository-scoped read token for origin actor and
source checks, then a separate controller token narrowed to the controller
repository with only Contents write for the `repository_dispatch` handoff.
The runner's publication token follows the organization-wide ADR-0018
Contents, Issues, and Pull requests boundary; Actions `workflows:write` is not
required by the App contract. Origin intake and delivery tokens also request
`issue_fields: read` and `issue_types: read` to validate organization
metadata. These tokens remain narrowed to the originating repository ID; the
repository ID restriction applies to repository resources; organization
catalog reads remain organization-wide. The controller dispatch token requests
only `contents: write`. The Vercel ingress uses these Production environment variables:
`AGENTIC_DELIVERY_WEBHOOK_SECRET`,
`AGENTIC_DELIVERY_APP_ID`, `AGENTIC_DELIVERY_APP_PRIVATE_KEY`,
`AGENTIC_DELIVERY_APP_INSTALLATION_ID`, `AGENTIC_DELIVERY_DISPATCH_SECRET`,
`AGENTIC_DELIVERY_ORGANIZATION`, `AGENTIC_DELIVERY_ORGANIZATION_ID`, and
`AGENTIC_DELIVERY_CONTROLLER_REPOSITORY_ID`. Treat the webhook secret, App
private key, and dispatch secret as secrets; the IDs and organization values
are configuration. The replay store must be a durable atomic adapter in a
multi-instance deployment; a file-backed store is only valid for one process
or a shared filesystem.

In the central controller repository's Actions settings, store
`CODEX_DELIVERY_APP_ID` and, optionally,
`CODEX_DELIVERY_APP_INSTALLATION_ID` as repository variables. Store
`CODEX_DELIVERY_APP_PRIVATE_KEY` and `CODEX_DELIVERY_DISPATCH_SECRET` as
Actions secrets. Store `ISSUE_FIELD_BINDINGS_JSON` as a repository Actions
secret as well. Its organization-specific field and option IDs are
configuration rather than credentials, but they must not appear in public
workflow logs. The issue-intake and delivery workflows pass this secret
explicitly through their reusable-workflow calls, and each consuming job
registers every runtime field and option ID for masking before using it.
Remove the old repository variable after the workflow changes use the secret.
Rotate the webhook secret, dispatch secret, and private key through their
respective Vercel or Actions secret stores; never commit them.

The ingress verifies the webhook signature and delivery ID, checks the exact
actor catalog, signs the complete dispatch envelope with the separate dispatch
secret, and calls GitHub `repository_dispatch` with only immutable source IDs,
a body digest, and the signed identity fields. The self-hosted preflight
re-fetches the current comment or
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
- The centrally pinned Codex CLI release, installed by
  `scripts/setup-runner-codex.mjs` from the official Linux x64 package after
  SHA-256 verification. Every Actions workflow uses this setup script; the
  dedicated tool cache keeps this installation separate from personal tools.
  A weekly release check opens a review pull request for a newer stable release
  after creating a release-specific Task issue. Its pull request closes that
  issue when merged and references issue #70 for the ongoing maintenance
  policy, so future CLI updates do not depend on #70 remaining open. The
  updater creates the release Task and pushes its issue-linked branch with
  `GITHUB_TOKEN`, then opens the PR with a short-lived repository-scoped GitHub
  App token limited to contents read and pull requests write. The PR event
  starts the body, delivery-quality, and ADR checks on the exact head. The
  updater does not change the repository Actions setting that combines token
  based PR creation with review approval. It waits for the exact-head body,
  delivery-quality, portability, and applicable ADR checks to pass, then
  dispatches the no-generation runner smoke. It paginates the pull-request list
  and exact-head check-run evidence. It also paginates open release Task search
  results and stops before issue creation if the search is incomplete, changes
  during pagination, or exceeds GitHub's 1,000-result limit. The Harness skips
  the automatic event only for an internal bot-authored update PR with the
  expected branch, title, and versioned marker; a human cannot suppress review
  by editing the body. Harness starts only after the smoke passes; a
  deterministic failure prevents both runner dispatches. The
  generated PR description separates verified release metadata from checks
  that are pending at creation.
  The delivery-quality `quality` job, ADR validation and portability matrix use
  ephemeral GitHub-hosted runners. This lets their exact-head checks finish
  while Harness uses the single persistent self-hosted Codex runner to wait for
  readiness.
  The runner verifies every configured model/effort pair, ChatGPT login, Plan
  mode, and quota telemetry before a model turn.
  The no-generation smoke check also probes persistent thread start and exact
  resume. Treat the result as release-specific runner evidence; a fresh session
  may require its first model rollout before exact resume can be verified.
  The check records that limitation without spending model quota.
  Harness includes the live PR description, non-Harness check runs for its
  exact reviewed commit, and runner preflight results. It excludes its own
  `review` check only after verifying its workflow-run and job provenance, so
  an unrelated same-name check remains visible. It resumes an interrupted
  thread only when the full evidence fingerprint is unchanged; changed evidence
  gets an isolated thread. Its semantic diff contains every
  changed path with five lines of context, including configuration and
  changelog edits. A diff over 500,000 characters stops before a model turn
  and is reported as inconclusive instead of being silently truncated. Before
  a model turn, Harness waits up to 15 minutes for the expected exact-head
  checks to finish and skips the turn when a required check fails or remains
  unavailable. A completed review is reused only when its full evidence
  fingerprint matches and the required
  exact-head checks passed. Quota snapshots are recorded outside the model
  input before and after a semantic turn. Each snapshot keeps
  returned primary and secondary windows separate, including duration, usage,
  reset time, and safe threshold, rate-limit, and spend-control signals. The
  snapshots show observed usage but cannot attribute a change to one model
  when other Codex clients share the allowance. A failed preflight writes its
  per-window observations and guard signals to the Actions job summary and
  runner log before any semantic model turn starts. Deterministic violations
  skip the semantic turn.
- Harness review sessions use protected, runner-local state at
  `/var/lib/github-runner/.codex/harness-reviews`, outside disposable
  checkouts and Actions artifacts. The thread UUID is saved before the model
  turn; an interrupted review resumes the same thread with a short prompt. A
  completed result is reused without another semantic model turn only when
  the exact semantic evidence fingerprint matches and expected exact-head
  checks are complete. Session files are restricted to `github-runner` and
  become eligible for pruning after 30 days. This state survives workflow jobs
  on the same persistent runner, not replacement of that runner.
- Automatic Harness suppression for a CLI update PR requires the exact
  registered delivery App bot login, the issue-linked updater branch and
  expected title, and the versioned marker. Other bot-authored PRs still run
  Harness. The semantic evidence bundle omits its expected pre-turn
  `not-run` placeholder so the current review does not mistake its own pending
  result for missing evidence.
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
    /opt/actions-runner/_work/_tool/codex-delivery/<pinned-version>/bin/codex \
    -c 'cli_auth_credentials_store="file"' login --device-auth
  ```

  Complete the device login in a browser, then verify it with the same
  `HOME`, `CODEX_HOME`, and `-c 'cli_auth_credentials_store="file"'` values.
  Never commit, print, copy, or paste the authentication file into an issue.
- Persistent writable state, defaulting to `.codex-delivery` beside
  `RUNNER_WORKSPACE`. Set repository variable `CODEX_DELIVERY_STATE_DIR` to an
  absolute directory outside disposable checkouts if needed. Restrict access
  to the runner service user and back it up as operational data.
- Repository Actions variables `CODEX_DELIVERY_APP_ID` and, optionally,
  `CODEX_DELIVERY_APP_INSTALLATION_ID`; Actions secret
  `CODEX_DELIVERY_APP_PRIVATE_KEY`. Install the central App with selected-
  repository access, repository Metadata read plus Contents, Issues, and Pull
  requests write, and organization Issue Fields and Issue Types read. Do not
  grant Workflows write. Issue intake uses a repository-scoped installation
  token to read the issue and organization issue-field contract and to perform
  validated issue write-back. Delivery uses a repository-scoped token for its
  authorized issue and pull-request operations. The private key and tokens
  stay in memory, are redacted, and are never exposed to Codex. The workflow
  token still supports Actions-level authorization and controller-repository operations;
  it cannot replace the installed App token for organization issue-field
  access.

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
GPT-6 Sol High planning remains read-only, then uses GPT-6 Luna Max with the
workspace-write profile to implement the saved plan. Deterministic controller
checks verify the resulting tree.
Do not add it to ordinary CI. An empty app-server environment list disables
filesystem tools; the controller deliberately retains the default local
environment with its named permissions.

## Budget boundary and saved work

The controller checks all returned usage windows and stops at 98 percent
usage. It also stops when Codex reports a rate-limit or spend-control block or
if telemetry cannot be read. Five hours describes the subscription window and
is the normal model-execution boundary, but a secondary window may stop work
first. Preflight evidence records each returned window separately in the
Actions job summary and runner log so the limiting window can be identified.
A turn has no independent absolute duration limit: its 20-minute inactivity
watchdog starts after `turn/start` acknowledges the active turn. It resets
whenever the turn produces activity. The 5.5-hour controller timeout and
350-minute Actions timeout are recovery failsafes. Their gap gives the
controller time to save a handoff before Actions stops the job. Validation
repairs are capped at three.

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

Codex startup and protocol failures publish only allowlisted error codes, HTTP
status codes, and fixed diagnostic hints. For example, a recognized workspace
routing failure is recorded as a fixed category. Raw errors and additional
details may contain authentication data, so the controller does not copy them
into logs or issue comments. Inspect unexpected failures locally as the runner
operator; never paste credential-bearing output into the audit trail.

Failed-turn diagnostics include `diagnostic_message` (absent, empty,
non-string, recognized, or unrecognized), `additional_details` (present or
absent), fixed `terminal_source` and `diagnostic_source` values, the count of
correlated retry notifications, and `failure_duration_ms` from the turn-start
request to failure. Retry notifications are capped at 99 and elapsed time at
24 hours. An unrecognized message means its content remains withheld, so this
shape alone does not identify the root cause.

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
The semantic layer uses a bounded GPT-6 Sol High review turn when quota and runner
evidence are available. Preflight checks the exact model-effort profile against
the runner catalog. A known unsupported pair is reported by name without raw
runner errors; other initialization failures stay redacted. Deterministic
violations fail; semantic concerns and inconclusive runtime evidence remain
cited review findings. The review workflow does not comment, modify, merge or
close anything.

For each semantic run, the evidence bundle fetches the current pull-request
title and body through the workflow's read-only pull-request permission. The
event supplies the repository and pull-request number; its title and body are
not reused because a rerun can carry an older event snapshot. If GitHub cannot
return the current description, the bundle marks it unavailable instead of
falling back to stale text. The description is untrusted input, is filtered for
known credentials, and includes at most 10,000 body characters. The versioned
delivery-evidence marker is extracted separately from the full current body,
so a long description cannot hide a marker beyond that text cap.

The linked source issue is fetched with the read-only issue permission. Its
sanitized projection includes current labels so the reviewer can verify ADR
governance metadata instead of relying on an incomplete event snapshot.

When quota telemetry stops semantic review, the Actions summary records whether
the stop happened during preflight or an active review turn. It retains every
known safe cause category and reports at most 32 triggering windows, 32 context
windows, and 32 server-block records, prioritizing active server blocks. The
projection sets `truncated` when these limits or safety filters omit bucket
details. The summary includes usage, duration, reset times, and a next eligible
time only when window reserve is the sole stop cause and the exhausted windows
make it possible to calculate one. Active server rate limits and spend controls
always suppress that time.
Provider limit names, account identifiers, and raw error details are not
published. An `inconclusive` result means no semantic conclusion was reached;
it does not change the deterministic review result.

The optional `semantic.quotaDiagnostics` object has its own SemVer
`schemaVersion`, initially `1.0.0`. Version 1 codes, stop phases, and display
labels are registered in `scripts/lib/quota-diagnostics.mjs`; producer,
projection, schema, and summary formatter use that shared contract. A minor
version may add optional fields or codes; the schema permits unknown properties
and consumers ignore them. Corrections that do not change the contract
increment the patch version. Removing fields or changing their meaning
increments the major version. Consumers support compatible versions with major
version 1 and must not interpret an unsupported major version as version 1.

To retry after a quota stop, open the latest Harness Architecture Review run
for the pull request head and inspect its Actions summary. Wait until the
reported next eligible UTC time. If no time can be derived, check the current
subscription quota for the same account, confirm any reported server block has
cleared, and wait until all exhausted windows have reset below the 98% reserve.
Then use **Re-run all jobs** on that run. The retry starts a fresh read-only
semantic review on the same pull-request head; it does not resume a saved model
session. If it stops again, use the new sanitized summary to identify the
window or server flag before deciding whether further recovery is needed.

Review generated workflow and test changes before approving their execution.
Review PR CI runs repository code directly as the runner service account; it
does not inherit the model-tool sandbox. Contributors with repository write
access remain trusted to change workflows. Do not grant workflow approval to
unreviewed code simply because the controller's own sandbox checks passed.
