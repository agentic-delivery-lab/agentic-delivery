# GitHub App ingress boundary

## Mission

This directory contains the deployment adapter for the central GitHub App
webhook. It authenticates organization events, verifies the event envelope
inputs, checks participant enrollment, and dispatches bounded metadata to the
Delivery Control Plane.

## Ownership

- `api/github/webhook.mjs` owns transport-level signature, organization,
  installation, delivery, actor, replay, and repository-identity checks.
- `config/event-catalog.yml` and `config/participants.yml` are the
  authoritative event and enrollment contracts.
- `scripts/lib/control-plane-contracts.mjs` owns envelope validation shared by
  ingress and the controller.

## Must not do

- Do not implement lifecycle transitions, semantic routing, orchestration, or
  issue-field mutation here.
- Do not select a route from event wording or a repository name.
- Do not use a repository-scoped App private key in an origin repository.
- Do not dispatch an unverified payload-selected controller ref.

## Required validation

Run `pnpm github-app:check`, `pnpm control-plane:boundary`, and the focused
webhook and invocation tests after changes. Changes to the event catalog or
participant registry require the release-chain and multi-repository acceptance
checks as well.
