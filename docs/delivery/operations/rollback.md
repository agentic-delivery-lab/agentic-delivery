# Control Plane rollback

Rollback restores an exact previously supported controller and contract pin;
it does not follow a moving branch or recreate a second lifecycle.

1. Disable the affected participant registry entry or return it to `shadow`.
2. Stop new central mutations for that participant while preserving the
   delivery and evidence identifiers already recorded.
3. Restore the previous immutable controller, Architecture, Primitive, and
   contract pins through a reviewed pull request.
4. Re-run deterministic validation and a read-only shadow comparison.
5. Re-enable `active` only after an operator confirms one event produces one
   origin-scoped mutation.

If the local workflow was the temporary migration fallback, re-enable it only
through the documented emergency recovery path and remove it after the next
successful release cycle. Never restore credentials or mutable `main` refs as
a rollback shortcut.

