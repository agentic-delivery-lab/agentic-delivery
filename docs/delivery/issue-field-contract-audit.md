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
returned `hold`, skipped delivery, and left #62 unchanged. Because its GPT-6
turn failed without a recorded cause, this run does not establish whether the
missing issue metadata caused the hold.

The live write probe used the maintainer's GitHub CLI credential through the
deterministic migration controller; it did not use a GitHub App token. The
maintainer's restricted records report the controller writes, independent REST
reads, and exact restoration against both repository identities. Reviewers
cannot independently verify those responses from this public report. This
probe does not establish App-scoped writes or App-token event delivery from
`.github`. The GitHub App evidence currently covers the central read path only.
The initial REST snapshots and post-rollback responses share the same digest
because all four returned `[]`; the restricted evidence index records each
source file hash.

## Public Actions log remediation — 2026-10-02

The central canary run `37008188017` printed the repository variable
`ISSUE_FIELD_BINDINGS_JSON` in the classifier step environment, exposing
organization-only field and option IDs in this public repository's Actions
log. The log archive was deleted after the exposure was identified; the run
record remains, but its step logs are no longer available for independent
review. The binding value is now stored as the repository Actions secret of the
same name. This branch changes intake and delivery workflows, including their
reusable-workflow hand-offs, to read the secret. Each consuming job registers
the field and option IDs individually for masking before using the bindings,
because transformed or partial values are not guaranteed to match the full
JSON secret. The old repository variable must be removed after this change is
merged. Do not run another canary until the old variable is removed and a
read-only run confirms that the bindings do not appear in logs.

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

## W07 interactive field canary

The operator command `scripts/run-issue-field-canary.mjs` is restricted to
Control Plane canary #62 and public adapter canary #11, including their exact
repository and Issue identities declared in `config/operator-field-canaries.json`. It checks the existing native field and
option IDs supplied in private operator bindings, writes only Intake and Not ready, and restores each original
option or original absence. Absence uses GitHub's explicit `delete: true`
input. Field definitions, options, visibility, Issue Type and labels remain
outside this operation.

Preview is the default and requests no mutation. Supply an existing private
evidence directory owned by the current account:

```text
node scripts/run-issue-field-canary.mjs --evidence-dir <private-directory> --bindings-file <private-bindings-file>
```

The public manifest contains logical field keys and option names only. Native
organization-only field and option IDs remain in a private owned JSON file using
the existing ISSUE_FIELD_BINDINGS_JSON format. Preview reports its digest; apply
requires the reviewed digest and fails if the file changes.

Apply requires a reviewed clean source commit, explicit `--apply`, and native
GitHub account 14937399. It refuses apply in GitHub Actions; this interactive
operator delegation is not a factory runner capability. The command uses the
existing gh authentication without exporting its credential.

```text
node scripts/run-issue-field-canary.mjs --evidence-dir <private-directory> --bindings-file <private-bindings-file> --bindings-sha256 <reviewed-binding-file-digest> --apply --approved-commit <reviewed-40-character-commit>
```

Apply requires each selected field to differ from its test option; an unchanged
field cannot prove a successful write. The original snapshot is saved before the first write. Separate reads verify
the test write and restoration. A lost write response triggers reconciliation,
not repetition; a lost restore response is checked independently. Changed
selected-field values or missing original options hold restoration rather than
overwriting another actor's work. Preserve the snapshot and inspect current
values before any retry. Once the original snapshot is saved, an audit-output
failure does not prevent restoration when identity and value checks still pass;
the test fails acceptance without a complete audit.

Use the dedicated canaries while they are not being edited. The native mutation
input has no compare-and-swap field; checked reads do not establish an atomic
concurrency guarantee. This administrative proof does not activate a participant
or count as factory-delivered milestone A evidence. On 2026-10-14, interactive operator operation
`d1fd02d5-f024-4b48-b5ed-294f02498d02` ran reviewed commit
`02aa83718e7fdfea096b24538c03795d8700336d` on both fixed canaries.
Both complete original vectors were empty. Each test write was read back; explicit
deletion restored absence, verified by the command and a separate post-operation
query. Original and final vector SHA-256 were
`4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945`.
Private owner-only records retain the before, write, restore and independent-read
evidence without publishing organization-only bindings. This is operator-scoped
absence-restoration evidence for that exact commit. Existing-option restoration
has fixture coverage; App-scoped writes and active runner admission remain
unverified. The later no-change rejection is separately regression-tested; this
record does not claim a live operation on a later source revision.
