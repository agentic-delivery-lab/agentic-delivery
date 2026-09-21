# Agentic Delivery Control Plane

This repository is the executable, organization-wide Agentic Delivery Control
Plane. It owns the GitHub App webhook boundary, participant enrollment,
versioned lifecycle and routing contracts, deterministic authorization,
orchestration, runner/session control, reusable workflows, evidence, and
controlled GitHub write-back.

GitHub Issues and organization fields remain the durable work-state authority;
Projects are an operational projection. The controller identifies the
originating repository from the signed event and participant registry. It does
not assume that the origin is this repository, and it never copies the generic
lifecycle into consumers.

Architecture Authority governs this repository through pinned releases.
Agentic Primitives owns reusable agents, skills, instructions, hooks,
validators, capabilities, and MCP contracts. Distribution owns Dev Containers,
Features, bootstrap, and thin consumer callers. `.github` and
`.github-private` remain GitHub-defined governance/publication adapters rather
than runtime locations.

Executable enrollment and invocation configuration lives under [`config/`](config/);
the participant registry and actor catalog are not organization-profile or
community-health files. The lifecycle and orchestration YAML under `.github/`
remains a read-only compatibility bridge until its planned split into canonical
`config/` files.

## Local checks

```text
pnpm test
pnpm github-app:check
pnpm control-plane:boundary
pnpm metadata:check
pnpm migration:check
pnpm traceability:check
pnpm control-plane:check
```

The organization App private key and webhook secrets belong only in the
central deployment boundary. Participant onboarding, upgrades, rollback,
credential rotation, and incident recovery are documented in
[`docs/delivery/operations/`](docs/delivery/operations/).

The repository-split plan is retained in
[`tasks/agentic-delivery-repository-split-plan.md`](tasks/agentic-delivery-repository-split-plan.md).
Issue #52 remains the plan-persistence source record; implementation and
activation require separately authorized successor issues and operator
actions.
