# Automation template boundary

This directory owns canonical, versioned VS Code/Copilot Automation templates
for the Agentic Delivery Control Plane. A template is a read-only advisory
entry point; it is not a lifecycle transition, GitHub Project state machine,
credential store, or runtime history database.

Use the currently supported `.automation.md` frontmatter documented by VS
Code. Keep workspace, provider, model, permissions, enabled state, and run
history out of the file. Those values remain client-local. Do not place these
templates in `.github-private`; Distribution may publish a reviewed Agent
Plugin projection.
