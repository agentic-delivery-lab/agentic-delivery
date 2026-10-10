# Evaluation finding routing

The offline router turns an Architecture evaluation report into a reviewable
disposition. It accepts contract version `2.0.0` with Architecture draft
`0.1.0-draft.24`, commit
`7b1d21462f70c411e75ae67ce80dcf688c9973e8`, and the schema digest pinned by
`evaluation-finding-router.mjs`. The schema must be available from that exact
Git commit, and its bytes must match the declared SHA-256. This is an offline
contract fixture against a draft Architecture release; it does not approve the
contract or make it a default dependency of the participant registry or
controller release.

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

`recommendation.ownerIssue` is only a report assertion. The
router checks that it is a canonical GitHub Issue URL and prevents it from
targeting the source Issue, but it cannot establish the target repository's
ownership, the Issue's existence or accessibility, or a relationship between
that target and the subject source pin. Participant enrollment is not evidence
of ownership. Because the pinned Architecture contract contains no authoritative
layer-to-repository owner map, every `owner-issue` recommendation becomes an
`awaiting-owner-verification` disposition with no actionable `target`. A
synthetic report also exposes no `candidateTarget`; its full owner assertion
remains only inside the preserved source report. A human-owned, pinned owner
mapping is required before the Control Plane can emit an Issue proposal for any
report layer.

Every disposition retains the complete source report, evidence references,
every source pin, uncertainty, review state, comparison assessment, and a
SHA-256 reference to the report. The router verifies the schema bytes and
report digest locally; it preserves source pins after schema validation but
does not retrieve source repositories, comparator definitions, or referenced
content. Human-review, no-action, and unresolved owner recommendations all
produce dispositions with the same provenance. The command reads local files
and writes JSON to standard output; it does not call GitHub or change
repository, Issue, Project, policy, participant, or release state. After a
future authoritative owner mapping is pinned and the target Issue is verified,
resulting work must still be human-prioritized and pass all existing execution
authorization gates.
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

The current output is non-actionable. A later Issue proposal would require an
authoritative pinned owner mapping, verification of the target Issue, a
separately authorized source Issue, and the existing source Issue identity,
actor, policy, type, lifecycle, readiness, plan-completeness, and downstream
authorization checks. Project planning remains a separate human-controlled
operation.
