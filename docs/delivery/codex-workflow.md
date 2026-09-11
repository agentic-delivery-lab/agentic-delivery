<!-- agentic-primitive: {"id":"codex-delivery-workflow-guide","kind":"instruction","enforcement":"instructional","adrs":["ADR-0009","ADR-0012","ADR-0014","ADR-0015"],"domains":["agentic-delivery-governance"]} -->

# Codex source issue workflow

The proposed workflow turns an open source issue into an implementation plan,
changes, validation, and a review pull request. Its decision is recorded in
[ADR-0009](../decisions/0009-run-codex-from-source-issues-with-a-budget-boundary.md).
The control-plane, traceability, App, and runner-isolation extensions are
recorded in [ADR-0012](../decisions/0012-use-github-as-the-lifecycle-control-plane.md),
[ADR-0013](../decisions/0013-derive-adr-traceability-from-agentic-primitives.md),
[ADR-0014](../decisions/0014-use-a-repository-scoped-github-app.md), and
[ADR-0015](../decisions/0015-isolate-resumable-runner-execution.md).

GitHub is the control plane: issue labels, child-issue lineage, pull requests,
and Actions own work state. Codex and the self-hosted runner are the execution
plane. Model output is an untrusted transition proposal; deterministic
validation approves it before GitHub state changes. A run's execution state
(operation, Actions run identity, failure reason, and recoverability) is stored
separately, so retries do not silently advance or corrupt the work item.

## Start and resume

After the workflow is merged and prerequisites are verified, open an issue
through an intake form or the blank-issue fallback. The intake workflow
classifies the work type, lifecycle state, and governance metadata before any
Codex turn. Incomplete, ambiguous, Idea, and Research work remains in
maturation (`Research` uses `state:investigating`; deferred Idea work uses
`state:parked`).

A blank issue can enter iterative refinement: Codex asks one to three focused
questions, and a later repository-writer comment continues the same
conversation and saved session. A refined outcome selects one
delivery-capable parent work type and may contain multiple actionable work
items; those items are conditionally decomposed into at most ten idempotent
children. The parent remains the lineage root. An atomic goal continues from
the parent without a fixed child checklist. After discovery children provide
new evidence, a repository-writer comment can request another refinement wave
on the coordinating parent.

Applying a valid `state:ready-for-plan` is the normal authorization for the
downstream delivery workflow. The classifier's deterministic readiness gate
must pass before GPT-5.6 Sol High starts Plan mode. After a successful plan,
the controller records `state:ready-for-agent`, enters `state:in-progress`,
and automatically invokes GPT-5.6 Luna Max for Implement. A clear
natural-language recovery request, the legacy `/codex resume` command, or
manual dispatch is reserved for a paused continuation or a separately
configured human gate. The workflow records progress and validation on the
source issue.

The `issue_comment` trigger is restricted twice: the workflow accepts only a
new non-bot issue comment, and the intake controller verifies repository
write/maintain/admin permission before handing it to delivery. The controller
also verifies the same payload identity. Pull-request comments, bots, rerun
actors, and unauthorized writers cannot enter continuation. A plain
writer answer continues an existing `awaiting-human` continuation state. A
clear natural-language request such as “Please continue from the saved work”
continues a technical `paused` state. The legacy `/codex resume` form remains a
compatibility shortcut, while manual dispatch of `codex-delivery` remains
available for recovery and initial issue execution.

The controller reuses saved changes and a single branch. It never creates a
new task for a comment on a missing, completed, running, stale, or inactive
state. It never merges the review pull request or closes the source issue.

At publication, the controller derives a version-1 delivery evidence contract
from saved state, the verified tree, and the audit checkpoint. It stores the
record with the delivery state and publishes a concise projection in the
review pull request. The projection connects the source issue, workflow run,
branch, revision, Codex session, model turns, architecture context, validation,
bounded telemetry and audit checkpoint. It contains no credentials, hidden
reasoning or raw tool output and is replaced idempotently on publication retry.

## Issue communication

Issue comments use three visibly different Markdown formats:

- **Progress update** reports concise, non-blocking work. Rapid updates in the
  same phase are saved but coalesced to avoid flooding the issue timeline.
- **Action required: answer Codex** lists only the questions that need a human
  decision and tells a repository writer to reply with those answers.
- **Delivery paused: recovery required** reports a technical or quota pause,
  states that no decision is requested, and gives the recovery action.

Structured model output remains machine-readable in saved delivery state. The
controller extracts its summary and next tasks for issue comments instead of
publishing raw protocol JSON. Full implementation plans, remaining work,
session correlation, and operator recovery details remain available in
collapsed Markdown sections when they are needed for review or recovery.

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

The `awaiting-human` state is an intentional boundary, not a failed Actions
job. The handoff and its `CONTINUE.md` copy expose the same persisted identity:

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
  default for reads, permission checks, labels, and comments.

Run `self-hosted-runner-smoke` with input `codex=true` for a check without a
model turn. The setup step supplies the executable without copying
authentication. Complete the device login as `github-runner`, using the
file-backed store above. The smoke check also runs the actual tool-isolation
probes, without a model turn. It does not prove issue-to-PR operation.
Specify the repository explicitly when dispatching outside its checkout:

```bash
gh workflow run self-hosted-runner-smoke.yml \
  --repo sjefsharp/agentic-delivery --ref main -f codex=true
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
pull-request publication are controller-owned work and therefore do not belong
in the model's remaining task list. If a structured completion is rejected,
the controller preserves its reported tasks in the handoff instead of showing
an older plan.

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
flushed. The continuation prompt and remaining tasks are also posted on the
source issue without another model call. A technical pause waits for a clear
natural-language writer request to continue; an `awaiting-human` state waits
for the requested answer. The legacy `/codex resume` command remains accepted
for compatibility.
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

GitHub Free cannot enforce protected branches for this private repository.
The controller restricts its own publication to its recorded feature branch;
that is not protection against other credentials. The dedicated publication
credential creates the review pull request so its required checks are started.
A human reviews the source issue, changed files, and checks, and separately
authorizes the merge.

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
