---
date: 2026-09-06
source-issue: https://github.com/agentic-delivery-lab/agentic-delivery/issues/5
decision-makers: Sjef Jenniskens
consulted: None
informed: None
domains:
  - agentic-delivery-governance
required-enforcement:
  - instructional
  - deterministic
---

# Use context-scoped ubiquitous language

## Context and Problem Statement

Issue [#5](https://github.com/agentic-delivery-lab/agentic-delivery/issues/5) asks how this repository can apply domain-driven design and use unambiguous language in code and documentation. The repository already defines architecture-decision and plain-language practices, but it does not define their domain concepts in one shared model. Agents and people can therefore use different names for the same concept or give one name different meanings.

Eric Evans' *Domain-Driven Design Reference* defines a bounded context as the boundary within which a model applies. It describes ubiquitous language as a shared language built around that model and used in team communication and software. It also treats a change in that language as a change to the model. This means a repository-wide word blacklist would be too broad: the meaning of a term depends on its bounded context, and external names or quotations may need to remain exact.

The repository initially has one bounded context, `agentic-delivery-governance`. It covers the rules and agentic primitives used to plan, review and record changes in this repository. More contexts should be introduced only when the repository contains models whose meanings need separate boundaries.

## Decision Drivers

- Give people and agents one discoverable source for domain meanings.
- Keep each meaning inside an explicit bounded context.
- Use the same domain language in communication, documentation, agent instructions and code when code exists.
- Treat missing, conflicting or changed terminology as a domain-model change.
- Make the structural contract automatically testable without claiming that automation proves meaning.
- Preserve exact external names, identifiers and quotations when changing them would lose information.
- Keep the process small enough for this repository and its current single context.

## Considered Options

- A context-scoped canonical register with structural validation and semantic review.
- A repository-wide forbidden-word linter.
- Text-only guidance without a machine-readable register or validation.

## Decision Outcome

Chosen option: **A context-scoped canonical register with structural validation and semantic review**, because it makes boundaries and meanings explicit while leaving interpretation to informed review.

The canonical register is `docs/domain/ubiquitous-language.yml`. It identifies the domain, bounded contexts and terms. Each term belongs to one context. An optional `avoid` list records misleading alternatives for review; it is not a global ban. `docs/domain/README.md` explains how to use and change the model.

Repository instructions and the `$ubiquitous-language` skill require agents to read the relevant context and register before changing domain-bearing code or documentation. A missing concept, conflicting meaning or changed definition must be handled as a model change in the same change set. Exact external names, identifiers and quotations may differ when their context or mapping is clear.

A validator checks the register's structure and references. Contract tests check that documentation, agent instructions, skill metadata and CI remain connected. Agents and human reviewers remain responsible for semantic consistency. The repository will not scan all text for forbidden words.

### Consequences

- Good, because every canonical term has an explicit meaning and context.
- Good, because model and implementation changes can be reviewed together.
- Good, because structural errors such as duplicate terms and unknown contexts fail in CI.
- Good, because exact external language remains usable with an explicit mapping or context.
- Bad, because semantic correctness still needs agent and human review.
- Bad, because contributors must update the register when the model changes.
- Neutral, because the first register has one bounded context and can split only when distinct meanings emerge.

### Confirmation

- `docs/domain/ubiquitous-language.yml` safely parses and passes `scripts/validate-domain-language.mjs`.
- Validator tests cover valid data, invalid YAML, missing fields, duplicate contexts and terms, unknown context references, empty definitions and conflicting `avoid` values.
- Contract tests connect `AGENTS.md`, the domain documentation, the skill and metadata, the issue form and the quality workflow.
- The quality workflow parses YAML, runs the domain-language validator and runs the domain contract tests.
- Reviewers inspect changed code, documentation and agentic primitives for the meanings in the affected bounded contexts.
- Reviewers treat a missing, conflicting or changed term as a model change and confirm that it is included in the same change set.

## Pros and Cons of the Options

### Context-scoped canonical register with structural validation and semantic review

- Good, because context determines meaning instead of one vocabulary being imposed everywhere.
- Good, because machine-readable structure supports fast feedback and future tooling.
- Good, because semantic review can consider intent, external language and ambiguity.
- Bad, because the register and its users can still drift unless reviewers apply the contract.

### Repository-wide forbidden-word linter

- Good, because exact word matches are easy to automate.
- Bad, because a word can be valid in another context, an identifier or a quotation.
- Bad, because matching words cannot prove that a sentence expresses the right model.
- Bad, because false positives encourage bypasses and obscure actual ambiguity.

### Text-only guidance

- Good, because it adds almost no tooling.
- Bad, because missing fields, duplicate definitions and broken context references are not detected automatically.
- Bad, because agents cannot reliably locate one canonical set of terms.

## More Information

- Assignment brief: [GitHub issue #5](https://github.com/agentic-delivery-lab/agentic-delivery/issues/5)
- Implementation and review: [pull request #6](https://github.com/agentic-delivery-lab/agentic-delivery/pull/6)
- Domain model and change process: [`docs/domain/README.md`](../domain/README.md)
- Canonical register: [`docs/domain/ubiquitous-language.yml`](../domain/ubiquitous-language.yml)
- Source: [Eric Evans, *Domain-Driven Design Reference* (2015)](https://www.domainlanguage.com/wp-content/uploads/2016/05/DDD_Reference_2015-03.pdf), especially Bounded Context, Ubiquitous Language and Continuous Integration
- Related decision: [ADR-0001](0001-use-madr-for-architecture-decisions.md)
- Related decision: [ADR-0002](0002-use-plain-language-for-human-agent-communication.md)
- Revisit this decision when one term needs incompatible meanings, another domain model emerges, or semantic-review failures show that the register or workflow needs a stronger boundary.
