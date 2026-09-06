---
name: ubiquitous-language
description: Apply this repository's context-scoped domain language when changing domain-bearing code, documentation, agent instructions, or architecture decisions.
---

# Ubiquitous language

Use this skill before changing repository artifacts that express domain concepts.

## Establish the context

1. Read [`docs/domain/README.md`](../../../docs/domain/README.md) for the repository boundary and change process.
2. Read [`docs/domain/ubiquitous-language.yml`](../../../docs/domain/ubiquitous-language.yml) as the canonical register.
3. Identify every bounded context affected by the requested change. Do not transfer a term's meaning to another context without an explicit mapping.

If no existing context applies, or one term needs incompatible meanings, handle that as a domain-model change rather than silently broadening a definition.

## Apply and evolve the model

- Use the registered term and definition consistently in communication, documentation, agentic primitives and domain-bearing code.
- Treat a missing concept, conflicting meaning, renamed term or changed definition as a model change. Update the register and every affected artifact in the same change set.
- State affected bounded contexts and terms in architecture-decision work. Use the repository's architecture-decision process when the model change is significant or cross-cutting.
- Keep new or changed repository documentation in plain English, following the repository communication contract.

Keep exact external product names, API names, identifiers and quotations when changing them would lose information. When external language differs from the local model and could be ambiguous, state its context or map it to the registered term.

## Review the result

Run the domain-language validator and contract tests. Then review meaning manually: structural checks cannot prove that text or code uses the correct concept. Treat `avoid` values as context-specific review guidance, not as a global forbidden-word list.
