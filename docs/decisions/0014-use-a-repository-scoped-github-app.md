---
date: 2026-09-10
source-issue: https://github.com/agentic-delivery-lab/agentic-delivery/issues/29
decision-makers: Sjef Jenniskens
consulted: None
informed: None
domains:
  - agentic-delivery-governance
required-enforcement:
  - deterministic
---

# Use a repository-scoped GitHub App for event-producing mutations

## Context and Problem Statement

The harness currently uses `GITHUB_TOKEN` for issue communication and a
user-scoped publication PAT for pushes and pull requests. The normal token has
limited event behavior and cannot safely cover every workflow-file publication
case. A long-lived user credential is broader and harder to attribute than a
repository-scoped installation token.

## Decision Drivers

- Use the normal workflow token wherever its permissions and event behavior are
  sufficient.
- Use least privilege for child-issue creation, Git publication, workflow-file
  changes, and pull-request publication.
- Keep credentials in GitHub secrets and out of model tools, files, and logs.
- Support long-running model work without relying on a one-hour token minted at
  job start.

## Considered Options

- A repository-scoped GitHub App with just-in-time installation tokens.
- Continue using the user-scoped fine-grained PAT.
- Use only `GITHUB_TOKEN` and accept its event and permission limitations.

## Decision Outcome

Chosen option: **A repository-scoped GitHub App with just-in-time installation
tokens**, because it gives event-producing operations an attributable,
short-lived identity while retaining `GITHUB_TOKEN` for ordinary control-plane
operations.

The trusted controller signs short-lived App JWTs and requests installation
tokens only when an App-only operation is needed. It refreshes them before
expiry, keeps private keys and tokens in memory, redacts them, and never passes
them to Codex. The installation is limited to this repository and grants
Metadata read plus Issues, Contents, Pull requests, and Workflows write. The
workflow token remains the default for reads, permission checks, labels, and
comments.

### Consequences

- Good, because child issue and publication events can trigger downstream
  workflows with a repository identity.
- Good, because the user PAT is removed from the execution contract.
- Bad, because App installation, rotation, and token-minting diagnostics need
  operational verification.
- Bad, because private-key handling must be carefully isolated from child
  processes.

### Confirmation

Unit tests cover JWT/token refresh, permission requests, redaction, expiry, and
environment allowlists. A controller preflight and a post-merge smoke run must
verify the real installation without exposing credentials.

## Pros and Cons of the Options

### Repository-scoped GitHub App

- Good, because the identity is short-lived, attributable, and repository
  scoped.
- Bad, because it adds installation and rotation configuration.

### User-scoped PAT

- Good, because the current controller already accepts it.
- Bad, because it is long-lived, user-bound, and broader than the event role.

### GITHUB_TOKEN only

- Good, because no additional credential is needed.
- Bad, because its event behavior and workflow-file permissions are not enough
  for the full publication and decomposition lifecycle.

## More Information

- Refines [Run Codex from source issues with a budget boundary](0009-run-codex-from-source-issues-with-a-budget-boundary.md).
- The conversation activation and actor-handoff contract is defined by
  [ADR-0017](0017-use-an-explicit-agent-invocation-boundary.md).
- This record is provisional until its review pull request is merged into
  `main`.
