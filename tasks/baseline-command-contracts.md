# Issue #12 baseline command contracts

This document records the command behavior observed before the pnpm and
portable-tooling migration. It is the compatibility baseline for Issue #12.
The commands and file names in the baseline tables are historical evidence;
use the current pnpm and `.mjs` commands in [`docs/delivery/README.md`](../docs/delivery/README.md)
for new work.

## Baseline context

- Source issue: [Issue #12](https://github.com/agentic-delivery-lab/agentic-delivery/issues/12)
- Baseline commit: `ce5c86c` (`main` and `origin/main`)
- Baseline date: 2026-09-06
- Node.js: `v26.7.0`
- npm: `11.19.0`
- Branch created for implementation: `feat/issue-12-pnpm-portable-tooling`
- Repository runner observed through the GitHub API: `omarchy-runner`, Linux,
  online and idle

The source issue was open in `agentic-delivery-lab/agentic-delivery` when the
implementation branch was created. The GitHub-hosted runner matrix is part of
the implementation and still requires a workflow run before cross-platform
support can be claimed.

## Baseline verification

The pre-migration commands completed successfully:

| Command | Result | Observation |
| --- | ---: | --- |
| `npm test` | 0 | All ADR, communication, domain and delivery tests passed. |
| `npm audit --audit-level=high` | 0 | `found 0 vulnerabilities`. |
| `npm run lint:branch -- feat/issue-12-pnpm-portable-tooling` | 0 | The implementation branch name is valid. |
| `./scripts/validate-adrs.sh .` | 0 | ADR records are sequential and linked. |
| `./scripts/validate-domain-language.rb .` | 0 | The canonical register is valid. |
| `./scripts/validate-changelog.rb .` | 0 | The changelog structure is valid. |
| `./scripts/validate-source-issue.sh 12` | 0 | Issue #12 is an open GitHub Issue. |

## Exit-code matrix

The repository uses these meanings throughout its validators:

- `0`: accepted input or successful command;
- `1`: valid invocation whose content, state or external validation failed;
- `2`: invalid invocation or missing local prerequisite/input.

| Command or entry point | Success | Content/state failure | Usage or local-input failure | Other guarded states |
| --- | ---: | ---: | ---: | --- |
| `npm test` and each test driver | 0 | 1 when an assertion or test command fails | shell/runtime status when the test runner cannot start | The current drivers require Bash and some require Ruby. |
| `scripts/validate-adrs.sh [root]` | 0 | 1; invalid/missing ADR structure | 2; more than one argument or missing root | No Git repository is required. |
| `scripts/validate-domain-language.rb [root]` | 0 | 1; invalid YAML or register content | 2; invalid arity, missing root or register | No Git repository is required. |
| `scripts/validate-changelog.rb [root]` | 0 | 1; invalid changelog structure | 2; invalid arity, missing root or `CHANGELOG.md` | No Git repository is required. |
| `scripts/validate-branch-name.sh <name>` | 0 | 1; name is outside the issue-linked grammar | 2; wrong arity | No repository state is inspected. |
| `scripts/validate-source-issue.sh <number>` | 0; open GitHub Issue | 1; closed issue, pull request number, unreadable API/CLI, invalid repository, missing CI token or unavailable GitHub prerequisite | 2; non-positive/non-numeric number or wrong arity | Local mode uses `gh`; Actions mode uses the REST API. |
| `scripts/start-issue-branch.sh <type> <number> <summary>` | 0; creates and switches to the issue-linked branch | 1; non-`main`/detached head, dirty tree, stale `origin/main`, invalid branch name or invalid source issue | 2; wrong arity or non-Git root | If `origin/main` is absent, the baseline preserves local-only success. |
| `scripts/validate-commit-range.sh <base> <head>` | 0; every non-merge commit passes | 1; Conventional Commit or Gitmoji validation failure | 2; wrong arity, invalid/non-ancestor commits, non-Git root or missing commitlint/configuration | A forty-zero base validates all non-merge commits reachable from the head. |
| `scripts/validate-gitmoji.mjs` (commit message on stdin) | 0; official merge subject or valid Gitmoji prefix | 1; malformed Conventional Commit/Gitmoji content | Not applicable; the command has no positional interface | Merge subjects are intentionally accepted without a Gitmoji. |

## Representative diagnostics

These messages are part of the baseline where tests or users rely on them:

| Situation | Representative diagnostic |
| --- | --- |
| Invalid branch-name invocation | `Usage: validate-branch-name.sh <branch-name>` |
| Invalid branch name | `Invalid branch name: <name>` followed by the expected grammar. |
| Detached branch start | `Branch start failed: start from the main branch, currently on detached HEAD.` |
| Dirty `main` | `Branch start failed: main has uncommitted changes.` |
| Stale `main` | `Branch start failed: local main is not synchronized with origin/main.` |
| Missing source issue | `Source issue check failed: issue #<number> could not be read in <repository>.` |
| Missing CI issue token | `Source issue check failed: GitHub Actions did not provide an issue-read token.` |
| Missing changelog | `Changelog check: missing CHANGELOG.md` |
| Missing ADR root | `ADR check: repository root does not exist: <path>` |
| Missing commit tooling | `Commit range check: required tooling is not installed or configured` |
| Invalid commit range | `Commit range check: base must be an ancestor of head` |

The migrated ESM commands must preserve the status classes and the meaning of
these diagnostics. Wording may only change where the runtime or path suffix is
necessarily different, and the focused tests must document that change.

## Failure classes exercised before migration

The existing focused test suite exercised valid input, content failures,
invalid arguments, missing changelog/root input, invalid YAML, invalid branch
names, closed and unreadable issues, missing Actions tokens, invalid commit
ranges, Conventional Commit/Gitmoji failures, dirty `main`, and successful
branch creation in isolated fixtures. The implementation branch was created
from a clean, synchronized `main`; no planning-branch files were renamed or
reused.
