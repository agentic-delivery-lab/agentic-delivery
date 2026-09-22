# Repository-boundary migration manifest

[`repository-boundaries.yml`](repository-boundaries.yml) is the checked-in
inventory for the staged repository split. It is deliberately not a runtime
participant registry and it does not create repositories or change GitHub
settings.

The manifest records the source paths to filter with history, the target
repository that becomes canonical, temporary compatibility bridges, and the
projection relationship for organization-level Copilot agents. A target with
no source paths starts new history; its generated artifacts must carry source
commit and content-digest provenance rather than fabricated history.

Target status is explicit: `pending` means extraction has not been prepared,
`local-prepared` means the filtered checkout and deterministic evidence exist
only in the local workspace, `transitional` means the current source still
serves as the operational bridge, `pending-entitlement` means a required
GitHub capability is unresolved, and `ready` is reserved for an operator-
verified target. `local-prepared` never implies that a remote repository,
branch protection, access, or publication exists.

GitHub-defined `.github` and `.github-private` surfaces are recorded in
[`special-surfaces.yml`](special-surfaces.yml), separately from domain
repository targets. The manifest distinguishes paths consumed by GitHub from
repository governance paths, states that workflow files are not inherited,
and prevents either special surface from becoming runtime state or a second
control plane.

Run the deterministic check before preparing a history-filtered import:

```text
pnpm migration:check
pnpm special-surfaces:check
```

The filter operation itself remains an operator action. It must use the
approved `git-filter-repo` version, a reviewed path specification, an
immutable source commit, and a source-to-result commit map. The check does not
rewrite history and does not create a remote repository.
