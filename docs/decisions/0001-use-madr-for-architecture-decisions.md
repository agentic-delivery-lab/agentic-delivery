---
status: proposed
date: 2026-09-05
source-issue: https://github.com/sjefsharp/agentic-delivery/issues/1
decision-makers: Sjef Jenniskens
---

# Use MADR and GitHub Issues for Architectural Decisions

## Context and Problem Statement

Issue [#1](https://github.com/sjefsharp/agentic-delivery/issues/1) asks how this repository should capture architectural decisions and how ChatGPT and Codex CLI should participate in that process. The repository has no existing ADR convention, documentation index, or agent-specific workflow to preserve.

We need a process that keeps the reason for a decision discoverable after the implementation has changed, gives a human an explicit acceptance point, and is practical for both contributors and coding agents. The process must distinguish a durable decision from the issue that requested an investigation and must leave an auditable path from request to accepted record.

## Decision Drivers

- Keep decisions close to the repository and version them with the code they explain.
- Make the format readable in GitHub and straightforward for agents to parse and produce.
- Preserve the issue as an audit trail for the request, evidence and discussion.
- Require human review before a proposed decision becomes accepted.
- Avoid a runtime dependency or a heavyweight service for a small repository.
- Make the workflow reusable from both ChatGPT and Codex CLI.

## Considered Options

### MADR records in `docs/decisions/` with an issue and pull request

Use Markdown Architectural Decision Records with a global four-digit sequence. A GitHub Issue is the source brief, a pull request contains the proposed record, and a human review changes its status to `accepted` before merge. A concise root `AGENTS.md` routes relevant work to a repository skill under `.agents/skills/architecture-decision/`.

### ADR tooling with a separate generated or managed store

Adopt a dedicated ADR CLI or external documentation service to create, number and publish records. This could provide stronger automation, but it adds installation, versioning and hosting concerns before the repository has an established application toolchain.

### GitHub Issues only, with agent instructions in `AGENTS.md`

Keep the decision, discussion and status in issues and add a short instruction to agents. This has a good audit trail, but the durable rationale is mixed with tracker conversation and is less useful when browsing the repository at a later date. `AGENTS.md` alone would also duplicate process details and is not a decision record.

## Decision Outcome

Chosen option: **MADR records in `docs/decisions/` with an issue and pull request**.

Architectural decisions will be stored as Markdown files named `NNNN-title-with-dashes.md`, starting at `0001` and using one global sequence. Each record follows the project template in [`adr-template.md`](adr-template.md) and contains a required source-issue link. The index in [`README.md`](README.md) is the canonical process description.

The workflow is:

1. Open a GitHub Issue as the assignment brief and capture the context, drivers, constraints, options and owner.
2. Check the criteria in the index. If a decision is architecturally significant, create one ADR in a pull request with status `proposed`.
3. Link the issue, ADR and pull request in both directions. Record research and rejected alternatives in the ADR rather than replacing the issue history.
4. A human reviewer explicitly approves the rationale and consequences. Only then may the status change to `accepted` and the pull request merge.
5. Close the source issue through the merged pull request and keep the accepted ADR as the durable record.
6. If the decision changes, create a new numbered ADR with status `accepted` or `proposed` as appropriate and mark the old record `superseded by ADR-NNNN`. Never delete the old record.

The lifecycle is `proposed` → `accepted` → `deprecated` or `superseded by ADR-NNNN`. A rejected proposal remains available in its pull request history; if it is retained as a file, its status must state `rejected` and explain why.

For agent support, root `AGENTS.md` will contain only a short routing rule and a link to the canonical process. The repository skill will contain the actionable workflow: retrieve/read the source issue, test the criteria, produce a complete `proposed` ADR, link the artifacts, and stop at the human approval boundary. `codex exec`, MCP and GitHub Actions may be used later to prepare or validate artifacts, but none may accept an ADR or close an issue without explicit human direction.

### Consequences

- Good, because a contributor can find all decisions under one predictable path and review them as ordinary Markdown.
- Good, because the issue, pull request and ADR provide separate but linked records for request, review and durable rationale.
- Good, because MADR's context/options/outcome/consequences structure supports concise human review and structured agent output.
- Good, because repository skills are discoverable by Codex CLI and use the same skill format that ChatGPT can invoke or import.
- Bad, because a global sequence can require coordination when two branches add ADRs concurrently.
- Bad, because acceptance remains a deliberate human step and therefore cannot be fully automated.
- Bad, because ChatGPT repository-skill discovery must be verified in the target ChatGPT surface; Codex CLI auto-discovery is the guaranteed local path.

### Confirmation

- This record is created as `proposed` from issue #1 and is not considered accepted until a human review changes its status in the implementation pull request.
- The implementation must add the index, template, issue form, `AGENTS.md` routing rule, repository skill and structural checks described in the linked plan.
- A positive trigger test must produce a `proposed` ADR; a local and reversible change must not produce one; and an agent must stop before acceptance.
- Pull-request checks must reject missing required sections, invalid status values, duplicate ADR numbers and missing source-issue links.

## Pros and Cons of the Options

### MADR records in `docs/decisions/` with an issue and pull request

* Good, because it follows MADR's documented Markdown and naming conventions.
* Good, because the repository remains self-contained and reviewable without a service.
* Good, because the issue-to-PR-to-ADR chain gives a clear audit trail.
* Neutral, because numbering is simple but must be checked for concurrent additions.

### ADR tooling with a separate generated or managed store

* Good, because a tool could automate scaffolding and numbering.
* Bad, because it introduces an additional dependency and operational decision before it is needed.
* Bad, because hosted or generated output can drift from the Git history unless carefully maintained.

### GitHub Issues only, with agent instructions in `AGENTS.md`

* Good, because issue discussion and permissions already exist.
* Bad, because durable rationale is harder to discover and compare in a list of operational issues.
* Bad, because `AGENTS.md` would become a process manual rather than concise repository guidance.

## More Information

- Assignment brief: [GitHub issue #1](https://github.com/sjefsharp/agentic-delivery/issues/1)
- Format reference: [MADR](https://adr.github.io/madr/)
- Agent instruction loading: [OpenAI Docs — AGENTS.md](https://developers.openai.com/codex/guides/agents-md)
- Reusable workflows: [OpenAI Docs — Build skills](https://developers.openai.com/codex/skills)
- Non-interactive automation: [OpenAI Docs — Codex CLI developer commands](https://developers.openai.com/codex/cli/reference)
- Implementation checklist: [`tasks/todo.md`](../../tasks/todo.md)
