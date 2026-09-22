---
date: 2026-09-09
source-issue: https://github.com/agentic-delivery-lab/agentic-delivery/issues/21
decision-makers: Sjef Jenniskens
consulted: None
informed: None
domains:
  - agentic-delivery-governance
required-enforcement:
  - instructional
  - deterministic
---

# Run Codex from source issues with a budget boundary

## Context and Problem Statement

[Source issue #21](https://github.com/agentic-delivery-lab/agentic-delivery/issues/21)
amends the quota and continuation design tracked by
[source issue #18](https://github.com/agentic-delivery-lab/agentic-delivery/issues/18),
which amended the workflow originally tracked by
[source issue #15](https://github.com/agentic-delivery-lab/agentic-delivery/issues/15).
[Source issue #17](https://github.com/agentic-delivery-lab/agentic-delivery/issues/17)
later clarified that people must be able to continue a saved run with natural
language instead of a required slash command.
It requests reliable continuation of the current source-issue workflow on the
existing self-hosted runner,
planning with GPT-5.6 Sol High, implementation with GPT-5.6 Luna Max, and a
review pull request. Issues may contain ideas, requirements, or decisions.
The source issue must explain how the final change came about.

Historical issue #17 runs showed that an absolute 20-minute model-turn deadline
could stop healthy work even while Codex was active and subscription allowance
remained. They also showed that returning controller-owned verification as an
unfinished model task could reject a completed implementation and preserve a
stale task list. A human then had to ask for continuation repeatedly.

The affected bounded context is `agentic-delivery-governance`. Existing terms
include source issue, agentic primitive, provisional decision, issue-linked
branch name, and review pull request. New terms are implementation plan,
delivery run, budget boundary, and continuation prompt.

## Decision Drivers

- Respect GitHub Free, the existing Linux runner, and the shared Codex allowance.
- Preserve actual Plan mode and the exact requested model and effort settings.
- Ask for missing requirements and keep mandatory issue communication.
- Save resumable progress just before quota exhaustion.
- Let reported subscription usage, rather than elapsed turn time, remain the
  normal execution boundary while still detecting an unresponsive turn.
- Continue multi-turn implementation without requiring repeated human comments.
- Keep credentials and publication outside model-generated commands.
- Preserve human review, merge, and issue-closing authority.
- Continue only the exact source issue and persistent Codex session selected by
  a validated semantic routing proposal from a trusted repository writer.
- Interpret natural language in its full issue context without letting fixed
  words, unrelated comments, or negative instructions resume technical work.
- Keep human-input waiting separate from technical failure and prevent comment
  redelivery or bot feedback loops.

## Considered Options

- A small Node.js controller using `codex app-server`.
- Separate `codex exec` invocations with prompt-based planning.
- An API-key-based coding action.
- Keep absolute per-turn deadlines, replace them with an activity watchdog, or
  remove turn-level failure detection.
- For issue and comment routing, use contextual model reasoning with a closed
  deterministic validator, keyword matching, or unconditional continuation.

## Decision Outcome

Chosen option: **A small Node.js controller using `codex app-server`**, because
its protocol exposes actual collaboration modes, per-turn model settings,
clarification requests, interruption, and subscription quota telemetry.

An issue or newly created comment can enter semantic routing only after
deterministic repository, issue, event, bot, and repository-writer checks pass.
The routing model receives the current issue conversation and proposes the next
route and approved metadata as structured data. The validator rejects unknown
labels, illegal transitions, and inconsistent readiness before GitHub state or
the delivery controller changes. The controller therefore receives an already
validated route and never assigns intent from comment words. Any human wording,
including `/codex resume`, remains ordinary task data for model interpretation.
A validated answer or continuation instruction is passed to the exact saved
Codex session when model work resumes. Manual workflow dispatch with current
approved labels remains an explicit break-glass recovery path. Free-form intake
precedes the implementation plan. The source issue also serves as ADR tracking
when a significant decision is needed.

New delivery state is versioned and correlates one source issue to one
persistent Codex app-server thread UUID. The controller starts new threads with
`ephemeral: false`, saves the returned UUID before the first model turn, and
uses `thread/resume` with that exact UUID in later processes. It does not use a
global newest-session lookup or silently start a replacement when a versioned
UUID is missing or cannot be resumed. An `awaiting-human` state records the
waiting comment boundary and consumed comment IDs. The accepted owner comment
is passed directly to the resumed turn with the saved issue brief, progress,
plan, tasks, and validation context.

State from the historical #17 and #18 runs has no UUID. Its first eligible
recovery creates one persistent replacement thread, records the one-time
reconstruction in the audit trail, and uses only that new UUID thereafter.
Bot-authored comments are excluded from issue snapshots, and duplicate or
stale comments are rejected before model execution.

The single dedicated runner queues jobs. A persistent account lock prevents
overlapping controller runs on that host. Do not use Actions concurrency that
replaces older pending runs and loses issue intake. Other clients sharing the
same subscription remain outside this lock and count toward quota telemetry.

The controller stops at 98 percent reported usage in any returned window,
checks the five-hour window explicitly, and stops on unavailable telemetry.
It checks every 15 seconds and receives live quota notifications. A quota
notification triggers a fresh full telemetry read so a partial notification
cannot hide another exhausted window. A two-percent finalization reserve
supports the request to wrap up near zero. In-flight
usage and other clients can consume that reserve; telemetry is not an atomic
quota reservation. Finalization writes saved tasks and a continuation prompt
without another model call. No credits, quota resets, API billing, account
switching, or silent model substitution is permitted.

Model turns have no independent absolute duration limit. A 20-minute inactivity
watchdog starts after `turn/start` acknowledges the active turn, is reset by
activity for that turn, and interrupts only a turn that stops producing
activity. A 5.5-hour controller timeout and a 350-minute Actions timeout are
recovery failsafes, not subscription budgets; the gap lets the controller save
its handoff before Actions stops the job.

Implementation outcomes distinguish `continue`, `complete`, and `needs_input`.
`continue` carries exact remaining implementation tasks and immediately starts
another implementation turn in the same run. The validated repository-writer
comment is supplied only to the first resumed turn. `complete` is accepted only
with empty tasks and questions because dependency installation, repository
verification, audit, commit, push, and pull-request publication are performed
by the workflow after model implementation. When a semantically invalid structured outcome is rejected, its
reported tasks are saved for an accurate continuation handoff.

Model execution also requires telemetry reporting no spendable or unlimited
credits. Available credits or missing credit telemetry pause the delivery run.
Do not add credits or enable automatic credit recharging during execution.
This avoids relying on a quota interrupt alone to prevent credit spillover.

Persistent runner state holds the working tree, plan, progress, audit outbox,
and continuation prompt. Issue comments provide a human-readable audit trail.
The controller uses the repository branch helper, validates changes, and
publishes the recorded feature branch and review pull request. Validation
repairs are bounded to three attempts per invocation.

Issue communication, authorization checks, labels, and ordinary reads use the
job's short-lived `GITHUB_TOKEN`. Child-issue creation, Git publication, and
review pull-request publication use the repository-scoped GitHub App described
by ADR-0018. The controller mints installation tokens just in time, redacts
them, and does not expose them to model tools. This split preserves the
workflow token's least-privilege role while allowing App-generated events to
start required downstream checks.

Source issue and discussion snapshots are checked before dependent resumption
and publication. Changed input returns to planning while preserving files.

ADR-0012 refines the intake boundary: iterative refinement answers may come
from a non-bot repository writer whose write, maintain, or admin permission is
validated by the control plane. Exact-session continuation, execution-state
evidence, and human review/merge authority remain unchanged.
Publication retries must match the verified tree. Invalid saved state remains
untouched for operator inspection. Authentication-bearing Codex errors are
replaced with fixed diagnostic hints before publication.

Model tools use named permissions: restricted reads, read-only planning,
workspace writes for implementation, read-only Git metadata, and no external
network access. The explicitly enabled managed proxy denies outbound domains
while preserving process-local communication in an isolated network namespace.
The plain `network=false` mode blocks Node.js child-process socket operations
in the tested CLI. Dependency installation and audit instead allow only
`registry.npmjs.org`, with lifecycle scripts and pnpm hooks disabled. Tests run
read-only, and governance validators come from the trusted controller checkout.
Model tools use a temporary home without `CODEX_HOME` or workflow credentials.
Configured hooks, notifications, and custom providers fail closed before a
model thread starts. The runner uses a dedicated ChatGPT login in the
`github-runner` account's file-backed credential store. This avoids depending
on an interactive desktop keyring while keeping the credential directory
restricted to that service account.

### Consequences

- Good, because ideas and decisions can be clarified before implementation.
- Good, because plans, questions, failures, and handoffs remain on the source issue.
- Good, because quota pauses preserve work without further model spending.
- Good, because active work can use the available five-hour allowance without
  repeated continuation comments or an arbitrary per-turn cutoff.
- Good, because silent turns still stop in time for a recoverable handoff.
- Good, because model reasoning interprets continuation, questions, objections,
  and scope changes from the full issue context without a phrase list.
- Bad, because runner installation, ChatGPT login, persistent storage, a
  separately managed publication token, and sandbox compatibility are
  operational prerequisites.
- Bad, because interruption and remote posting are not atomic; the saved
  outbox can produce duplicate comments after an ambiguous network failure.
- Bad, because legacy session reconstruction cannot restore the original
  ephemeral conversation and therefore depends on the saved issue brief and
  continuation context.
- Bad, because semantic routing consumes subscription allowance and can be
  unavailable; manual dispatch remains a rare break-glass fallback.
- Bad, because an active but unproductive turn can continue until quota or the
  outer recovery failsafe is reached.
- Neutral, because this private repository on GitHub Free cannot enforce
  branch protection. Workflow policy does not prevent another credential
  holder from pushing to `main`. Human merge authority remains the policy.
- Neutral, because the dedicated publication credential starts review PR CI;
  it does not approve checks, review changes, or authorize a merge.

### Confirmation

Test quota failures, exact model selection, mode handoff, clarification,
interruption, authorization, persistent UUID start/resume, repository-writer
continuation, automatic multi-turn implementation, activity watchdog resets,
semantic routing proposals, negative comments, legacy reconstruction,
rejected-outcome task persistence, and duplicate-event behavior.
Run repository tests and quality checks. Verify Codex under `github-runner`
without generating a turn, then demonstrate a small end-to-end issue after
human merge and prerequisite setup. Do not claim runtime readiness from unit
tests alone. This ADR remains provisional until merged into `main`.

Amendment source: [issue #32](https://github.com/agentic-delivery-lab/agentic-delivery/issues/32)

## Pros and Cons of the Options

### Codex app-server controller

- Good, because the required modes and telemetry are explicit protocol fields.
- Bad, because protocol and sandbox compatibility need runtime verification.

### Separate codex exec invocations

- Good, because the orchestration is smaller.
- Bad, because the installed CLI has no Plan-mode flag and needs another
  interface for quota telemetry and clarification handling.

### API-key-based coding action

- Good, because existing integrations can publish changes.
- Bad, because API billing does not implement the requested subscription budget.

## More Information

- [Codex app-server](https://learn.chatgpt.com/docs/app-server)
- [Codex permissions](https://learn.chatgpt.com/docs/permissions)
- [Codex managed network proxy](https://github.com/openai/codex/blob/rust-v0.153.4/codex-rs/network-proxy/README.md)
- [Codex subscription allowance](https://learn.chatgpt.com/docs/pricing)
- [GitHub workflow triggers](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/trigger-a-workflow)
- [GitHub branch protection availability](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches)
- [Issue #18: Restore exact Codex issue continuation](https://github.com/agentic-delivery-lab/agentic-delivery/issues/18)
- [Issue #21: Replace the fixed Codex turn deadline with quota-led execution](https://github.com/agentic-delivery-lab/agentic-delivery/issues/21)
- [Issue #17: Introduce an issue-driven intake and routing harness](https://github.com/agentic-delivery-lab/agentic-delivery/issues/17)
- [PR #20: Make Codex issue comments actionable](https://github.com/agentic-delivery-lab/agentic-delivery/pull/20)
- [Operation and continuation](../delivery/codex-workflow.md)
- Revisit when runner isolation, account sharing, automated resumption, or
  publishing credentials change.
