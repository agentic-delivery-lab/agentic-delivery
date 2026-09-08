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
- Enable **Allow GitHub Actions to create and approve pull requests** in
  repository Actions settings if using `GITHUB_TOKEN` to create review PRs.
  The controller creates PRs but never approves them. The repository currently
  has this setting disabled; enabling it is an activation prerequisite.

Run `self-hosted-runner-smoke` with input `codex=true` for a check without a
model turn. The setup step supplies the executable without copying
authentication. Complete the device login as `github-runner`, using the
file-backed store above, and rerun the smoke check before claiming end-to-end
operation. The Linux package setup is runner infrastructure; local governance
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
Saved phases distinguish planning, branch creation, implementation,
verification, commit, and publication. Commit/publication retries do not start
a model or require available generation quota. Implementation questions return
to planning while retaining the existing branch and work. The controller stops
owned processes before committing and checks the verified tree again.

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
