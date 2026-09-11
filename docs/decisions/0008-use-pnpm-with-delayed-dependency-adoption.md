---
date: 2026-09-06
source-issue: https://github.com/sjefsharp/agentic-delivery/issues/12
decision-makers: Sjef Jenniskens
consulted: None
informed: None
domains:
  - agentic-delivery-governance
required-enforcement:
  - deterministic
---

# Use pnpm with delayed dependency adoption and Node.js automation

## Context and Problem Statement

Issue [#12](https://github.com/sjefsharp/agentic-delivery/issues/12) asks the
repository to adopt pnpm, reject dependency releases younger than 48 hours,
and make repository-owned validation tooling portable across Windows, macOS
and Linux. Before this proposal, the repository used npm, one npm lockfile,
Bash test drivers, five Bash scripts and two Ruby validators. Its quality
workflows also installed and audited through npm.

The affected bounded context is `agentic-delivery-governance`. The relevant
registered terms are `source issue`, `ADR tracking issue`, `architecture
decision record`, `provisional decision`, `official decision`, `review pull
request`, `agentic primitive`, `short-lived feature branch`, `issue-linked
branch name`, `changelog` and `main branch`. `pnpm`, `minimumReleaseAge`, Node.js
ESM and package manager are external technical names, not new domain concepts.

The repository must also preserve one explicit infrastructure boundary: the
dedicated self-hosted runner smoke check verifies a Linux/Omarchy runner. Local
governance commands and their tests may claim support for Windows, macOS and
Linux only after the hosted-runner matrix provides evidence on all three.

## Decision Drivers

- Prevent a newly published dependency from entering the repository before a
  48-hour observation period has elapsed.
- Keep one authoritative, reproducible dependency lockfile and disable
  dependency lifecycle scripts during CI installation.
- Make repository-owned validation commands usable with Node.js 24 or newer on
  Windows, macOS and Linux.
- Preserve existing command interfaces, diagnostics and exit-code classes
  while replacing platform-specific implementations.
- Keep the self-hosted Linux runner boundary explicit rather than hiding an
  infrastructure assumption inside portable tooling.
- Make the package-manager choice and its security rationale traceable beside
  the implementation.

## Considered Options

### Keep npm and the current Bash/Ruby tooling

Keep `package-lock.json`, npm scripts, Bash entry points and Ruby validators.
This has the smallest immediate migration cost but does not provide the
requested release-age policy or portable local validation.

### Adopt pnpm and the 48-hour policy but retain platform-specific tooling

Move dependency installation and policy enforcement to pnpm while keeping the
Bash and Ruby scripts. This improves supply-chain controls but leaves
contributors dependent on POSIX shell and Ruby, so the repository still cannot
provide the requested local platform independence.

### Adopt pnpm and migrate local automation to Node.js ESM

Use an exact pnpm 12 `packageManager` pin, `pnpm-lock.yaml`, and root pnpm
settings with `minimumReleaseAge: 2880`, strict enforcement and fail-closed
handling for missing registry timestamps. Set `trustLockfile` to its secure
default of `false`. Replace repository-owned Bash and Ruby validators and test
drivers with explicit `.mjs` entry points and Node.js `node:test`. Keep the
Linux/Omarchy smoke check as the documented infrastructure exception.

This option is the recommended outcome.

### Adopt pnpm plus shell-compatibility helper packages

Use command-wrapper packages to imitate shell behavior from JavaScript while
retaining the existing Bash and Ruby program logic. This reduces some process
invocation differences but leaves the substantial validator logic in
platform-specific runtimes and adds dependencies whose only purpose is to
preserve the old implementation.

## Decision Outcome

Chosen option: **Adopt pnpm and migrate local automation to Node.js ESM**,
because it combines the requested dependency-age control with a small,
standard-runtime implementation boundary and preserves the repository's
existing governance behavior.

The implementation will:

1. Pin an exact pnpm 12 release through `packageManager` and commit only
   `pnpm-lock.yaml`.
2. Configure `pnpm-workspace.yaml` with `minimumReleaseAge: 2880`,
   `minimumReleaseAgeStrict: true` and
   `minimumReleaseAgeIgnoreMissingTime: false`, with no initial exclusions.
3. Keep `trustLockfile` at its secure default of `false` so policy checks are
   applied to lockfile entries.
4. Add exact `yaml@2.9.0` as a development dependency for safe YAML parsing in
   the migrated validators.
5. Use a dependency-free Node.js toolchain preflight before each supported
   public command. It verifies Node.js, the manifest, the exact pnpm executable,
   policy settings and the lockfile before dependencies are required.
6. Use `npx get-pnpm <exact-packageManager-version>` only as the documented,
   one-time cross-platform bootstrap for contributors who have Node.js 24 or
   newer but no pnpm executable. The manifest pin selects a version; it does
   not install one.
7. Preserve the existing exit-code classes and command contracts while moving
   validators, tests and reusable workflow checks to Node.js ESM and argument
   arrays.
8. Run an internal pull-request matrix on GitHub-hosted Linux, macOS and
   Windows runners before claiming local tooling support for all three. Keep
   the self-hosted Linux/Omarchy smoke workflow as an infrastructure-specific
   check.

### Consequences

- Good, because dependency versions must age for 2,880 minutes before
  adoption, including transitive dependencies.
- Good, because missing registry publication timestamps fail closed instead of
  bypassing the age policy.
- Good, because one frozen pnpm lockfile and disabled install scripts make CI
  resolution and execution boundaries explicit.
- Good, because Node.js 24 or newer is already a repository requirement and is
  available on the target platforms.
- Good, because validators can use standard-library path, process, filesystem
  and HTTP APIs without shell interpolation or Ruby runtime behavior.
- Bad, because urgent dependency fixes may need to wait 48 hours; an exact
  reviewed exception is the only planned escape hatch and should be removed
  promptly.
- Bad, because contributors without pnpm need the documented bootstrap step
  before using supported repository commands.
- Bad, because the migration temporarily requires reviewers to compare the
  new ESM diagnostics and status behavior with the baseline contract.
- Neutral, because the dedicated runner remains Linux-specific by design.
- Neutral, because this ADR is provisional on the feature branch and becomes
  an official decision only after the review pull request is merged into
  `main`.

### Confirmation

- `package.json` contains an exact `packageManager` pin and supported public
  commands run the dependency-free toolchain preflight first.
- `pnpm-workspace.yaml` and focused package-policy tests verify the 2,880-minute
  policy, strict enforcement, fail-closed missing-time behavior and
  `trustLockfile: false` behavior.
- `pnpm install --frozen-lockfile --ignore-scripts` succeeds from a clean
  dependency directory and `pnpm audit --audit-level=high` passes.
- Each migrated validator has focused `node:test` coverage for success,
  validation failure and invalid-usage or missing-input behavior from the
  baseline command matrix.
- Repository contract checks reject obsolete npm lockfile, Bash and Ruby
  references outside the documented Linux smoke and one-time bootstrap
  boundaries.
- The internal portability matrix runs the preflight, one frozen install and
  the full test suite on GitHub-hosted Linux, macOS and Windows runners.
- Human reviewers confirm the affected `agentic-delivery-governance` terms and
  the Linux runner boundary remain semantically correct.

## Pros and Cons of the Options

### Keep npm and the current Bash/Ruby tooling

- Good, because there is no migration cost.
- Bad, because there is no strict release-age policy.
- Bad, because local validators retain Bash and Ruby runtime dependencies.

### Adopt pnpm and the 48-hour policy but retain platform-specific tooling

- Good, because dependency resolution gains the requested age policy.
- Good, because the validator migration can be deferred.
- Bad, because local governance commands remain platform-specific.
- Bad, because the repository would document portability that its tooling could
  not provide.

### Adopt pnpm and migrate local automation to Node.js ESM

- Good, because one already-required runtime covers local validation and tests.
- Good, because standard APIs make process arguments, paths and HTTP responses
  explicit across platforms.
- Good, because the migration can preserve behavior through focused tests.
- Bad, because the initial migration touches package, workflow, test and
  documentation contracts together.

### Adopt pnpm plus shell-compatibility helper packages

- Good, because some shell commands could be wrapped with less source change.
- Bad, because wrappers do not replace the Bash and Ruby program logic.
- Bad, because they add dependencies and a second portability abstraction for
  a repository that already requires Node.js.

## More Information

- Assignment brief and ADR tracking issue: [GitHub issue #12](https://github.com/sjefsharp/agentic-delivery/issues/12)
- Related decision: [ADR-0004](0004-use-trunk-based-delivery.md)
- Related decision: [ADR-0005](0005-use-conventional-commits-with-gitmoji.md)
- Related decision: [ADR-0006](0006-curate-a-changelog.md)
- Related decision: [ADR-0007](0007-use-issue-linked-conventional-branch-names.md)
- Domain register: [`ubiquitous-language.yml`](../domain/ubiquitous-language.yml)
- pnpm dependency-resolution settings: [pnpm documentation](https://pnpm.io/settings/dependency-resolution)
- pnpm setup action: [`pnpm/setup`](https://github.com/pnpm/setup)
- YAML parser: [`yaml`](https://eemeli.org/yaml/)
- Revisit this decision if the repository adopts another package manager,
  changes the Node.js minimum, or needs a different trust boundary for local
  governance tooling.
