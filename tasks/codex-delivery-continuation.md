# Continue source issue #15

Review pull request: [#16](https://github.com/sjefsharp/agentic-delivery/pull/16).
Branch: `feat/issue-15-codex-issue-to-pr`.
Source and ADR tracking issue: [#15](https://github.com/sjefsharp/agentic-delivery/issues/15).
Reviewed code checkpoint: `fc468fc` (2026-09-08).

The workflow is not activated until its authorized merge to `main`. The code
and pre-merge verification are separate from proving a live issue-to-PR run.
Do not merge or close the source issue without explicit human authorization.
Read current quota on resumption; a saved percentage is not a current budget.
A new chat is optional because this record supports context compaction.

## Verified work

- All 103 tests pass locally and inside the actual tool sandbox. Sixteen
  controller integration cases use real temporary Git repositories with fake
  GitHub and model boundaries. They do not claim a live issue-to-PR run.
- Toolchain, ADR, domain-language, changelog, configuration, branch, and commit
  checks pass. Dependency audit reports no known vulnerabilities.
- The real local Sol High Plan-mode to Luna Max handoff passed, including
  checking that Sol did not write and Luna produced the requested file.
  Fixture: `/tmp/codex-delivery-handoff-vLG7rJ`.
- Local tool probes pass for protected files, private tool environment,
  child-process output, and denied external and runner-host network access.
  Latest fixture: `/tmp/codex-delivery-boundary-bNereW`.
- A separate zero-generation process probe confirmed that client shutdown
  stops both the app-server leader and a SIGTERM-resistant descendant.
- Runner login is complete. Earlier smoke
  [34268627089](https://github.com/sjefsharp/agentic-delivery/actions/runs/34268627089)
  passed as `github-runner` with pinned Codex 0.153.4, ChatGPT authentication,
  exact models/efforts, Plan mode, and named permission profiles. It did not
  execute a model turn or check tool isolation.
- The updated smoke
  [34275454928](https://github.com/sjefsharp/agentic-delivery/actions/runs/34275454928)
  passed as `github-runner`, including authentication, credit/quota checks,
  exact model capabilities, and all three actual tool-isolation profiles.
  It started no model turn. Fixture: `/tmp/codex-delivery-boundary-DiOqdL`.
- Latest code-checkpoint CI:
  [delivery and portability](https://github.com/sjefsharp/agentic-delivery/actions/runs/34275417022)
  and [ADR checks](https://github.com/sjefsharp/agentic-delivery/actions/runs/34275416973).
  Both passed, including Linux, macOS, Windows, Markdown, and security checks.
  Inspect the current PR head checks again before merge.
- Actions PR creation is enabled. A read-back verified
  `can_approve_pull_request_reviews=true` and
  `default_workflow_permissions=read`. GitHub bundles creation and approval
  in one setting; this controller never approves or merges PRs.

## Review findings and corrections

Regression tests reproduced and now guard these failures:

- JSON credentials, multiline values, truncated stderr, and protocol errors
  bypassed diagnostic redaction. Only fixed safe hints are now published.
- Credit availability was not checked. Model work now pauses on available or
  unlimited credits, or missing credit telemetry, as well as the 98-percent
  quota boundary. Do not add credits or enable automatic recharging mid-run.
- Resumed work could miss changed requirements or discussion. Source snapshots
  now return changed input to planning, preserving files. Controller audit
  comments and bare resume commands do not invalidate the plan.
- Invalid saved state could be overwritten during error handling. It is now
  validated before assignment and preserved for operator inspection.
- A clean replacement commit could bypass the verified-tree check during a
  publication retry. Publication now checks that tree again.

Correction to the earlier audit: run `34266716565` exposed only a generic
app-server exit. Run `34268127815` captured the missing `default_permissions`
diagnostic. The controller supplied named profiles without a default. We did
not inspect the service account configuration, so blaming that file was not
supported. Commit `30829c9` supplied the required safe default.

The first push of the review fixes had an overlong commit-message body line.
Only that new message was corrected with an exact-head lease. The tested files
were unchanged, and history before this checkpoint was preserved. `fc468fc`
is the surviving review-fix commit.

## Remaining acceptance work

1. Confirm the latest runner smoke and all PR checks are green. Inspect any
   failure before activation; do not weaken a check to obtain a green run.
2. Obtain human review and explicit merge authorization. Use a merge commit,
   never squash, rebase, or auto-merge. The PR contains `Closes #15`, so its
   merge also closes the source and ADR tracking issue. ADR-0009 remains
   provisional until that merge.
3. After merge, confirm the pilot preview below before creating its issue.
   Recheck open issues first to avoid duplicates. Do not create a replacement
   for an inaccessible issue. Do not reopen #15 without authorization.
4. Observe the real opened-issue trigger on `omarchy-runner`, Sol High Plan
   mode, Luna Max implementation, source-issue audit, validation, branch push,
   and review PR creation. Review generated workflow/test changes before
   approving any requested PR workflow execution. Record links and results on
   the pilot and #15. Do not merge the pilot PR without separate authorization.
5. If the pilot pauses, read its continuation and preserve its workspace.
   Answer questions or wait for quota reset, then use `/codex resume`. Inspect
   any retained account lock and owned processes before removing that exact
   lock. Do not delete issue workspaces to clear a lock.

Review PR CI runs code directly as the service account, outside the model-tool
sandbox. Repository write access and human workflow approval remain trust
boundaries. GitHub Free does not enforce private branch protection here.

## Proposed pilot issue preview

Title: Add examples for free-form source issue intake

Assignment: Add three short examples to `docs/delivery/codex-workflow.md`: an
idea, a concrete set of requirements, and a decision needing clarification.
For each, explain the expected intake outcome. Include answering questions
on the source issue and using `/codex resume` where needed. Use existing
repository documentation as the reference; do not introduce new workflow
behavior, dependencies, credentials, domain terms, or architectural decisions.
Update the curated changelog if appropriate. Link the pilot to #15 and PR #16.

Acceptance criteria: the examples use plain English and preserve exact model
settings, the budget boundary, and human merge authority. Repository tests
and documentation checks pass. The delivery run creates one issue-linked
review PR with a plan and progress on its source issue. Neither the controller
nor the observing agent merges that pilot PR.

This preview is not yet a created issue or permission to merge.

## Follow-up prompt

Continue source issue #15 and PR #16 in sjefsharp/agentic-delivery. Read this
record, the latest issue comments, AGENTS.md, applicable skills, the domain
register, and ADR-0009. Preserve existing work. Check current subscription
quota first and throughout; stop before exhaustion and save tasks and the
continuation without another model call. No credits, resets, API fallback,
account switching, or model substitution. The required workflow sequence is
actual Sol High Plan mode followed by Luna Max implementation. Runner login
is complete, and the review fixes, 103 tests, cross-platform CI, and expanded
runner smoke pass. Verify current evidence. Respect the human merge and issue-creation
confirmations, then perform the proposed live pilot when authorized. Do not
call the original workflow operational until the live issue-to-PR evidence
exists. No new chat is required solely because context was compacted.
