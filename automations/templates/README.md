# Preview automation templates

This directory is reserved for verified VS Code/Copilot shareable
`*.automation.md` templates. The feature is preview/gradual-rollout and its
schema is not a lifecycle contract. Do not add a template until the exact
supported frontmatter and client behavior have been verified against the
currently used Microsoft/VS Code implementation and recorded in the tooling
lock.

When a template is admitted, keep its source here and publish only a reviewed
projection through Distribution. Local schedule, provider/model selection,
permissions, enabled state, and run history remain client-local; GitHub Issues,
Projects, Actions, and the Control Plane remain the authoritative delivery
surfaces.
