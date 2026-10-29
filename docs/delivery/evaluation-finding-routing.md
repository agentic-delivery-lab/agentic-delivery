# Evaluation finding routing

The offline router turns an Architecture evaluation report into an owner-review
proposal or a disposition. It accepts contract version `2.0.0` with Architecture draft
`0.1.0-draft.24`, commit
`7b1d21462f70c411e75ae67ce80dcf688c9973e8`, and the schema digest pinned by
`evaluation-finding-router.mjs`. The schema must be available from that exact
Git commit, and its bytes must match the declared SHA-256. This is an offline
contract fixture against a draft Architecture release; it does not approve the
contract or make it a default dependency of the participant registry or
controller release.

The command also supports the current producer's exact report-schema pin,
`e1cb20f94ee398c8a26899cc6219b380975da3ca` (draft77). It retrieves both pinned
schema occurrences and verifies their identical `2.0.0` bytes and SHA-256.
Moving references, unknown commits and different bytes remain unsupported.
Each report retains its own schema URL and source pin. A mixed-pin batch has
`schemaPin: null` and lists both pins in `schemaPins`; a single-pin batch keeps
its exact pin in `schemaPin`. The legacy single-pin library loader remains
restricted to its original draft24 pin; the command uses the explicit plural
loader. This compatibility does not change report classification or admission.

The router validates the complete report, requires measured baseline and
candidate values for measured claims, and rejects different declared metric,
unit, or observation-window fields. For supported `absolute-difference`
claims, it checks whether the values agree with the comparator direction; a
contradiction is rejected. Unequal values claimed as `no-change` and claims
that depend on another comparator method are marked for human comparator
review. Even when the declared fields match and the direction agrees, semantic
comparability remains unverified because the pinned baseline and comparator
definitions are not retrieved; the output labels this explicitly. Malformed
pins and unsupported versions are rejected. Repeated identical reports with
the same `reportId` become one routing record; conflicting content under the
same ID is rejected. Synthetic owner recommendations produce holds without
exposing a candidate target or creating an owner Issue proposal.

`recommendation.ownerIssue` is only a report assertion. The router checks its
canonical URL and rejects a self-targeting source Issue. The supported offline
command separately loads ownership contract `1.0.0` from immutable Architecture
source `6cd215fd5af50fc042f010cbdc70495c1e71d91b`, binding both
`architecture/evaluation/owners.json` and its schema to exact SHA-256 digests.
Architecture [PR #28](https://github.com/agentic-delivery-lab/agentic-delivery-architecture/pull/28)
accepted this source at merge commit
`7a8dd0b651ea0d0535a77c87a3eb7e8fb786ed71`. The pinned source remains a draft
contract for offline review; source acceptance does not authorize runtime
adoption. Report schema `2.0.0` retains its separate immutable pins.

Match the exact report layer, subject ID and source repository/path against the
explicit mapping. The current declarations cover the Customizations validation
capability and Control Plane finding router. Unknown subjects, changed paths and
unmapped product outcomes remain `awaiting-owner-verification`. Participant
membership and context-review stewardship do not establish ownership. Synthetic
reports never expose a target. A report owner assertion that contradicts a
matched pinned owner is rejected.

A matched observed report produces a repository-only proposal with status
`awaiting-human-prioritization`. Its native repository ID is the expected value
from the pinned mapping, explicitly not a live identity readback. The proposed
repository is not an authorized Issue mutation target. The asserted owner Issue
remains inside the complete source report; its existence, access and current
lifecycle are not verified by this offline operation. The map's source Issue
explains the ownership declaration, not the caller's permission to write.

Each proposal retains mapping/schema pins, complete source evidence, uncertainty
and comparison assessment. `requiresTargetVerification` and
`requiresHumanPrioritization` remain true, while `empiricalClaimsVerified` and
`executionAuthorized` remain false. An `observed` classification is still a
report declaration, not verified empirical evidence. Library callers may omit
an ownership contract to preserve the original unresolved disposition behavior;
a supplied contract must come from the exact pinned bytes. Parsed owner mappings
are private and cannot be replaced or mutated through a caller-supplied object.

Every disposition retains the complete source report, evidence references,
every source pin, including grader-calibration dataset pins when present,
uncertainty, review state, comparison assessment, and a SHA-256 reference to
the report. The router verifies the schema bytes and
report digest locally; it preserves source pins after schema validation but
does not retrieve source repositories, comparator definitions, or referenced
content. Human-review, no-action, and unresolved owner recommendations all
produce dispositions with the same provenance. The command reads local files
and writes JSON to standard output; it does not call GitHub or change
repository, Issue, Project, policy, participant, or release state. Before any
later mutation, re-fetch native repository identity and the target Issue, verify access and current lifecycle, and obtain separately bounded source
authorization. Resulting work must be human-prioritized and pass all existing
execution authorization gates.
The `--source-issue` value supplies context for self-target detection only; it
does not verify actor permissions or authorize a later mutation.

Run it with an Architecture checkout that contains the pinned commit:

```sh
pnpm evaluation:route -- \
  --architecture-root ../agentic-delivery-architecture \
  --source-issue https://github.com/agentic-delivery-lab/agentic-delivery/issues/103 \
  --report /path/to/evaluation-report.yml
```

The router tests use the same pinned checkout. Run the full suite locally with
`EVALUATION_ARCHITECTURE_ROOT=../agentic-delivery-architecture pnpm test`.

Offline proposals are planning inputs. They cannot create, update or prioritize
Issues, mutate Projects, change policy or start execution. Before a later bounded
mutation, the operator must verify target identity and the current Issue, actor
permissions, separately authorized source scope and applicable downstream gates.
Implementation still requires the existing type, lifecycle, readiness and plan
checks. No live evaluation consumer is enabled by this command.
