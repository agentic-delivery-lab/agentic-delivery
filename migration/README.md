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

Run the deterministic check before preparing a history-filtered import:

```text
pnpm migration:check
```

The filter operation itself remains an operator action. It must use the
approved `git-filter-repo` version, a reviewed path specification, an
immutable source commit, and a source-to-result commit map. The check does not
rewrite history and does not create a remote repository.
