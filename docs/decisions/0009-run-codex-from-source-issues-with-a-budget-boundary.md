---
date: 2026-09-09
source-issue: https://github.com/sjefsharp/agentic-delivery/issues/18
decision-makers: Sjef Jenniskens
consulted: None
informed: None
---

# Run Codex from source issues with a budget boundary

## Context and Problem Statement

[Source issue #18](https://github.com/sjefsharp/agentic-delivery/issues/18)
amends the continuation design originally tracked by
[source issue #15](https://github.com/sjefsharp/agentic-delivery/issues/15).
[Source issue #17](https://github.com/sjefsharp/agentic-delivery/issues/17)
later clarified that people must be able to continue a saved run with natural
language instead of a required slash command.
It requests reliable continuation of the current source-issue workflow on the
existing self-hosted runner,
planning with GPT-5.6 Sol High, implementation with GPT-5.6 Luna Max, and a
review pull request. Issues may contain ideas, requirements, or decisions.
The source issue must explain how the final change came about.

The affected bounded context is `agentic-delivery-governance`. Existing terms
include source issue, agentic primitive, provisional decision, issue-linked
branch name, and review pull request. New terms are implementation plan,
delivery run, budget boundary, and continuation prompt.

## Decision Drivers

- Respect GitHub Free, the existing Linux runner, and the shared Codex allowance.
- Preserve actual Plan mode and the exact requested model and effort settings.
- Ask for missing requirements and keep mandatory issue communication.
- Save resumable progress just before quota exhaustion.
- Keep credentials and publication outside model-generated commands.
- Preserve human review, merge, and issue-closing authority.
- Continue only the exact source issue and persistent Codex session requested by
  a trusted repository-owner comment.
- Keep natural language as the primary human continuation interface without
  letting unrelated or negative comments resume technical work.
- Keep human-input waiting separate from technical failure and prevent comment
  redelivery or bot feedback loops.

## Considered Options

- A small Node.js controller using `codex app-server`.
- Separate `codex exec` invocations with prompt-based planning.
- An API-key-based coding action.
- For technical recovery, recognize clear natural-language continuation intent,
  require an exact slash command, or treat every owner comment as a resume.

## Decision Outcome

Chosen option: **A small Node.js controller using `codex app-server`**, because
its protocol exposes actual collaboration modes, per-turn model settings,
clarification requests, interruption, and subscription quota telemetry.

An issue opened by a contributor with current repository write permission
starts intake. A newly created issue comment can enter the controller only when
the payload author is the repository owner with `author_association: OWNER`;
the controller repeats this check using the comment payload rather than
`GITHUB_TRIGGERING_ACTOR`. A plain owner answer continues an existing
`awaiting-human` state. A clear natural-language owner request such as “Please
continue from the saved work” continues a technical `paused` state and is
passed to the exact saved Codex session when model work resumes. Deterministic
leading-intent matching accepts common English and Dutch continuation wording
without treating comments such as “Do not continue yet” as authorization. The
legacy `/codex resume` comment remains a compatibility shortcut, and manual
dispatch remains an operator recovery path. Free-form intake precedes the
implementation plan. The source issue also serves as ADR tracking when a
significant decision is needed.

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
It checks every 15 seconds and receives live quota notifications. A two-percent
finalization reserve supports the request to wrap up near zero. In-flight
usage and other clients can consume that reserve; telemetry is not an atomic
quota reservation. Finalization writes saved tasks and a continuation prompt
without another model call. No credits, quota resets, API billing, account
switching, or silent model substitution is permitted.

Model execution also requires telemetry reporting no spendable or unlimited
credits. Available credits or missing credit telemetry pause the delivery run.
Do not add credits or enable automatic credit recharging during execution.
This avoids relying on a quota interrupt alone to prevent credit spillover.

Persistent runner state holds the working tree, plan, progress, audit outbox,
and continuation prompt. Issue comments provide a human-readable audit trail.
The controller uses the repository branch helper, validates changes, and
publishes the recorded feature branch and review pull request. Validation
repairs are bounded to three attempts per invocation.

Source issue and discussion snapshots are checked before dependent resumption
and publication. Changed input returns to planning while preserving files.
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
- Good, because people can continue saved work in natural language while an
  explicit negative comment remains non-triggering.
- Bad, because runner installation, ChatGPT login, persistent storage, and
  sandbox compatibility are operational prerequisites.
- Bad, because interruption and remote posting are not atomic; the saved
  outbox can produce duplicate comments after an ambiguous network failure.
- Bad, because legacy session reconstruction cannot restore the original
  ephemeral conversation and therefore depends on the saved issue brief and
  continuation context.
- Bad, because deterministic intent matching cannot understand every possible
  natural-language phrasing; manual dispatch and the compatibility shortcut
  remain fallbacks.
- Neutral, because this private repository on GitHub Free cannot enforce
  branch protection. Workflow policy does not prevent another credential
  holder from pushing to `main`. Human merge authority remains the policy.
- Neutral, because PR CI triggered by `GITHUB_TOKEN` can require a human to
  select **Approve workflows to run**. A GitHub App is a future alternative.

### Confirmation

Test quota failures, exact model selection, mode handoff, clarification,
interruption, authorization, persistent UUID start/resume, owner-comment
continuation, natural-language recovery intent, negative comments, legacy
reconstruction, and duplicate-event behavior.
Run repository tests and quality checks. Verify Codex under `github-runner`
without generating a turn, then demonstrate a small end-to-end issue after
human merge and prerequisite setup. Do not claim runtime readiness from unit
tests alone. This ADR remains provisional until merged into `main`.

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
- [Issue #18: Restore exact Codex issue continuation](https://github.com/sjefsharp/agentic-delivery/issues/18)
- [Issue #17: Introduce an issue-driven intake and routing harness](https://github.com/sjefsharp/agentic-delivery/issues/17)
- [PR #20: Make Codex issue comments actionable](https://github.com/sjefsharp/agentic-delivery/pull/20)
- [Operation and continuation](../delivery/codex-workflow.md)
- Revisit when runner isolation, account sharing, automated resumption, or
  publishing credentials change.
