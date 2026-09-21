# Migration boundary

## Mission

This directory records the history-preserving extraction of bounded
responsibilities from the mixed source repository. It is migration evidence,
not a second participant registry or runtime state store.

## Rules

- Keep source repository, source ref, source commit, filter tool identity,
  target repository, source map, and publication status explicit.
- Preserve issue and pull-request URLs; never rewrite historical references.
- Mark local-prepared, transitional, pending-entitlement, and ready states
  honestly. A local checkout does not prove remote repository creation,
  protection, entitlement, or activation.
- Keep `.github-private` projections non-canonical and record their Primitive
  source commit and content digest.
- Remove a compatibility bridge only after its target release, parity evidence,
  rollback, and operator authorization exist.

## Required validation

Run `pnpm migration:check` and the target repository tests whenever a boundary,
source path, history filter, or publication status changes.
