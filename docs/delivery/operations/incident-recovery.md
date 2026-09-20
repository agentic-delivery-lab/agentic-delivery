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

