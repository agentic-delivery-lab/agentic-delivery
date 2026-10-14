# Incident recovery

Incident recovery protects GitHub work state first. Issues and pull requests
remain the durable audit record; runner state and Projects are projections.

1. Fail closed by disabling the participant registry entry or central dispatch
   path; do not delete issue history or mutate labels to hide the event.
2. Preserve the signed delivery ID, repository ID, installation ID, envelope,
   controller commit, and evidence links for investigation.
3. Check replay markers and origin-scoped token requests for duplicate or
   cross-repository activity.
4. Rotate credentials if exposure is possible, following the credential
   rotation runbook.
5. Compare the participant's pinned controller, Architecture, Primitive, and
   Distribution sources with their lock manifests.
6. Recover with an exact reviewed pin or a documented manual operation. Human
   authorization remains required for merge and irreversible GitHub changes.

Do not use `.github-private` as an incident database or copy runtime/session
state into it. After recovery, add a source issue, evidence links, and an ADR
only when the incident changes a durable architectural choice.

For invocation receipt incidents, inspect the exact workflow revision as well
as the participant controller pin. The workflow owns finalization; an older
participant may have no finalizer file. Compare origin repository name and ID,
source Issue, controller commit, workflow run and attempt with the active
receipt lease before allowing settlement. Preserve completed receipts when a
duplicate finalizer is rejected. Do not relabel an exhausted receipt as
retryable or reset its spent attempt allowance to make recovery run.

A completed invocation in shadow or read-only mode can be an observation or
refinement. Check separate exact-tree validation, publication and acceptance
evidence before reporting software delivery. Held or unknown routes do not
become completed because their delivery job was skipped.

Migration 0008 must be verified in an isolated database and applied through the
protected operator boundary before deploying attribution writers. A rollback
must retain compatible workflow-revision finalization and the additive
attribution columns; preserve rows and incident evidence. These instructions
do not authorize a live migration or participant activation. Canonical policy
changes belong to Architecture ADR-0018 under ADR-0020; this runbook describes
the Control Plane implementation and its required evidence.
