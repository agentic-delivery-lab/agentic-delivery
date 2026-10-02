# Organization issue-field contract audit

**Observed:** 2026-09-25 (UTC)  
**Source issue:** [Control Plane issue #60](https://github.com/agentic-delivery-lab/agentic-delivery/issues/60)  
**Method:** authenticated, read-only GitHub REST and GraphQL requests

This is a point-in-time audit of the organization issue fields used by the
Control Plane. It records field identity, pinning, visibility, API boundaries,
and access evidence without changing organization settings or issue values.

## Findings

The live catalog contains one single-select `Lifecycle Stage` field and one
single-select `Delivery Readiness` field. Both are pinned to all nine enabled
organization issue types and to issues without a type. Their visibility is
Organization only. The live type and field names match the versioned contract
in [`config/issue-metadata.yml`](../../config/issue-metadata.yml).

Visibility is a point-in-time observation, not a versioned or runtime-enforced
invariant: the metadata contract has no expected-visibility property, and the
validator does not reject a visibility change. This audit does not establish
Organization-only visibility as a lasting security policy. If that access
boundary must be enforced, define it in a separately reviewed contract change.

The domain term is **Delivery State**. `Delivery Readiness` remains the current
live display name and versioned compatibility key until an approved migration
renames the existing field in place. This audit did not create a second field
or change a field or option identity.

| Logical field | Live name | Live type | Visibility | Type pinning | No-type pinning |
| --- | --- | --- | --- | --- | --- |
| `lifecycle_stage` | Lifecycle Stage | Single select | Organization only | All nine enabled types | Present |
| `readiness` (Delivery State) | Delivery Readiness | Single select | Organization only | All nine enabled types | Present |

All nine configured native Issue Types are present and enabled: Idea, Research,
Feature, Bug, Task, Requirements, Architecture Decision, Implementation, and
Validation. `ISSUE_FIELD_BINDINGS_JSON` contains field and option GraphQL node
IDs. Those bindings were compared with the live REST and GraphQL identities.
REST integer IDs and GraphQL node IDs are different representations of the
same objects; they must not be compared as strings across APIs. Exact IDs and
issue field values are omitted from this public report because both fields
have Organization only visibility.

## Live pinning evidence

The current GraphQL schema exposes the type-specific pin list as
`IssueType.pinnedFields` and the list for issues with no type as
`Organization.pinnedIssueFields`. The authenticated query returned both target
fields on every enabled type and in the no-type list. Field visibility was
`ORG_ONLY` in GraphQL and `organization_members_only` in the REST catalog.
The configuration binding IDs were compared with the live GraphQL field and
option node IDs; the public report records the match result but omits those IDs.

The query shape used for the inventory was:

```graphql
query {
  organization(login: "agentic-delivery-lab") {
    issueTypes(first: 100) {
      nodes {
        name
        isEnabled
        pinnedFields {
          ... on Node { id }
          ... on IssueFieldCommon { name dataType visibility }
        }
      }
    }
    pinnedIssueFields(first: 100) {
      nodes {
        ... on Node { id }
        ... on IssueFieldCommon { name dataType visibility }
      }
    }
    issueFields(first: 100) {
      nodes {
        ... on Node { id }
        ... on IssueFieldCommon { name dataType visibility }
        ... on IssueFieldSingleSelect { options { id name description } }
      }
    }
  }
}
```

The option names and option identities returned by the REST and GraphQL
catalogs match the configured option bindings. The live binding remains in the
repository Actions variable; it is not copied into this report.

## API and permission boundaries

- `GET /orgs/{org}/issue-fields` reads organization field definitions and
  options. The current maintainer session has `read:org` for this read.
- `GET /repos/{owner}/{repo}/issues/{issue_number}/issue-field-values` reads
  values attached to one repository issue. Read responses were confirmed for
  Control Plane and public-adapter repository identities, including both a
  populated response and an empty response. The returned issue numbers and
  value text are not copied here because the fields are Organization only.
- The Control Plane uses GitHub GraphQL API version `2026-03-10` to read the
  issue's native type and field values along with the organization catalogs.
  Field writes remain behind the deterministic controller.
- The maintainer session has `repo`, `read:org`, and `workflow` scopes; it does
  not have `admin:org`. No write request was made during this 2026-09-25 audit.
- At the time of this audit, the installed Agentic Delivery Lab App reported
  repository permissions including `issues:write`, but no Organization
  `Issue Fields` read permission. The organization later approved `Issue
  Fields: read` and `Issue Types: read`; issue #66 records that grant and adds
  both permissions to the versioned App contract and origin-token requests.
  At the time of this audit, the live pinning query used the maintainer session,
  not the App token. The canary result below records the subsequent runtime read.

The repository now reads live type pins and no-type pins in the shared query
and validates them before intake routing, delivery, or metadata migration can
authorize issue-field writes. If the App token cannot read those catalogs,
delivery and metadata migration abort with an error before any issue-field
write. These callers do not convert that failure into an explicit held route
or update the issue's Delivery State.

This report is redacted. The 2026-10-02 maintainer-token catalog response and
the complete test snapshots are retained in a maintainer-only local evidence
store. The evidence index has SHA-256
`03bd8fdcc2a029e0a1affb270ee95d0ca04b295796fbd978c40654376452ef8a`; the raw
Organization-only responses are not committed to this public repository. A
reviewer cannot download those restricted files from the PR, so the public
record remains digest-only. The Actions log proves the central App-token read,
but its raw GraphQL response was not retained.

## Runtime and controlled write evidence — 2026-10-02

The normal central `issues.edited` intake ran after PR #72 merged at
`001b0673a80197f27cd95d0d30a148a9fa3e567b`. [Actions run
37008188017](https://github.com/agentic-delivery-lab/agentic-delivery/actions/runs/37008188017)
used the registered `shadow` participant and read-only run policy. The hosted
authorization and self-hosted classification jobs passed. The trusted
`pnpm/setup` action read `trusted-intake/package.json` and installed pnpm
12.3.4. The App-token classifier passed the fail-closed organization field,
Issue Type, and pinning validation and reached semantic routing without a
metadata permission error.

Issue #62 had no native Issue Type or issue-field values before or after the
canary (`issueType: null`, `issueFieldValues: []`). The result was `hold` and
the delivery job was skipped. The GPT-6 routing turn ended with status
`failed`; the run contains no underlying failure reason. This establishes the
central App metadata read and read-only behavior, but not a successful
semantic-routing turn or the `.github` App-event path.

The deterministic `migrate-issue-metadata.mjs --apply` controller was then used
for one controlled write on each designated disposable issue: central #62 and
public adapter `.github` #11. The controller wrote the two configured
single-select fields to their deterministic migration defaults. An independent
REST read observed both values in each repository. The complete before
snapshots were empty arrays; the documented `PUT` endpoint restored those full
snapshots, and a second REST read returned `[]` for both issues. Both issue
types remained unset. No organization field definitions, options, pins,
production issues, or participant modes changed.

The first migration attempt exposed a controller verification bug: it wrote the
fields, then resolved the GraphQL values against the unbound logical config
instead of the live field IDs. The controller therefore reported a failed
readback even though the REST API showed both values. The values were restored
immediately and verified as `[]`. The regression tests reproduce the failure
caused by resolving live IDs against the logical config, reject the expected
option name when its live option ID differs, and ensure a matching legacy label
cannot stand in for an observed issue-field value. The fix binds the observed
field and option IDs and requires both fields to be present before readback
succeeds; the second live write/read/restore cycle succeeded in both
repositories.

Invalid-option and missing-target controller checks were also run. Both were
rejected before a GraphQL mutation call (`graphqlCalls: 0`). The shadow canary
separately confirmed that issues missing an Issue Type or Lifecycle Stage stay
held and do not start delivery.

The live write probe used the maintainer's GitHub CLI credential through the
deterministic migration controller; it did not use a GitHub App token. This
proves the controller's validated write and exact rollback against both
repository identities, but it does not prove App-scoped writes or App-token
event delivery from `.github`. The GitHub App proof currently covers the
central read path only. The initial REST snapshots and post-rollback responses
share the same digest because all four returned `[]`; the restricted evidence
index records each source file hash.

## Deferred proof and dependencies

The original 2026-09-25 audit made no issue-field writes. The later test writes
above were explicitly limited to canary #62 and `.github` #11 and both exact
empty snapshots were restored. The live test used maintainer credentials, so an
App-token event/read path for `.github` remains open; the current webhook replay
adapter work is tracked separately in issue #64. The normal central intake's
GPT-6 turn failure also remains unexplained and needs diagnostic evidence before
claiming successful semantic routing.

The GitHub `PUT /repos/{owner}/{repo}/issues/{issue_number}/issue-field-values`
endpoint replaces the complete field-value set. It was used only because both
recorded before snapshots were empty; do not use an empty replacement array
when other field values must be retained.

Architecture PR #4 is merged, but the Architecture Authority repository
currently has no GitHub release or tag. The latest content remains a draft, so
Control Plane local ADR text has not been replaced with a published
Architecture release, exact source commit, and digest. That replacement stays
pending an authorized Architecture release.

## Reproduction sources

- [GitHub GraphQL issue fields](https://docs.github.com/en/graphql/reference/issues) documents `IssueType.pinnedFields` and issue field values.
- [GitHub GraphQL organization fields](https://docs.github.com/en/graphql/reference/orgs) documents `Organization.pinnedIssueFields`.
- [REST API: organization issue fields](https://docs.github.com/en/rest/orgs/issue-fields) documents field definitions and the Issue Fields organization permission.
- [REST API: issue field values](https://docs.github.com/en/rest/issues/issue-field-values) documents value reads and writes, including replacement behavior.
- [Managing issue fields in an organization](https://docs.github.com/en/issues/tracking-your-work-with-issues/using-issues/managing-issue-fields-in-your-organization) documents pinning and visibility settings.
- [GitHub App permission reference](https://docs.github.com/en/rest/authentication/permissions-required-for-github-apps) lists the Issue Fields organization permission.
