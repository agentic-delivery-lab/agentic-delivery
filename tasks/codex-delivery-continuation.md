# Continue source issue #15

Draft PR: [#16](https://github.com/sjefsharp/agentic-delivery/pull/16).
Branch: `feat/issue-15-codex-issue-to-pr`.
Source and ADR tracking issue: [#15](https://github.com/sjefsharp/agentic-delivery/issues/15).

This implementation is not activated. Do not merge or close the source issue
without explicit human authorization. The latest measured five-hour usage was
92 percent; the session is saving work near its finalization reserve. A fresh
chat is optional: this record supports context compaction and later resumption.

## Verified work

- Pinned Codex CLI 0.153.4 setup succeeded on the self-hosted runner.
- The **real** Sol High Plan-mode to Luna Max implementation handoff passed
  locally. Sol did not write the target; Luna created and read back the exact
  requested file. Fixture: `/tmp/codex-delivery-handoff-vLG7rJ`.
- A failed earlier handoff exposed `environments: []`: it disabled filesystem
  tools. Both thread and turn now retain the default local environment under
  named permission profiles. A unit assertion guards this.
- Real sandbox probes pass for outside-file reads, protected Git/Codex paths,
  tool credential environment, child-process output, and denied direct access
  to both external hosts and runner-host loopback, even with proxy variables removed.
- Full sandboxed tests passed after two fixes: the trusted test wrapper uses
  a loopback-only NO_PROXY inside the isolated namespace; the lifecycle fixture
  reuses the locked pnpm resolution, avoiding a hidden network lookup.
- Twelve isolated controller integration tests cover normal publication,
  branch/commit/publication recovery, quota pauses, clarification/replanning,
  outbox recovery and ready-state deduplication, source closure, untrusted
  actors, stale locks, verification retries, and failed process shutdown.
- The local full suite passed 91 tests before the last two integration cases;
  the latest focused controller/loop/intake run passed all 23 tests. A final
  full sandboxed run, trusted validators, and audit are being recorded on #15.
- Existing PR CI passed on Linux, macOS, and Windows at checkpoint d6d5219;
  the latest pushed checkpoint requires its own CI result.

## Boundaries established by review

Use trusted controller code for branch creation and governance validation.
Model tools have a private temporary home, no publishing/API credentials,
protected Git metadata, and denied outbound access. Dependency installation
and audit allow only registry.npmjs.org and disable lifecycle/pnpm hooks.
Reject unsafe hooks, notifications, and custom model-provider configuration.
Validate model-owned metadata and keep issue-closing directives controller-owned.

The managed proxy requires `features.network_proxy=true`; domain declarations
alone did not enforce egress. Plain `network=false` seccomp broke Node child
process sockets. Canonical resolver read access and avoiding inherited broad
temporary-directory denials are also necessary on this runner's Linux setup.

Checkpoint phases are plan, branch, implement, verify, commit, and publish.
State writes are serialized. Stop the owned process group before commit,
verify the exact staged tree again, and retain the lock if shutdown cannot
be confirmed. Close the lock handle even when retaining the lock file.

## Remaining tasks

1. **Human prerequisite:** runner smoke [34177945270](https://github.com/sjefsharp/agentic-delivery/actions/runs/34177945270)
   confirmed missing service-account ChatGPT login. The user was asked to run:

   ```bash
   sudo -H -u github-runner /opt/actions-runner/_work/_tool/codex-delivery/0.153.4/bin/codex login --device-auth
   ```

   Do not copy personal credentials or request device codes. Passwordless
   sudo is unavailable to this session. Rerun the smoke workflow on this branch
   with `codex=true` after the user confirms login.
2. Review the final controller changes after integration coverage, including
   actual cancellation/descendant termination, configuration isolation,
   credit-spillover assumptions, source-change handling, and state corruption.
   The prior separate-model review predates these fixes.
3. Check latest full tests, trusted validators, dependency audit, Markdown,
   commit/title checks, and all three CI platforms. Update source issue and PR.
4. Verify runner capabilities, sandbox prerequisites, and model access under
   the service account. The local successful handoff does not prove runner auth.
5. Resolve the repository setting allowing Actions to create PRs; it remains
   disabled. Keep human workflow approval for GITHUB_TOKEN-created PR CI and
   human-only merging. GitHub Free cannot enforce private branch protection.
6. Only after the above, ask for human merge authorization. After authorized
   merge activates the issue workflow, demonstrate a small end-to-end issue
   and review PR on the actual runner. Do not call the workflow operational
   until that evidence exists.

## Follow-up prompt

Continue source issue #15 in sjefsharp/agentic-delivery on
feat/issue-15-codex-issue-to-pr. Read this record, the issue comments, AGENTS.md,
applicable repository skills, the domain register, and provisional ADR-0009.
Preserve existing work. Check current subscription quota first and throughout;
stop before exhaustion, saving tasks and this continuation without another
model call. No paid fallback, credits, quota resets, or model substitution.
The required sequence is actual Sol High Plan mode, then Luna Max. The local
handoff and sandbox probes now pass; runner login is missing. Finish the
remaining verification and review, update draft PR #16, and retain human
authority for merge and source-issue closure.
