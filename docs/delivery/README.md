# Delivery workflow

For automated intake, planning, implementation, and continuation, see the
[Codex source issue workflow](codex-workflow.md). GitHub Free does not enforce
branch protection for this private repository; human review and merge authority
remain repository policy.

Pull requests are also checked by the layered [Harness Architecture Review](../architecture/harness-conformance-review.md).
Its deterministic result is the only architecture-review failure gate; its
semantic findings and missing runtime evidence are advisory and must cite their
sources.

This guide describes how people and coding agents move a change through the repository's trunk. It complements [ADR-0004](../decisions/0004-use-trunk-based-delivery.md), [ADR-0005](../decisions/0005-use-conventional-commits-with-gitmoji.md), [ADR-0006](../decisions/0006-curate-a-changelog.md) and [ADR-0007](../decisions/0007-use-issue-linked-conventional-branch-names.md).

## Issue intake and routing

Issues enter through organization defaults, repository-local forms during the
migration window, or the enabled blank-issue fallback. A read-only routing
model interprets each eligible issue or human comment in context and proposes
an issue type, lifecycle stage, readiness value, governance metadata, and
orchestration pattern. Deterministic code validates the proposal against
`.github/issue-metadata.yml`, `.github/orchestration-policy.yml`, and the
transition rules before applying it. It does not assign intent from title
words, form headings, keywords, or regular expressions.

The organization-wide taxonomy is: Idea, Research, Feature, Bug, Task,
Requirements, Architecture Decision, Implementation, and Validation. Native
GitHub Issue Types are the durable classification. Existing `type:*` labels
are read-only migration evidence and are removed only after a native type is
observed or explicitly assigned.

`Lifecycle Stage` is a small pinned single-select field with Intake, Discovery,
Definition, Decision, Planning, Execution, Validation, Acceptance, Done, and
Parked. `Delivery Readiness` is a separate pinned field for temporary gates
such as Needs information, Ready, Working, Waiting, Awaiting human, or
Blocked. Governance labels such as `adr:needed`, `security-review`, and
`human-review` remain orthogonal controls. The runner's resumable execution
state is stored separately in its protected per-issue state directory.

The lifecycle is not a mandatory waterfall. An Idea may use discovery and
optional research; Research can finish with evidence; Requirements can mature
without code; Architecture Decision work follows the ADR process; Validation
can run independently; and a lineage root can coordinate child outcomes.
Fresh implementation work uses Plan → Implement only when no valid plan
exists. A valid existing plan invokes the implementer directly, and an
unchanged execution continuation resumes the exact saved GPT-5.6 Luna Max
session without planning again. A scope-changing comment invalidates the plan
and returns to the appropriate requirements, research, architecture, or
planning route.

The intake workflow only hands a deterministic, field-authorized pattern to
`codex-delivery`. Missing optional capabilities produce an explicit degraded or
held route. Metadata changes are idempotent and do not recursively trigger
delivery. A failed Action or Codex session does not advance the Lifecycle Stage.
The deterministic readiness gate checks the selected issue type, fields,
governance controls, dependencies, and orchestration policy before an operation
can proceed.

## Package manager and local preflight

This repository uses the exact pnpm version declared by the `packageManager`
field in `package.json`. The pin selects a version; it does not install pnpm.
Node.js 24 or newer is required for the repository and for the documented
bootstrap path.

If pnpm is not installed, use the official cross-platform one-time bootstrap:

```text
npx get-pnpm 12.3.4
```

This is the only supported `npm`/`npx` exception after the migration. Optional
exact-version standalone alternatives are:

```sh
curl -fsSL https://get.pnpm.io/install.sh | env PNPM_VERSION=12.3.4 sh -
```

```powershell
$env:PNPM_VERSION="12.3.4"; Invoke-WebRequest https://get.pnpm.io/install.ps1 -UseBasicParsing | Invoke-Expression
```

Before the first supported repository command, run:

```text
node scripts/validate-toolchain.mjs
```

The preflight checks the exact pnpm executable, the repository lockfile and the
strict 2,880-minute release-age policy. Run `pnpm --version` and make sure it
reports `12.3.4` before continuing.

The delivery workflow includes an internal Linux/macOS/Windows portability
matrix. Local tooling support for all three platforms is confirmed only after
that matrix has completed successfully; the dedicated self-hosted runner smoke
check remains intentionally Linux-specific.

Install dependencies with the single authoritative lockfile and with lifecycle
scripts disabled:

```text
pnpm install --frozen-lockfile --ignore-scripts
```

## Trunk-based flow

`main` is the trunk and the official source of truth. Start a short-lived feature branch from the current `main`. Keep it for no more than two calendar days. The feature branch must be the head of a review pull request whose base is `main`; never open a pull request from `main`.

Keep each increment small, test it and commit it. Use a feature flag or another reversible boundary when incomplete work must be integrated. Do not create a permanent `develop` branch for ordinary work. Approved pull requests use merge commits. Only an explicitly authorized human merges a review pull request or closes its source issue.

## Issue-linked branch names

Start supported work with `pnpm branch:start <type> <issue-number> <summary>` from a clean, synchronized `main`. The command checks the source issue before creating the branch. The issue must be open and must be a GitHub Issue in this repository; an open pull request with the same number is not valid.

Change branches use this form:

```text
<type>/issue-<number>-<lowercase-kebab-case-summary>
```

The type is one of `build`, `chore`, `ci`, `docs`, `feat`, `fix`, `perf`, `refactor`, `revert`, `style` or `test`. Use `pnpm lint:branch <branch-name>` to check an existing candidate. CI repeats both the branch syntax and open-issue checks when an internal pull request is opened or updated.

The supported `pnpm test`, `pnpm branch:start`, `pnpm lint:branch` and
`pnpm lint:commits` commands run the same dependency-free preflight through
their package lifecycle hooks. A mismatched or missing pnpm executable stops the
command before its command body runs.

## Commit messages

New non-merge commits use this form:

```text
<type>[optional scope][optional !]: <gitmoji> <description>
```

For example: `docs(delivery): 📝 explain the branch boundary`. The Gitmoji is an official Unicode character or shortcode from the pinned catalogue. The prefix comes first to preserve Conventional Commits tooling; this ordering is the repository's explicit local mapping of the Gitmoji convention.

`@commitlint/cli` checks the Conventional Commit grammar. `scripts/validate-gitmoji.mjs` checks the Gitmoji token. Pull-request titles and all non-merge commits in the pull-request range are validated. Existing historical commits are not rewritten. Structural validation does not decide whether the type or Gitmoji truthfully describes the change; reviewers do that semantic check.

## Changelog

Maintain the root [`CHANGELOG.md`](../../CHANGELOG.md) as a curated document for people. Put current work under `[Unreleased]`, using `Added`, `Changed`, `Deprecated`, `Removed`, `Fixed` or `Security` when a category has an entry. Describe impact rather than copying commit subjects. Put released sections below `[Unreleased]`, newest first, with an ISO date and a Semantic Versioning value.

Do not invent a release, tag or version for unreleased work. Creating a release is a separate human-authorized action. A changelog validator checks structure; reviewers decide whether entries are relevant and accurately describe impact.

## What automation checks

CI checks the issue-linked branch name and source issue before dependency installation, then checks the branch's commit range, pull-request title, changelog structure, ADR and domain-language contracts, Markdown/YAML/JSON syntax and dependency audit findings. On pushes to `main`, CI reports any first-parent commit that is not a merge commit.

Automation checks structure and syntax. Agents and human reviewers still check branch age, intent, semantic version impact, changelog relevance, domain meaning, external names and authorization boundaries.

## Sources and local mappings

- [Trunk Based Development](https://trunkbaseddevelopment.com/) informs the single-trunk and short-lived-branch model. The two-day target and merge-commit policy are local rules.
- [Conventional Commits 1.0.0](https://www.conventionalcommits.org/en/v1.0.0/) defines the commit prefix grammar.
- [`@commitlint/config-conventional`](https://github.com/conventional-changelog/commitlint/tree/master/%40commitlint/config-conventional) supplies the lint rules.
- [GitHub CLI issue view](https://cli.github.com/manual/gh_issue_view) supplies the local open-issue check.
- [GitHub REST API issue endpoint](https://docs.github.com/en/rest/issues/issues#get-an-issue) supplies the authenticated Actions check.
- [Gitmoji](https://gitmoji.dev/) supplies the intention catalogue. This repository places its token after the Conventional Commit prefix so both conventions remain usable.
- [Keep a Changelog 1.1.0](https://keepachangelog.com/en/1.1.0/) defines the human-readable changelog structure.
- [Semantic Versioning](https://semver.org/) defines release version meaning.
