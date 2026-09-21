---
version: 1
id: prepare-validation-evidence
name: Prepare validation evidence
description: Prepare a read-only evidence summary for a proposed delivery change.
schedule:
  kind: manual
---

Prepare a read-only validation-evidence summary for the current change.

Do not edit files or mutate GitHub Issues, fields, Projects, branches, commits,
pull requests, releases, or external systems. Do not merge, publish, promote,
or change a lifecycle value. Do not treat model output as proof.

Identify the source issue, affected bounded contexts, pinned Architecture and
Primitive references, deterministic checks that are available, unresolved
risks, and evidence links. Report commands and results only when they were
actually observed. Distinguish unavailable runtime evidence from a passing
check, and leave the final authorization and state mutation to the existing
human-reviewed delivery workflow.
