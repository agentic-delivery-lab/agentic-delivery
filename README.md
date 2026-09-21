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
the participant registry, actor catalog, issue metadata, and orchestration
policy are not organization-profile or community-health files. The canonical
runtime contracts are now `config/issue-metadata.yml` and
`config/orchestration-policy.yml`; `.github/` contains only repository-local
workflow adapters and governance evidence.

## Local checks

```text
pnpm test
pnpm github-app:check
pnpm control-plane:boundary
pnpm metadata:check
pnpm migration:check
pnpm traceability:check
pnpm control-plane:check
pnpm acceptance:check
```

`pnpm acceptance:check` is an offline two-repository fixture matrix. It proves
that one controller preserves origin repository identity, applies the same
validated lifecycle write-back to each originating issue, isolates equal issue
numbers, carries the identity into API/git/PR/evidence projections, retains an
older compatible pin, and keeps App credentials central.
It deliberately reports live GitHub App installation, webhook delivery,
organization-field, and repository-local CI evidence as external checks; it
does not imply that those operator surfaces are active.

The organization App private key and webhook secrets belong only in the
central deployment boundary. Participant onboarding, upgrades, rollback,
credential rotation, and incident recovery are documented in
[`docs/delivery/operations/`](docs/delivery/operations/).

The repository-split plan is retained in
[`tasks/agentic-delivery-repository-split-plan.md`](tasks/agentic-delivery-repository-split-plan.md).
Issue #52 remains the plan-persistence source record; implementation and
activation require separately authorized successor issues and operator
actions.
