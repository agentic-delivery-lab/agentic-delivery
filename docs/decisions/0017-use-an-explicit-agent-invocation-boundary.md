---
date: 2026-09-19
source-issue: https://github.com/agentic-delivery-lab/agentic-delivery/issues/46
decision-makers: Repository maintainers
consulted: GitHub Docs and Vercel Functions documentation
informed: None
domains:
  - agentic-delivery-governance
required-enforcement:
  - deterministic
---

# Use an explicit agent-invocation boundary for conversation-driven delivery

## Context and Problem Statement

The delivery harness receives work through GitHub Issues, issue comments, pull-
request conversation comments, formal pull-request reviews, and inline review
comments. GitHub exposes these surfaces as different webhook events and does
not provide a separate event for a mention. Treating every comment as an
execution request would start work accidentally; treating comments only as
free-form text would make execution intent ambiguous.

The harness also needs an attributable identity for event-producing operations.
The organization-wide GitHub App distribution decision in
[ADR-0018](0018-organization-wide-agentic-delivery-control-plane-distribution-and-versioning.md)
establishes the token boundary, while this record defines the conversation
activation contract, actor catalog, and handoff rules for registered
automation actors.

## Decision Drivers

- Make a request to start or continue a delivery run explicit and auditable.
- Keep GitHub Issues, pull requests, pinned fields, and deterministic Actions
  as the control plane.
- Keep semantic interpretation separate from deterministic authorization,
  schema, state, capability, and idempotency checks.
- Support issue comments, pull-request conversation comments, formal reviews,
  and inline review comments with one unambiguous activation boundary.
- Use one organization-installed GitHub App identity for event-producing
  operations, narrowed to the originating repository at token issuance.
- Prevent self-triggering, duplicate dispatch, unbounded bot-to-bot handoffs,
  and scope expansion by automation actors.
- Keep webhook secrets, App private keys, and installation tokens out of files,
  logs, and model tools.

## Considered Options

- A GitHub App webhook hosted by a Vercel Function, filtered before a
  `repository_dispatch` handoff.
- A repository workflow listening to all comment events and filtering the
  mention inside a job.
- A long-lived user PAT or user identity for event-producing operations.
- Native GitHub or Copilot mentions only, without a repository-owned actor and
  orchestration contract.

## Decision Outcome

Chosen option: **A repository-scoped GitHub App webhook with an explicit
invocation boundary**, because it gives the repository an attributable
identity, filters irrelevant comments before Actions work is queued, and
preserves a deterministic handoff into the existing control plane.

The registered activation mention is `@agentic-delivery-lab-invoker-7f3a`. It is valid only
when it starts the first actionable Markdown line. Mentions in blockquotes,
inline code, fenced code, or examples are not activation requests. The
webhook accepts the following event/action pairs:

- `issue_comment.created` and `issue_comment.edited`;
- `pull_request_review.submitted` and `pull_request_review.edited`; and
- `pull_request_review_comment.created` and
  `pull_request_review_comment.edited`.

The webhook verifies the GitHub signature, installation, repository, event,
actor, and delivery ID before dispatching an `agent_invocation` event. The
trusted controller fetches the current conversation object by immutable ID,
rechecks the activation digest and repository permission, maps the request to
the source issue, and applies the existing orchestration policy. A tag is an
invocation boundary, not a semantic route: the model may interpret the
conversation only after deterministic checks pass.

Human invocation requires repository permission `write`, `maintain`, or
`admin`. Automation invocation requires an exact allowlisted actor, an already
human-authorized source issue and valid plan/session context, and an unchanged
scope. The App cannot invoke itself. Bot handoffs are limited to one hop from
the human-authorized event, and each delivery ID, conversation ID, and content
digest is deduplicated. Status reactions or comments published by the App
never contain the activation mention.

The versioned actor catalog in `config/agent-actors.json` is the deterministic source for the activation
mention, supported event pairs, human permission levels, App login, and
bot-handoff limits. The initial external-agent allowlist is empty. Adding an
automation actor requires a reviewed catalog change containing its exact
GitHub login and allowed capability; wildcard identities are not permitted.

### Consequences

- Good, because human intent, actor identity, event provenance, and execution
  correlation are visible at the conversation boundary.
- Good, because irrelevant comments do not create an Actions run and the
  controller remains the final authorization boundary.
- Good, because the same contract covers issue and pull-request conversation
  surfaces while keeping native `@copilot` behavior separate.
- Bad, because the repository needs a public webhook endpoint, App
  installation, secret rotation, and an operational smoke test.
- Bad, because a stateless ingress still requires controller-side deduplication
  and persisted continuation correlation.
- Neutral, because internal agent roles remain orchestration profiles rather
  than separate GitHub identities; a separate identity is introduced only for
  an explicitly allowlisted external actor.

### Confirmation

Deterministic checks must validate the actor catalog, activation placement,
event envelope, signature and installation, repository permission, source-issue
lineage, plan/session readiness, delivery-ID/content-digest idempotency, and
hop limit. Tests must prove that untagged, quoted, coded, duplicate, edited,
self-authored, unknown-bot, and out-of-scope events do not start a delivery
run. A production smoke test must trace a tagged comment through the App
webhook and `repository_dispatch` into one correlated Actions run.

## Pros and Cons of the Options

### GitHub App webhook with an explicit invocation boundary

- Good, because the App has a distinct attributable bot identity and can use
  short-lived installation tokens narrowed to one originating repository.
- Good, because filtering and signature validation happen before Actions work
  is queued.
- Bad, because Vercel deployment, GitHub App lifecycle, and secret rotation
  become operational dependencies.

### Workflow-level filtering of every comment event

- Good, because it uses only repository Actions and needs no public ingress.
- Bad, because every comment still queues a workflow run and a workflow cannot
  filter the event trigger on comment-body content.
- Bad, because the mention boundary is later and less useful for ingress-level
  abuse and rate control.

### Long-lived PAT or user identity

- Good, because it is quick to bootstrap.
- Bad, because attribution, rotation, scope, and revocation are weaker than an
  organization-installed App narrowed to one originating repository.

### Native GitHub or Copilot mentions only

- Good, because no repository-owned webhook or actor catalog is required.
- Bad, because it cannot express the repository's common actor, trust, routing,
  idempotency, and continuation contract.

## More Information

- Source and ADR tracking issue: [#46](https://github.com/agentic-delivery-lab/agentic-delivery/issues/46).
- Follow-up implementation issue: [#48](https://github.com/agentic-delivery-lab/agentic-delivery/issues/48).
- Related source issue: [#44](https://github.com/agentic-delivery-lab/agentic-delivery/issues/44).
- [Use GitHub as the lifecycle control plane](0012-use-github-as-the-lifecycle-control-plane.md).
- [Organization-wide Agentic Delivery control-plane distribution and versioning](0018-organization-wide-agentic-delivery-control-plane-distribution-and-versioning.md).
- [Isolate resumable runner execution](0015-isolate-resumable-runner-execution.md).
- [GitHub workflow events](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows).
- [Validate webhook deliveries](https://docs.github.com/en/webhooks/using-webhooks/validating-webhook-deliveries).
- [Webhook best practices](https://docs.github.com/en/webhooks/using-webhooks/best-practices-for-using-webhooks).
- [Vercel Functions](https://vercel.com/docs/functions).

This record is provisional until its review pull request is approved and
merged into `main`.
