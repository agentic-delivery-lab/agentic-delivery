# Continue source issue #18: restore Codex issue continuation

This handoff preserves the approved implementation plan and the evidence that
led to it. It is written for a fresh implementation context on branch
`fix/issue-18-restore-codex-continuation`.

## Current checkpoint

- Repository: `agentic-delivery-lab/agentic-delivery`
- Source issue: [#18](https://github.com/agentic-delivery-lab/agentic-delivery/issues/18)
- Related waiting source issue: [#17](https://github.com/agentic-delivery-lab/agentic-delivery/issues/17)
- Branch: `fix/issue-18-restore-codex-continuation`
- Base: `main` at `43bcbb64ec43bc56dc659599fece611327528723`
- Working tree was clean when this branch was created.
- No repository files had been changed for this handoff at intake.
- Use `gpt-5.6-luna` with `reasoning_effort = max` for implementation. In
  repository language this is “Luna Max”.

The historical #17 and #18 delivery runs used `thread/start` with
`ephemeral: true` and did not persist a Codex session UUID. They cannot be
resumed exactly. The implementation must add persistent sessions and perform a
one-time, explicitly recorded context reconstruction for those legacy states.

## Evidence

- [Run 34313589420](https://github.com/agentic-delivery-lab/agentic-delivery/actions/runs/34313589420)
  started issue #17, reached clarification, posted a continuation, and ended
  with exit code 1.
- The owner’s answer on #17 created
  [run 34314255009](https://github.com/agentic-delivery-lab/agentic-delivery/actions/runs/34314255009),
  but its `deliver` job was skipped because the workflow only accepted comment
  bodies beginning with `/codex resume`.
- [Run 34315950838](https://github.com/agentic-delivery-lab/agentic-delivery/actions/runs/34315950838)
  started issue #18 and stopped because quota telemetry became unavailable.
  That is a separate fail-closed budget-boundary event.
- The runner service is active as `github-runner`. Its state and Codex home are
  intentionally unreadable to the interactive user, so the available session
  evidence is the GitHub audit trail, Actions logs, systemd service log, and
  checked-in implementation.
- The existing 103-test suite passes, but its intake tests encode the broken
  command-only behavior and its client always starts ephemeral threads.

## Objective

Make the existing issue-driven delivery run continue the exact source issue
when the trusted repository owner posts a new issue comment, while preventing
bot feedback loops, pull-request comments, inactive issue starts, accidental
cross-issue resumes, and duplicate event execution.

Keep the existing Plan -> Implement flow, budget boundary, runner lock,
branch/publication controls, and human merge authority.

## Required implementation

### Workflow and trust boundary

- Keep `issue_comment: types: [created]`.
- Run the delivery job for normal issue comments only when the payload author
  is the repository owner. Exclude pull-request comments and bot comments in
  the job condition.
- Enforce the same rule in the controller using the comment payload’s user
  login and owner association. Do not use `GITHUB_TRIGGERING_ACTOR` as the
  comment identity.
- Preserve the existing issue-open and manual-dispatch entry paths.

### State and eligibility

- Version the persisted state and add a validated canonical `sessionId`.
- Add an explicit `awaiting-human` state, a waiting comment boundary, and
  consumed comment IDs while preserving existing phases and recovery files.
- A plain trusted owner comment may continue only an existing
  `awaiting-human` state.
- A bare `/codex resume` remains a recovery command for technical `paused`
  state and manual dispatch remains available.
- Missing, completed, running, stale, or inactive state must return without
  starting Codex or creating a new task.
- Preserve repository + issue + exact session correlation and reject invalid
  or mismatched saved state.
- Filter bot-authored comments from issue snapshots, in addition to using saved
  audit comment IDs, so an ambiguous bot post cannot change the planning digest.

### Codex session continuation

- Change new delivery threads to persistent (`ephemeral: false`).
- Save the returned thread UUID before the first model turn.
- Resume later runs with `thread/resume` using that exact UUID. Never use
  `codex resume --last`, a global newest-session lookup, or silent fallback to a
  new thread.
- Feed the accepted human comment directly to the resumed turn, together with
  the saved issue brief, progress, plan, tasks, and validation context.
- If the UUID is missing or cannot be resumed, fail as a technical error and
  retain state for inspection.
- For legacy #17/#18 state without a UUID, create one persistent replacement
  thread once, record that reconstruction in the audit trail, and use only the
  new UUID thereafter.

### Outcome and recovery communication

- Treat `awaiting-human` as an intentional boundary and exit the Actions job
  successfully.
- Keep genuine technical failures, including unavailable quota telemetry,
  failed session recovery, corrupt state, and repository failures as failures.
- Every waiting handoff must show the same persisted UUID in all locations:

  ```text
  Codex session ID: <UUID>
  Continuation state: awaiting-human
  Issue: #<number>
  Manual recovery: codex resume <UUID>
  ```

- Record a consumed event key before allowing duplicate delivery to execute the
  same comment twice. Reject comments at or before the recorded waiting
  boundary.

## Documentation and domain work

Update the workflow/controller documentation, continuation task documentation,
`CHANGELOG.md`, and the affected domain register terms in the same change.
Amend ADR-0009 as a provisional decision on this branch; use issue #18 as its
ADR tracking issue. Do not create a second architecture decision record.

Use the `agentic-delivery-governance` vocabulary: source issue, delivery run,
continuation prompt, provisional decision, and the new explicit continuation
state/session concepts where the register requires them.

## Verification

Add or update tests for:

1. trusted owner comments, bots, non-owner writers, rerun actors, pull-request
   comments, inactive issues, technical `/codex resume`, and manual dispatch;
2. persistent thread start, exact thread resume across app-server processes,
   UUID mismatch, missing storage, and no fallback;
3. issue/session isolation, legacy state migration, stale comments, duplicate
   events, and bot snapshot filtering;
4. successful `awaiting-human` completion versus technical failure exit codes;
5. exact session ID and manual recovery text in issue handoffs.

Run the full repository test suite and the repository’s ADR, domain-language,
changelog, configuration, dependency, branch, and commit checks. Extend the
self-hosted smoke check with a no-generation persistent-thread start/resume
probe if the pinned CLI supports it without consuming model quota.

After the fix is merged, post a new owner comment on #17 because GitHub will
not replay its already-skipped event. Confirm that the action runs, the legacy
state receives one persistent session UUID, the owner’s answer reaches Codex,
and automated comments do not create a recursive loop. Resume #18 through
manual dispatch or `/codex resume` only after quota telemetry is healthy.

## Non-goals

Do not implement the broader issue intake/classification/routing harness,
multi-agent communication, reviewer/validator/auditor agents, or a generic
workflow engine.

Do not merge a pull request, close either source issue, bypass review, switch
accounts, add credits, or weaken the budget boundary.

## Fresh-context instruction

The fresh agent must read `AGENTS.md`, this handoff, the source issue, the
domain register, ADR-0009, `.agents/codex-delivery.md`, and the current
workflow/controller/client/loop/tests before editing. Treat this file as the
approved implementation plan and preserve the branch and issue correlation.

## Implementation checkpoint

The approved continuation plan is implemented on
`fix/issue-18-restore-codex-continuation` without changing the issue or branch
correlation. The implementation keeps the existing Plan -> Implement flow and
budget boundary while adding:

- trusted repository-owner comment intake with pull-request and bot exclusion;
- versioned continuation state with an exact persistent Codex session UUID;
- explicit `awaiting-human` and technical `paused` outcomes;
- waiting comment boundaries and consumed event IDs;
- exact `thread/resume` recovery, direct owner-comment input, and one-time
  legacy session reconstruction; and
- bot-filtered issue snapshots, human-facing recovery text, and the amended
  provisional ADR-0009 tracked by issue #18.

The focused continuation, client, loop, intake, and controller tests pass. The
full 121-test repository suite and ADR, domain-language, changelog,
configuration, dependency, branch, and whitespace checks pass. The pinned
Codex 0.153.4 preflight starts a persistent thread without a model turn; it
records that exact resume is unavailable until the first model rollout rather
than consuming generation quota. Do not merge the review pull request or close
source issues without explicit human authorization.
