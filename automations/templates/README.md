# Preview automation templates

These are the Control Plane's canonical, reviewed source templates for VS
Code/Copilot shareable Automations. The feature remains preview and rolls out
gradually. The supported format is documented by [VS Code's Automation
documentation](https://code.visualstudio.com/docs/agents/run/automations) and
the [Agent Plugins automation-template
format](https://code.visualstudio.com/docs/agent-customization/agent-plugins).

The checked-in templates are deliberately manual and read-only. They do not
set a workspace, provider, model, permissions, enabled state, or run history.
Those values remain client-local. GitHub Issues, organization fields, Projects,
Actions, and the Control Plane remain the authoritative delivery surfaces.

`manifest.json` is the source-level contract. Distribution publishes only a
reviewed, hash-pinned projection into its Agent Plugin package. `.github` and
`.github-private` are not automation sources.
