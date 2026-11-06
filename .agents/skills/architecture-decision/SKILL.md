---
name: architecture-decision
description: Consume the pinned Authority decision workflow and hold when its trusted inputs or tracking Issue are unavailable.
---

# Architecture decision workflow input

This file is a consumer input reference, not another canonical skill or local
formal-decision workflow. Read the canonical `architecture-decision` skill0.2.0
from the approved Primitive0.1.0 source:

- Repository: `agentic-delivery-lab/agentic-delivery-agent-customizations`, native ID `1380894656`.
- Release manifest commit: `4d515fdf148c63ec86144a908802139d5d6a244a`.
- Prepared source: `9d87e08bf4f4619465278ba16175c67ceb566a9d`.
- [Canonical skill](https://github.com/agentic-delivery-lab/agentic-delivery-agent-customizations/blob/9d87e08bf4f4619465278ba16175c67ceb566a9d/skills/architecture-decision/SKILL.md).
- Skill file SHA-256: `671896834001528d72b641c5ce66a5145c4e65dcd97c61793772e200e005f5ef`.

Use only the exact trusted, read-only input selected by the admitted profile.
A link or hash alone does not provide that input or grant network access.
If the skill or [Authority template](../../../docs/decisions/adr-template.md)
is unavailable, hold or return `needs_input`. Do not fetch arbitrary code,
invent a local convention, copy formal decision prose here, or create a
replacement Issue.

Retain the native originating source Issue and its authorization. Formal
ADR/ADP/ADD work belongs to Architecture Authority and needs its separately
identified, already-authorized tracking Issue. The origin can serve both
roles only when it already belongs to Authority and tracks that decision.
Consumer implementation follows the approved merged Architecture Release in
its own branch/PR. Use repository-qualified links and close only authorized,
completed work; never infer approval from Issue text, silence or a same-number
Issue in another repository.

The [local reference index](../../../docs/decisions/README.md) carries selected
immutable source provenance only. Runtime, capability and publication
admission remain separate.
