# Continue source issue #15

This change is unfinished and must remain a draft review pull request. The
implementation session is wrapping up near the shared five-hour Codex limit,
as requested. Do not activate the workflow or claim end-to-end operation yet.

## Saved work

- Source and ADR tracking issue: [#15](https://github.com/sjefsharp/agentic-delivery/issues/15).
- Branch: `feat/issue-15-codex-issue-to-pr`, based on synchronized `main` after
  the pnpm migration in ADR-0008.
- Codex client, explicit Sol High Plan mode and Luna Max handoff, quota checks,
  interruption, structured outcomes, and continuation generation are implemented.
- Issue-event workflow and controller save state, post an audit trail, create
  an issue-linked branch, attempt bounded repairs, and publish a review PR.
- Agent instructions, domain terms, operator documentation, and provisional
  ADR-0009 are present.
- Focused client, turn-loop, and intake tests pass. Full-suite verification is
  recorded in the source issue and draft PR.
- Local Codex 0.153.4 accepts permission profiles; sandboxed `node --version`
  and `pnpm --version` succeeded. No implementation model turn has been used
  to validate this workflow yet.

## Remaining tasks

1. Resolve the runner prerequisite. [Smoke run 34134284046](https://github.com/sjefsharp/agentic-delivery/actions/runs/34134284046)
   failed because the Actions service could not start `codex`. Confirm its
   executable path or install the reviewed pinned CLI for `github-runner`;
   verify ChatGPT authentication under that account. Do not copy a personal
   authentication file or publish credentials. A text question about the path
   is pending with the user.
2. Add controller integration tests with isolated Git repositories and fake
   GitHub/Codex boundaries. Cover successful publication, crash/restart,
   duplicate events, failed issue posting/outbox recovery, quota exhaustion,
   stale locks, source-issue closure, and publish-only retries.
3. Review and fix state transitions. In particular, recover if branch creation
   succeeds before the state phase is saved; avoid repeating implementation
   when only PR publication failed; ensure audit saves cannot race on shutdown.
4. Verify process-group termination before releasing the account lock. Confirm
   permission profiles deny credentials, outside-workspace reads, Git metadata
   writes, and model tool networking in actual execution. Check all configured
   hooks/plugins/MCP tools remain inside the intended boundary.
5. Test frozen pnpm install and all validation commands inside the verification
   sandbox. Only runtime version commands have been exercised so far; pnpm
   store/cache permissions may need explicit safe locations. Review whether
   network-enabled verification has the intended minimum access.
6. Validate an actual Sol High Plan-mode structured outcome and its Luna Max
   handoff on a small isolated fixture after quota reset. Include clarification,
   interruption, and continuation. Do not spend remaining allowance on this.
7. Review the final controller for security and correctness. Validate PR titles
   and all commits, Markdown, configuration, dependency audit, and full tests.
   Confirm generated changes cannot weaken trusted publication controls.
8. Enable Actions PR creation only when the concrete publication mechanism is
   ready. The repository currently disables it. Document the human approval
   requirement for `GITHUB_TOKEN`-created PR CI; do not bypass human merging.
9. Update this task record, source issue, and draft PR with evidence. Request
   human merge only when the implementation is ready; after authorized merge,
   demonstrate one small end-to-end issue and PR on the actual runner.

## Follow-up prompt

Continue implementation of GitHub source issue #15 in
`sjefsharp/agentic-delivery` on `feat/issue-15-codex-issue-to-pr`. Read the source
issue and its comments, this continuation file, AGENTS.md, the relevant skills,
domain register, and provisional ADR-0009. Preserve existing work. Resolve the
remaining tasks above, verify the complete workflow, and update the draft PR.
The user authorized issue creation and mandatory issue comments, immediate
intake for ideas/requirements/decisions, and a saved continuation near quota
exhaustion. They have not authorized merging or source-issue closure. Check
current subscription quota first and throughout the session; use no paid
fallbacks or reset credits. The workflow must use GPT-5.6 Sol High in actual
Plan mode, then GPT-5.6 Luna Max for implementation. The runner could not start
Codex in the last smoke test. Do not call the workflow complete until runtime
verification and the remaining controller tests support that conclusion.
