# Evaluation finding routing

The offline router turns an Architecture evaluation report into a reviewable
Issue proposal. It accepts only contract version `1.0.0` with the immutable
Architecture schema pin recorded by `evaluation-finding-router.mjs`. The schema
must be available from its pinned Git commit, and its bytes must match the
declared SHA-256. This provisional Control Plane change depends on Architecture
PR #14 and must not be merged before that contract is reviewed and merged. The
existing participant registry and controller release do not adopt the proposed
schema as a default dependency.

The router validates the complete report, requires a measured baseline and
matching metric, unit, and observation window for measured claims, and checks
the direction of `absolute-difference` claims against the values and comparator
direction. A contradiction is rejected. Claims that depend on an unavailable
comparator definition, including unequal measurements claimed as `no-change`,
are marked for human comparator review. Invalid pins and unsupported versions
are rejected. Repeated identical reports with the same `reportId` become one
proposal; conflicting content under the same ID is rejected. Synthetic reports
cannot produce owner Issue proposals.

`recommendation.ownerIssue` is only a report-asserted candidate target. The
router checks that it is a canonical GitHub Issue URL and prevents it from
targeting the source Issue, but it cannot establish the target repository's
ownership, the Issue's existence or accessibility, or a relationship between
that target and the subject source pin. Participant enrollment is not evidence
of ownership. Since the pinned Architecture contract contains no authoritative
layer-to-repository owner map, every `owner-issue` recommendation becomes an
`awaiting-owner-verification` disposition with no actionable `target`. A
human-owned, pinned owner mapping is required before the Control Plane can
emit an Issue proposal for any report layer.

Every proposal and disposition retains the complete source report, evidence
references, every source pin, uncertainty, review state, a comparison
verification status, and a SHA-256 reference to the report. The router
verifies the schema bytes and report digest locally; it preserves source pins
after schema validation but does not retrieve source repositories, comparator
definitions, or referenced content. Human-review, no-action, and unresolved
owner recommendations all produce dispositions with the same provenance. The
command reads local files and writes JSON to standard output; it does not call
GitHub or change repository, Issue, Project, policy, participant, or release
state. After a future authoritative owner mapping is pinned and the target
Issue is verified, resulting work must still be human-prioritized and pass all
existing execution authorization gates.
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

The output is a proposal only. A later Issue operation would still require a
separately authorized source Issue and the existing source Issue identity,
actor, policy, type, lifecycle, readiness, plan-completeness, and downstream
authorization checks. Project planning remains a separate human-controlled
operation.
