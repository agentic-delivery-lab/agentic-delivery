# Codex source issue workflow

The proposed workflow turns an open source issue into an implementation plan,
changes, validation, and a review pull request. Its decision is recorded in
[ADR-0009](../decisions/0009-run-codex-from-source-issues-with-a-budget-boundary.md).

## Start and resume

After the workflow is merged and prerequisites are verified, open an issue.
An idea, requirements, a decision, or a mixture is acceptable. The triggering
actor must have repository write permission. Codex starts with GPT-5.6 Sol High
in Plan mode and asks questions if the outcome is unclear. Answer on the
source issue, then comment `/codex resume`. GPT-5.6 Luna Max implements a
completed plan. The workflow records progress and validation on that issue.

Manual dispatch of `codex-delivery` with the source issue number also resumes
work. The same event is not processed twice; a new resume comment is an
explicit new attempt. The controller reuses saved changes and a single branch.
It never merges the review pull request or closes the source issue.

## Runner prerequisites

- A dedicated Linux runner with labels `self-hosted`, `linux`, `x64`, `omarchy`.
- Node.js and exact pnpm as defined in `package.json`; workflows use the pinned
  pnpm setup action and frozen installations with lifecycle scripts disabled.
- Codex CLI 0.153.4, installed by `scripts/setup-runner-codex.mjs` from the
  official Linux x64 package after SHA-256 verification. The dedicated tool
  cache keeps this installation separate from personal tools. The runner verifies
  both model/effort combinations, ChatGPT login, Plan mode, and quota telemetry.
- ChatGPT login for the installed `codex` executable
  under that user, `github-runner`. Another user's installation/login is not
  sufficient. Never commit or paste the authentication file into an issue.
- Persistent writable state, defaulting to `.codex-delivery` beside
  `RUNNER_WORKSPACE`. Set repository variable `CODEX_DELIVERY_STATE_DIR` to an
  absolute directory outside disposable checkouts if needed. Restrict access
  to the runner service user and back it up as operational data.
- Enable **Allow GitHub Actions to create and approve pull requests** in
  repository Actions settings if using `GITHUB_TOKEN` to create review PRs.
  The controller creates PRs but never approves them. The repository currently
  has this setting disabled; enabling it is an activation prerequisite.

Run `self-hosted-runner-smoke` with input `codex=true` for a check without a
model turn. The initial runner check failed because the Actions service could
not start Codex. The setup step now supplies the executable without copying or
changing authentication. Resolve login and rerun the smoke check before claiming
end-to-end operation. The Linux package setup is runner infrastructure; local
governance commands retain their separate cross-platform contract.

## Budget boundary and saved work

The controller checks all returned usage windows and stops at 98 percent
usage. It also stops if telemetry cannot be read. Five hours describes the
subscription window, not a permissible continuous job duration. Each model
turn has a 20-minute limit; each invocation has a 45-minute controller limit
inside a 55-minute Actions timeout. Validation repairs are capped at three.

Quota updates are not reservations. Other clients and in-flight requests may
consume the final reserve. There is no guarantee that arbitrary work completes
in one window. The controller never buys credits, consumes quota resets, or
switches billing or models to continue.

Each issue directory contains `state.json`, an append-only `audit.jsonl`, the
working tree, and `CONTINUE.md` after a pause. The continuation prompt and
remaining tasks are also posted on the source issue without another model
call. Answer open questions or wait for the reset, then `/codex resume`.

If issue posting fails, the outbox remains in state for another attempt. A
hard process kill may leave `account.lock`; inspect the referenced run and
confirm that no Codex process is still active before removing that exact lock.
Do not delete issue workspaces to clear a lock. Retain active state until the
review pull request is merged or the work is abandoned; archive or remove
completed state deliberately, according to the runner's retention policy.

## Review boundary

GitHub Free cannot enforce protected branches for this private repository.
The controller restricts its own publication to its recorded feature branch;
that is not protection against other credentials. Review PR CI triggered by
`GITHUB_TOKEN` can require **Approve workflows to run**. A human reviews the
source issue, changed files, and checks, and separately authorizes the merge.
