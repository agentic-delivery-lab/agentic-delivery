---
date: 2026-09-07
source-issue: https://github.com/sjefsharp/agentic-delivery/issues/15
decision-makers: Sjef Jenniskens
consulted: None
informed: None
---

# Run Codex from source issues with a budget boundary

## Context and Problem Statement

[Source issue #15](https://github.com/sjefsharp/agentic-delivery/issues/15)
requests immediate GitHub Issue intake on the existing self-hosted runner,
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

## Considered Options

- A small Node.js controller using `codex app-server`.
- Separate `codex exec` invocations with prompt-based planning.
- An API-key-based coding action.

## Decision Outcome

Chosen option: **A small Node.js controller using `codex app-server`**, because
its protocol exposes actual collaboration modes, per-turn model settings,
clarification requests, interruption, and subscription quota telemetry.

An issue opened by a contributor with current repository write permission
starts intake. A `/codex resume` issue comment or manual dispatch resumes a
pause. Free-form intake precedes the implementation plan. The source issue
also serves as ADR tracking when a significant decision is needed.

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

Persistent runner state holds the working tree, plan, progress, audit outbox,
and continuation prompt. Issue comments provide a human-readable audit trail.
The controller uses the repository branch helper, validates changes, and
publishes the recorded feature branch and review pull request. Validation
repairs are bounded to three attempts per invocation.

Model tools use named permissions: restricted reads, read-only planning,
workspace writes for implementation, read-only Git metadata, and no network.
The controller separately runs validation with network access for dependency
installation and audit. The workflow token is excluded from Codex processes.

### Consequences

- Good, because ideas and decisions can be clarified before implementation.
- Good, because plans, questions, failures, and handoffs remain on the source issue.
- Good, because quota pauses preserve work without further model spending.
- Bad, because runner installation, ChatGPT login, persistent storage, and
  sandbox compatibility are operational prerequisites.
- Bad, because interruption and remote posting are not atomic; the saved
  outbox can produce duplicate comments after an ambiguous network failure.
- Neutral, because this private repository on GitHub Free cannot enforce
  branch protection. Workflow policy does not prevent another credential
  holder from pushing to `main`. Human merge authority remains the policy.
- Neutral, because PR CI triggered by `GITHUB_TOKEN` can require a human to
  select **Approve workflows to run**. A GitHub App is a future alternative.

### Confirmation

Test quota failures, exact model selection, mode handoff, clarification,
interruption, authorization, continuation, and duplicate-event behavior.
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
- [Codex subscription allowance](https://learn.chatgpt.com/docs/pricing)
- [GitHub workflow triggers](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/trigger-a-workflow)
- [GitHub branch protection availability](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches)
- [Operation and continuation](../delivery/codex-workflow.md)
- Revisit when runner isolation, account sharing, automated resumption, or
  publishing credentials change.
