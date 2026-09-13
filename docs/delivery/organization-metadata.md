<!-- agentic-primitive: {"id":"organization-metadata-runbook","kind":"instruction","enforcement":"instructional","adrs":["ADR-0012","ADR-0013","ADR-0015"],"domains":["agentic-delivery-governance"]} -->

# Organization GitHub metadata runbook

The repository cannot create organization-owned GitHub Issue Types, issue
fields, or the `agentic-delivery-lab/.github` repository from a pull request.
The versioned contracts and migration command prepare those changes without
pretending that the organization configuration has already been provisioned.

## Organization contract

Use [`.github/issue-metadata.yml`](../../.github/issue-metadata.yml) as the
reviewed source for this organization-wide contract:

- Native Issue Types: Idea, Research, Feature / Outcome, Bug, Task,
  Requirements, Architecture Decision, Implementation, and Validation.
- Pinned single-select `Lifecycle Stage`: Intake, Discovery, Definition,
  Decision, Planning, Execution, Validation, Acceptance, Done, and Parked.
- Pinned single-select `Delivery Readiness`: Not ready, Needs information,
  Ready, Working, Waiting, Awaiting human, and Blocked.
- Governance labels: only cross-cutting controls such as `adr:needed`,
  `security-review`, `human-review`, and `external-evidence-required`.

Issue type, Lifecycle Stage, Delivery Readiness, governance metadata, and
runner execution state are separate concepts. The lifecycle field is the only
workflow state machine. Readiness is an orthogonal gate; it does not add
temporary conditions to the lifecycle vocabulary. The runner stores its
resumable session and operation state under the protected per-issue state
directory.

Run the dry-run manifest before changing organization settings:

```text
pnpm metadata:migrate --manifest
```

Create or update the Issue Types and fields in the `agentic-delivery-lab`
organization using the names and options in that manifest. Pin both fields to
all listed Issue Types and to issues without a type. Preserve the option order
and names; the deterministic controller accepts the versioned logical IDs only
after the operator binds the provisioned GitHub IDs.

## Runtime ID bindings

GitHub assigns organization-specific node IDs to Issue Types, fields, and
single-select options. Store the observed, non-secret bindings as a protected
repository variable named `ISSUE_FIELD_BINDINGS_JSON`:

```json
{
  "fields": {
    "lifecycle_stage": {
      "id": "<github-lifecycle-stage-field-id>",
      "options": {
        "intake": "<github-intake-option-id>",
        "discovery": "<github-discovery-option-id>",
        "definition": "<github-definition-option-id>",
        "decision": "<github-decision-option-id>",
        "planning": "<github-planning-option-id>",
        "execution": "<github-execution-option-id>",
        "validation": "<github-validation-option-id>",
        "acceptance": "<github-acceptance-option-id>",
        "done": "<github-done-option-id>",
        "parked": "<github-parked-option-id>"
      }
    },
    "readiness": {
      "id": "<github-delivery-readiness-field-id>",
      "options": {
        "not-ready": "<github-not-ready-option-id>",
        "needs-info": "<github-needs-information-option-id>",
        "ready": "<github-ready-option-id>",
        "working": "<github-working-option-id>",
        "waiting": "<github-waiting-option-id>",
        "awaiting-human": "<github-awaiting-human-option-id>",
        "blocked": "<github-blocked-option-id>"
      }
    }
  }
}
```

The binding is configuration, not model input. Include every field and option
binding shown in the manifest; partial bindings are rejected against the live
catalog. The controller rejects unknown logical fields and options and never
accepts field IDs from a routing result. Run intake only after the GraphQL read
shows the fields, their complete option sets, and the organization Issue Types.
If the read or a field mutation fails, intake holds the issue and leaves its
lifecycle unchanged.

## Organization issue forms

The canonical forms are published in the
[`agentic-delivery-lab/.github` repository](https://github.com/agentic-delivery-lab/.github/tree/main/.github/ISSUE_TEMPLATE/).
This repository has no local issue-form override, so GitHub can use the
organization defaults. Each form declares its corresponding organization
Issue Type with the top-level `type` key; the controller still validates the
observed native type and sets missing metadata through the validated GraphQL
boundary. The forms collect intent and evidence and do not use `type:*` or
`state:*` labels to select work or lifecycle.

Blank issues remain enabled so incomplete or untyped work can enter semantic
refinement. CI fetches all nine forms and `config.yml` from the live raw source
at
`https://raw.githubusercontent.com/agentic-delivery-lab/.github/main/.github/ISSUE_TEMPLATE/`.
It validates the expected native Issue Type, YAML and body for every form and
checks that blank issues remain enabled. Availability of the organization
repository is a live CI dependency; an unreachable, malformed, incomplete, or
invalid source fails the contract tests. Changes to the separate
`agentic-delivery-lab/.github` repository are outside this change.

## Existing issue migration

Migration is per issue, explicit, and idempotent:

```text
pnpm metadata:migrate --issue <number>
pnpm metadata:migrate --issue <number> --apply
```

The dry run reads the native type, fields, legacy labels, and organization
catalog. It reports a manual operator block when the required native type or
either organization field, complete option set, or runtime binding is not
observed. Apply performs these operations in order:

1. Assign the matching native Issue Type when the organization exposes it.
2. Copy the legacy `type:*` and `state:*` meaning into the native type and the
   two issue fields.
3. Verify field writes through the controller boundary.
4. Remove legacy metadata labels only after field authority is available.
5. Preserve governance and unrelated labels.

An unavailable native type or field is an actionable operator block, not a
silent fallback. Until migration completes, the resolver can read old labels
as compatibility evidence, but active intake and delivery never write a
`state:*` lifecycle label. A saved delivery session remains keyed by its
repository and issue number and is not discarded by metadata migration.

## Orchestration capability inventory

The approved profile and capability catalog is
[`.github/orchestration-policy.yml`](../../.github/orchestration-policy.yml).
The runner must explicitly report available optional MCP servers. The current
catalog names Firecrawl for `web-research`, Chrome DevTools for
`browser-automation`, and Context7 for `documentation-research`; their names
in the catalog do not claim that they are installed. Configure the
comma-separated, non-secret repository variable `CODEX_MCP_SERVERS` with the
servers actually installed for the self-hosted runner. The controller enables
only the intersection of that inventory and the MCP servers declared by the
selected policy profiles. A missing optional capability produces a degraded or
held route when that capability is required. It is never replaced with an
unrelated tool, and implementation profiles have no MCP access.

The router still follows the boundary:

```text
semantic proposal
        -> deterministic policy and field validation
        -> authorized profile execution
```

Only the deterministic controller can mutate issue fields, assign a native
type, create child issues, publish Git changes, or advance lifecycle stage.
