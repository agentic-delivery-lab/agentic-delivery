# Repository instructions

## Architectural decisions

- For a costly, cross-cutting, repository-wide, security-sensitive or otherwise significant choice, read [`docs/decisions/README.md`](docs/decisions/README.md) and use `$architecture-decision`.
- Treat a linked GitHub Issue as the assignment brief. It is not automatically an ADR. Keep the source issue, any ADR sub-issue and the review pull request linked.
- When no source issue is supplied, follow the guarded intake in the decisions index and skill. Search read-only, confirm a candidate or preview before creating one, never replace an inaccessible issue, and ask questions only through explicitly authorized issue communication.
- Add or remove an ADR only on a feature branch. The change is provisional there; only the merged contents of `main` are official. Do not merge a pull request or close its tracking issue without explicit human authorization.
- When opening or updating an ADR pull request, include its ADR-tracking issue or sub-issue with a closing reference such as `Closes #123`. GitHub closes that issue only after the PR is merged; approval alone does not close it. Use `Refs #123` when a broader parent issue must remain open.

## Communication

- Follow the user's language for Dutch and English conversations. Use Dutch when the language is mixed or unclear.
- Use plain English for new or changed repository documentation. Keep code, commands, identifiers, quotations and necessary technical terms unchanged.
- Use `$plain-language-communication` when drafting or reviewing human-agent communication or repository documentation.
