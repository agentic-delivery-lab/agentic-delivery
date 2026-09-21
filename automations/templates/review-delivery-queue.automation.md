---
version: 1
id: review-delivery-queue
name: Review delivery queue
description: Summarize eligible delivery work without changing repository or GitHub state.
schedule:
  kind: manual
---

Review the current delivery queue for this workspace and its configured
organization context.

Read only. Do not edit files, issues, labels, issue fields, projects, branches,
commits, pull requests, or any external system. Do not start an implementation
run and do not propose a lifecycle mutation as if it were already authorized.

Summarize the observable work items, their native Issue Type, Lifecycle Stage,
Delivery State/legacy Delivery Readiness, blocking evidence, and links. Keep
those dimensions separate. Mark missing or inaccessible data as unknown.
Treat the result as advisory evidence for a human or the Agentic Delivery
Control Plane; GitHub Issues and organization fields remain authoritative.
