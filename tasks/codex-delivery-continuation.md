# Continue source issue #15

This change is unfinished and must remain a draft review pull request. The
implementation session is wrapping up near the shared five-hour Codex limit,
as requested. Do not activate the workflow or claim end-to-end operation yet.

## Latest checkpoint after the reset

Draft PR: [#16](https://github.com/sjefsharp/agentic-delivery/pull/16).
The latest measured five-hour usage is 94 percent; weekly usage is 43 percent.
No fresh chat is required: this file supports compaction or a new session.
The newer evidence and priorities below supersede the original checklist.

- The current local full suite passes all **81 tests**. Earlier PR CI passed
  on Linux, macOS, and Windows; rerun checks for this checkpoint.
- The checksum-pinned official Codex 0.153.4 package installed successfully as
  `github-runner` in [smoke run 34160939468](https://github.com/sjefsharp/agentic-delivery/actions/runs/34160939468).
  Executable: `/opt/actions-runner/_work/_tool/codex-delivery/0.153.4/bin/codex`.
  App-server then exited. Rerun the updated smoke workflow with `codex=true`:
  preflight now checks login status first. The same release package starts
  locally. A service-account device login may need a human; passwordless sudo
  is unavailable here. Never copy personal credentials.
- `node scripts/codex-sandbox-check.mjs` passes real filesystem, environment,
  child-process output, and denied external-network probes for all three
  model/test profiles. Frozen install passes with the npm allowlist enforced.
- Runtime findings: grant only the canonical systemd resolver target for DNS;
  inherited temporary-directory deny rules hid read-only workspaces; plain
  `network=false` seccomp broke Node child-process sockets. Managed proxy mode
  preserves IPC, but **requires `features.network_proxy=true`**. Domain rules
  alone did not enforce egress. The runtime probe caught this before activation.
- A separate-model review found six blockers. Changes now split permissions,
  isolate the tool home, reject unsafe config, use trusted branch and validator
  helpers, guard publication metadata, checkpoint branch/publication, flush
  outbox before deduplication, and await process-group termination. These
  controller changes are not yet integration-tested or fully reviewed.

### First work after the next reset

1. **Stop-the-line runtime failure:** the full suite fails under the enforced
   managed proxy in the mock-registry tests in
   `tests/delivery/package-policy.test.mjs`. The earlier sandbox full-suite
   pass was before proxy enforcement and is not valid safety evidence.
   Investigate process-local loopback/NO_PROXY inside the isolated namespace;
   do not grant host-local or unrestricted external networking.
   Reproduction workspace: `/tmp/codex-delivery-verification.w7fxK7/workspace`
   (76-test checkpoint). Use CodexClient.exec with `delivery-deps` for frozen
   install and `delivery-verify` for tests. Run individual test files directly
   with Node for detailed failures. Verify audit and trusted validators too.
2. Add isolated controller integration tests before further publication work.
   Test branch and publish-only recovery, source closure, failed outbox writes,
   repeated events, quota pauses, cancellation, stale locks, and shutdown with
   descendants. A durable verify phase and audit-write serialization still
   need review. Simplify the new large controller conditional.
3. Recheck effective thread config, MCP/plugins/hooks, symlink escapes, exact
   staged-tree verification, metadata references, and dedicated login setup.
4. Rerun runner smoke, then validate a tiny actual Sol High Plan-mode outcome
   and Luna Max handoff. No model turn has been tested yet. Resolve the sandbox
   failure first; no end-to-end activation, merging, or issue closure is authorized.

Continue with the original checklist below after these priorities.

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
