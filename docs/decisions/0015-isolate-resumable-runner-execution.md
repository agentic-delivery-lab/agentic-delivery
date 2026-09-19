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

# Isolate resumable runner execution by source issue

## Context and Problem Statement

Exact Codex continuation requires deliberate persistence, but the current
runner exposes one shared Codex home, checkout boundary, and account context.
That allows a later job to inherit another issue's session, credentials, or
working tree unless every caller behaves perfectly.

## Decision Drivers

- Preserve exact continuation for recoverable delivery runs.
- Make unrelated runs unable to inherit sessions, checkouts, or credentials.
- Keep credentials in the protected service-account store and never copy them
  into durable issue state.
- Remove sensitive execution material after successful publication or explicit
  abandonment.

## Considered Options

- Per-issue resumable session state with per-run temporary homes and tools.
- One shared persistent Codex home for all issues.
- Fully ephemeral execution with no persisted session or checkout.

## Decision Outcome

Chosen option: **Per-issue resumable state with per-run temporary execution
material**, because it preserves the exact-session contract while making the
unit of isolation explicit.

Each source issue receives a protected state directory and Codex session home.
The controller bridges authentication only while the Codex process runs;
credential-free session data may remain for an intentional recoverable pause.
Each run uses a fresh temporary `HOME`, tool directory, and environment
allowlist. Successful publication or abandonment removes the checkout, session,
tools, temporary credentials, and locks after the audit outbox is flushed.
Recoverable pauses retain only the explicitly required continuation state and
are never selected for another issue.

### Consequences

- Good, because exact continuation survives a recoverable pause.
- Good, because a later issue cannot accidentally discover another issue's
  session or checkout.
- Bad, because retention and cleanup need tests and operator tooling.
- Neutral, because the runner still retains deliberate lifecycle data until
  the run is completed or abandoned.

### Confirmation

Tests verify per-issue paths, file permissions, environment allowlists,
authentication-bridge removal, success/failure cleanup, recoverable retention,
lock handling, and no cross-issue session reuse. The self-hosted smoke check
must verify the boundary without a model turn.

## Pros and Cons of the Options

### Per-issue resumable state and per-run temporary material

- Good, because it balances continuation with isolation.
- Bad, because it requires explicit cleanup and retention code.

### Shared persistent Codex home

- Good, because it is simple and supports resume by default.
- Bad, because sessions and credentials cross issue boundaries.

### Fully ephemeral execution

- Good, because cleanup is simple and inheritance is impossible.
- Bad, because it breaks exact continuation and the existing quota-recovery
  contract.

## More Information

- Refines [Run Codex from source issues with a budget boundary](0009-run-codex-from-source-issues-with-a-budget-boundary.md).
- Delivery-ID and conversation correlation for tagged continuations are
  specified by [ADR-0017](0017-use-an-explicit-agent-invocation-boundary.md).
- This record is provisional until its review pull request is merged into
  `main`.
