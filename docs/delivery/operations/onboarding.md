# Participant onboarding

Onboarding is an explicit, reviewed operation. App repository access alone
does not activate Agentic Delivery, and a registry entry without App access
fails closed.

1. Verify the repository's immutable GitHub repository ID and expected full
   name.
2. Verify the central controller repository name and numeric ID are configured
   in the protected gateway environment; the controller ID has no runtime
   default.
3. Grant the organization GitHub App selected-repository access through the
   operator-owned GitHub settings.
4. Add a reviewed entry to `config/participants.yml` with `mode: shadow`, an
   immutable controller commit, contract versions, Architecture and Primitive
   release pins, and the required event catalog.
5. Add the optional Distribution caller only when repository-local Actions
   execution is required. Do not add App credentials or copy lifecycle logic.
6. Run `pnpm metadata:check`, `pnpm control-plane:check`,
   `pnpm github-app:check`, `pnpm acceptance:check`, and the
   multi-repository contract tests. Treat the acceptance report as offline
   fixture evidence until the separate App/install smoke test is complete.
7. Observe shadow results for the agreed release window. Activate by a second
   reviewed registry change to `mode: active` only after the operator smoke
   test proves origin-scoped mutation.

The App private key remains in the central deployment boundary. The participant
repository receives no private key and does not become a second state store.
