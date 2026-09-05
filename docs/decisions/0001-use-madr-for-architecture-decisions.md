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
- Minimize manual status edits after an approval without giving pull-request code write access.
- Reuse the existing self-hosted runner so a later Codex CLI workflow can replace the deterministic check.
- Avoid a runtime dependency or a heavyweight service for a small repository.
- Make the workflow reusable from both ChatGPT and Codex CLI.

## Considered Options

### MADR records in `docs/decisions/` with an issue and pull request

Use Markdown Architectural Decision Records with a global four-digit sequence. A GitHub Issue is the source brief, a pull request contains the proposed record, and a human review changes its status to `accepted` before merge. A concise root `AGENTS.md` routes relevant work to a repository skill under `.agents/skills/architecture-decision/`.

### MADR records with a direct privileged review workflow

Use a `pull_request_review` workflow that receives the approval event and immediately writes `status: accepted` with a write-capable token. This is compact and also works while the workflow is first introduced, but the workflow definition is part of the reviewed pull-request revision and could therefore alter privileged behavior.

### MADR records with an unprivileged signal and trusted `workflow_run`

Use a review workflow with no permissions or checkout to signal an eligible approval. A separate `workflow_run` workflow, which GitHub loads from the default branch, rechecks the pull request and review through the API and performs the status-only commit on the existing self-hosted runner. This adds one small workflow boundary and intentionally applies after the automation is present on the default branch, but keeps write access away from pull-request-controlled code.

### ADR tooling with a separate generated or managed store

Adopt a dedicated ADR CLI or external documentation service to create, number and publish records. This could provide stronger automation, but it adds installation, versioning and hosting concerns before the repository has an established application toolchain.

### GitHub Issues only, with agent instructions in `AGENTS.md`

Keep the decision, discussion and status in issues and add a short instruction to agents. This has a good audit trail, but the durable rationale is mixed with tracker conversation and is less useful when browsing the repository at a later date. `AGENTS.md` alone would also duplicate process details and is not a decision record.

## Decision Outcome

Chosen option: **MADR records in `docs/decisions/` with an issue and pull request, plus a two-stage approval workflow**.

Architectural decisions will be stored as Markdown files named `NNNN-title-with-dashes.md`, starting at `0001` and using one global sequence. Each record follows the project template in [`adr-template.md`](adr-template.md) and contains a required source-issue link. The index in [`README.md`](README.md) is the canonical process description.

The workflow is:

1. Open a GitHub Issue as the assignment brief and capture the context, drivers, constraints, options and owner.
2. Check the criteria in the index. If a decision is architecturally significant, create one ADR in a pull request with status `proposed`.
3. Link the issue, ADR and pull request in both directions. Record research and rejected alternatives in the ADR rather than replacing the issue history.
4. A human reviewer explicitly approves the rationale and consequences. An unprivileged `pull_request_review` signal then starts the trusted `workflow_run` workflow, which rechecks the approval and changes exactly one proposed ADR to `accepted`.
5. Merge the pull request under the repository's review rules. Use a closing keyword such as `Closes #NNN` so GitHub closes the source issue on merge and keep the accepted ADR as the durable record.
6. If the decision changes, create a new numbered ADR with status `accepted` or `proposed` as appropriate and mark the old record `superseded by ADR-NNNN`. Never delete the old record.

The lifecycle is `proposed` → `accepted` → `deprecated` or `superseded by ADR-NNNN`. A rejected proposal remains available in its pull request history; if it is retained as a file, its status must state `rejected` and explain why.

For agent support, root `AGENTS.md` will contain only a short routing rule and a link to the canonical process. The repository skill will contain the actionable workflow: retrieve/read the source issue, test the criteria, produce a complete `proposed` ADR, link the artifacts, and stop at the human approval boundary. `codex exec`, MCP and GitHub Actions may prepare or validate artifacts; only the trusted post-approval workflow may perform the mechanical status transition, and no agent may accept an ADR or close an issue directly.

### Consequences

- Good, because a contributor can find all decisions under one predictable path and review them as ordinary Markdown.
- Good, because the issue, pull request and ADR provide separate but linked records for request, review and durable rationale.
- Good, because MADR's context/options/outcome/consequences structure supports concise human review and structured agent output.
- Good, because repository skills are discoverable by Codex CLI and use the same skill format that ChatGPT can invoke or import.
- Good, because an approval changes the status automatically while the privileged workflow uses only default-branch code and API checks.
- Good, because the deterministic quality workflow runs on the existing self-hosted runner and leaves a clear seam for a later Codex CLI step.
- Bad, because a global sequence can require coordination when two branches add ADRs concurrently.
- Bad, because the status update is a code-modifying commit and branch protection that dismisses stale reviews may require a second approval.
- Bad, because self-hosted validation requires a trusted private-repository runner; fork pull requests are not accepted automatically.
- Bad, because ChatGPT repository-skill discovery must be verified in the target ChatGPT surface; Codex CLI auto-discovery is the guaranteed local path.

### Confirmation

- This record is created as `proposed` from issue #1 and is not considered accepted until a human review approves the implementation and the trusted workflow changes its status.
- The implementation must add the index, template, issue form, `AGENTS.md` routing rule, repository skill and structural checks described in the linked plan.
- A positive trigger test must produce a `proposed` ADR; a local and reversible change must not produce one; and an agent must stop before acceptance.
- Pull-request checks must reject missing required sections, invalid status values, duplicate ADR numbers and missing source-issue links.
- The acceptance helper and API orchestration tests must cover a valid approval, retries, forks, stale/no approval and ambiguous multi-ADR pull requests.

## Pros and Cons of the Options

### MADR records in `docs/decisions/` with an issue and pull request

- Good, because it follows MADR's documented Markdown and naming conventions.
- Good, because the repository remains self-contained and reviewable without a service.
- Good, because the issue-to-PR-to-ADR chain gives a clear audit trail.
- Neutral, because numbering is simple but must be checked for concurrent additions.

### MADR records with a direct privileged review workflow

- Good, because the status can be changed during the same pull request review event.
- Bad, because a pull request can modify the workflow definition that receives the write-capable event.

### MADR records with an unprivileged signal and trusted `workflow_run`

- Good, because the privileged workflow and mutation script come from the default branch and never execute pull-request code.
- Good, because the signal has no token permissions and fork approvals are ignored.
- Bad, because this automation becomes active for new proposals only after the workflow has been merged to the default branch.

### ADR tooling with a separate generated or managed store

- Good, because a tool could automate scaffolding and numbering.
- Bad, because it introduces an additional dependency and operational decision before it is needed.
- Bad, because hosted or generated output can drift from the Git history unless carefully maintained.

### GitHub Issues only, with agent instructions in `AGENTS.md`

- Good, because issue discussion and permissions already exist.
- Bad, because durable rationale is harder to discover and compare in a list of operational issues.
- Bad, because `AGENTS.md` would become a process manual rather than concise repository guidance.

## More Information

- Assignment brief: [GitHub issue #1](https://github.com/sjefsharp/agentic-delivery/issues/1)
- Review and implementation: [pull request #2](https://github.com/sjefsharp/agentic-delivery/pull/2)
- Format reference: [MADR](https://adr.github.io/madr/)
- Agent instruction loading: [OpenAI Docs — AGENTS.md](https://developers.openai.com/codex/guides/agents-md)
- Reusable workflows: [OpenAI Docs — Build skills](https://developers.openai.com/codex/skills)
- Non-interactive automation: [OpenAI Docs — Codex CLI developer commands](https://developers.openai.com/codex/cli/reference)
- Implementation checklist: [`tasks/todo.md`](../../tasks/todo.md)
