---
date: 2026-09-06
source-issue: https://github.com/sjefsharp/agentic-delivery/issues/3
decision-makers: Sjef Jenniskens
consulted: None
informed: None
---

# Use plain language for human-agent communication

## Context and Problem Statement

Issue [#3](https://github.com/sjefsharp/agentic-delivery/issues/3) asks the repository to study ISO 24495-1 and ISO 9241-210, then define how people and agents communicate. The repository has no shared rule for the language of interactive replies or for the language of new documentation. Different agents could therefore choose different languages or write text that is hard to use.

Public information describes ISO 24495-1:2023 as a standard for plain-language documents. Its four governing outcomes are that readers get what they need, find it, understand it and use it. ISO 9241-210:2019 describes human-centred design activities across the life cycle of interactive systems. The ISO catalogue lists both editions as published; the 9241-210 page says the 2019 edition was reviewed and confirmed in 2025.

The repository does not hold licensed copies of either standard. This decision therefore records alignment with publicly available principles, not certification or full compliance with either standard.

## Decision Drivers

- People should be able to find, understand and use an answer quickly.
- Dutch is the preferred interactive language for this repository, while repository documentation must remain consistent in plain English.
- The policy must preserve technical precision in code, commands, identifiers, quotations and necessary terms.
- Agents need one discoverable rule and a reusable workflow rather than ad-hoc writing advice.
- The decision must be testable without pretending that static checks can prove every conversational outcome.

## Considered Options

- Adaptive Dutch/English communication with plain-English repository documentation.
- Dutch for every interaction unless English is explicitly requested.
- English for every interaction to keep one uniform language.

## Decision Outcome

Chosen option: **Adaptive Dutch/English communication with plain-English repository documentation**, because it follows the reader's current language, keeps the repository's durable text consistent and applies the plain-language outcomes without sacrificing technical accuracy.

The repository will use these rules:

- For Dutch or English conversations, follow the user's language.
- If the language is mixed or unclear, use Dutch.
- An explicit request for an output language takes precedence.
- A clear language other than Dutch or English is outside this decision and keeps its existing behavior.
- Write new or changed repository documentation in plain English.
- Keep code, commands, identifiers, quotations and necessary technical terms unchanged when translating or simplifying text would reduce precision.
- Review text for relevance, findability, understandability and usability. Use user feedback to improve it iteratively.

ISO 24495-1 is used as the text-quality lens. ISO 9241-210 is used as the design and evaluation lens: understand the user, task and context, involve feedback and refine the communication primitive over time. Neither standard is treated as a requirement to ask questions in every reply or as a claim of certification.

### Consequences

- Good, because users receive replies in the language they are already using.
- Good, because English repository documentation gives agents and contributors one durable documentation language.
- Good, because the four plain-language outcomes are more useful than a single readability score.
- Good, because the rule is implemented as both repository guidance and a reusable skill.
- Bad, because language detection can be uncertain and Dutch is only a safe fallback, not proof of user preference.
- Bad, because the policy requires human review and feedback for conversational quality that static tests cannot measure fully.
- Neutral, because existing documents are rewritten for clarity but their decisions, history and technical behavior remain unchanged.

### Confirmation

- `AGENTS.md` states the language contract and loads the reusable communication skill.
- The communication skill states the language rules, the four text outcomes, technical exceptions, feedback loop and limits on ISO claims.
- Contract tests check the observable instructions and skill metadata.
- ADR validation, Markdown linting, YAML parsing and the existing repository tests pass.
- A manual review covers Dutch, English, mixed-language and explicit-language-switch scenarios.
- A repository-wide content audit confirms that all human-facing text has been reviewed and rewritten in plain English where applicable.

## Pros and Cons of the Options

### Adaptive Dutch/English communication with plain-English repository documentation

- Good, because it respects the user's current language while keeping durable artifacts consistent.
- Good, because it supports both interaction comfort and agent discoverability.
- Bad, because it needs a fallback rule for mixed or unclear input.

### Dutch for every interaction unless English is explicitly requested

- Good, because it is predictable for the repository's primary maintainer.
- Bad, because it can ignore a user's switch to English unless they state the switch explicitly.
- Bad, because it does not generalize well to shared work with English-speaking contributors.

### English for every interaction

- Good, because one language is simple to enforce and search.
- Bad, because it conflicts with the stated Dutch preference for human-agent communication.
- Bad, because it can make interactive answers less accessible to Dutch-speaking users.

## More Information

- Assignment brief: [GitHub issue #3](https://github.com/sjefsharp/agentic-delivery/issues/3)
- Plain-language source: [ISO 24495-1:2023](https://www.iso.org/standard/78907.html)
- Human-centred design source: [ISO 9241-210:2019](https://www.iso.org/standard/77520.html)
- Public summary of the four plain-language principles: [International Plain Language Federation](https://www.iplfederation.org/iso-standard/)
- Implementation: the review pull request for this branch will be linked here before review.
- Revisit this decision if the source standards change, user feedback shows repeated language errors or the repository adopts a different primary documentation language.
