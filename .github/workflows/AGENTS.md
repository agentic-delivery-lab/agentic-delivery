# Central workflow boundary

## Mission

These workflows execute the versioned Delivery Control Plane in the central
`agentic-delivery` repository. They are not organization-wide inherited
workflows and must not replace repository-local CI/CD.

## Rules

- Keep the controller checkout and originating-repository checkout separate.
- Check out the exact bootstrap and controller commits declared by the release
  and participant registry; never fall back to a moving `main` ref.
- Carry the originating repository ID, full name, issue or pull request
  identity, controller pin, and contract versions through every job boundary.
- Pass only explicitly named secrets. Never use `secrets: inherit` or expose
  the App private key to model processes or consumer repositories.
- Keep normal issue events on the central gateway path; manual recovery is a
  rare, audited break-glass operation.
- Leave repository-local security, dependency, release, and application CI
  independent.

## Required validation

Run `pnpm control-plane:boundary`, `pnpm github-app:check`, the acceptance
matrix, the release-chain check, and the full test suite after workflow
changes. A workflow change also requires review of permissions and pin drift.
