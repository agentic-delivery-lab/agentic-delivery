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
  not have `admin:org`. No write request was made.
- The installed Agentic Delivery Lab App currently reports repository
  permissions including `issues:write`, but no Organization `Issue Fields`
  read permission. GitHub's REST documentation requires that organization
  permission for App installation tokens that list field definitions. The
  live pinning query was verified with the maintainer session, not with the
  installed App token. App-token access to the new pin fields therefore still
  needs runtime verification before this acceptance criterion is complete.

The repository now reads live type pins and no-type pins in the shared query
and validates them before intake routing, delivery, or metadata migration can
authorize issue-field writes. If the App token cannot read those catalogs, the
existing fail-closed path holds the route without changing issue fields.

## Deferred proof and dependencies

Issue #60 permits a read-only audit and reviewable proposals at this point. It
does not authorize changes to organization settings or issue values before the
applicable review and authorization. No issue-field value was written, changed,
or cleared, and no live permission was added.

Controlled write and rollback evidence on test issues in two repositories is
therefore still outstanding. After review and explicit operator authorization,
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
