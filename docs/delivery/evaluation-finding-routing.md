# Evaluation finding routing

The offline router turns an Architecture evaluation report into a reviewable
Issue proposal. It accepts only contract version `1.0.0` with the immutable
Architecture schema pin recorded by `evaluation-finding-router.mjs`. The schema
must be available from its pinned Git commit, and its bytes must match the
declared SHA-256. This provisional Control Plane change depends on Architecture
PR #14 and must not be merged before that contract is reviewed and merged. The
existing participant registry and controller release do not adopt the proposed
schema as a default dependency.

An actionable report must name a canonical GitHub Issue in the same repository
as its subject source pin. That repository must appear in the local participant
registry. The router validates the complete report, checks measured comparison
claims for a measured baseline and matching metric, unit, and observation
window, and fails closed on invalid pins, unsupported versions, or ambiguous
ownership. Repeated identical reports with the same `reportId` become one
proposal; conflicting content under the same ID is rejected. Synthetic reports
cannot produce owner Issue proposals.

The report does not define a separate owner mapping, so routing never guesses
from its prose or layer name: `ownerIssue` must belong to the repository in
`subject.sourcePin`. A product owner absent from the participant registry is
rejected for a later ownership decision; this tool does not enroll or activate
that repository.

Each proposal retains the complete source report, its evidence references,
every source pin, and a canonical SHA-256 reference to the report. The router
verifies the schema bytes and report digest locally; it preserves source pins
after schema validation but does not retrieve source repositories or verify
their referenced content. Its planning status is
`awaiting-human-prioritization`; it has no Issue priority, lifecycle, readiness,
Project, or execution fields. Reports recommending human review or no action
produce dispositions without an Issue proposal. The command reads local files
and writes JSON to standard output; it does not call GitHub or change
repository, Issue, Project, policy, participant, or release state.
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
