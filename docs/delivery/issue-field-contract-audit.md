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
repository Actions secret; the exposed repository variable remains temporarily
until the workflow migration is merged. Neither value is copied into this
report.

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
  not have `admin:org`. No write request was made.
- At the time of this audit, the installed Agentic Delivery Lab App reported
  repository permissions including `issues:write`, but no Organization
  `Issue Fields` read permission. The organization later approved `Issue
  Fields: read` and `Issue Types: read`; issue #66 records that grant and adds
  both permissions to the versioned App contract and origin-token requests.
  This code change does not by itself prove the runtime read path. The live
  pinning query above used the maintainer session, not the App token. A normal
  read-only intake of canary issue #62 must still confirm that the pinned
  fields, Issue Types, and issue values are readable without an access error
  and that no issue-field value changes.

The repository now reads live type pins and no-type pins in the shared query
and validates them before intake routing, delivery, or metadata migration can
authorize issue-field writes. If the App token cannot read those catalogs,
delivery and metadata migration abort with an error before any issue-field
write. These callers do not convert that failure into an explicit held route
or update the issue's Delivery State.

This report is a redacted operator record, not a retained raw-response artifact
or immutable response digest. The listed query can be rerun by an authorized
organization reader, but a reviewer cannot independently reproduce the exact
field/option identity comparison or the issue-value reads from this public file
alone. Keep the raw, Organization-only responses in an approved restricted
evidence store if later acceptance requires that level of reproduction; do not
publish those responses in this repository.

## Public Actions log remediation — 2026-10-02

The central canary run `37008188017` printed the repository variable
`ISSUE_FIELD_BINDINGS_JSON` in the classifier step environment, exposing
organization-only field and option IDs in this public repository's Actions
log. The log archive was deleted after the exposure was identified; the run
record remains, but its step logs are no longer available for independent
review. The binding value is now stored as the repository Actions secret of the
same name. This branch changes intake and delivery workflows, including their
reusable-workflow hand-offs, to read the secret. The old repository variable
must be removed after this change is merged. Do not run another canary until
the old variable is removed and a read-only run confirms that Actions masks
the secret.

## Deferred proof and dependencies

The audit itself did not authorize changes to organization settings or issue
values. No issue-field value was written, changed, or cleared during the audit.
The organization later approved the two read permissions, tracked in issue #66.
Runtime verification with the updated immutable controller pin remains
outstanding. Controlled write and rollback evidence on test issues in two
repositories is still outstanding as separate work.

After review and explicit operator authorization,
use dedicated test issues, record the before and after responses, test invalid
and missing values, and restore the original values. Do not use an empty
replacement array when other field values must be retained; GitHub documents
that operation as clearing all existing field values.

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
