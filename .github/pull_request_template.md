## Summary

<!-- State what changed and why it matters to readers. Keep new repository documentation in plain English. -->

## Source and decision tracking

- Source issue: <!-- link the assignment issue -->
- ADR tracking issue: <!-- link it when this change contains an architecture decision record; otherwise write None -->
- Closing reference: <!-- use `Closes #123` for the ADR tracking issue, or `Refs #123` when a broader source issue must remain open -->

## Delivery workflow

- [ ] The review pull request head is this feature branch and the base is `main`.
- [ ] The branch is short-lived and contains one coherent change.
- [ ] Every non-merge commit follows Conventional Commits and places an official Gitmoji immediately after the prefix.
- [ ] The pull-request title follows the same commit contract.
- [ ] The chosen merge method is a merge commit; no squash, rebase or auto-merge is planned.

## Changelog

- [ ] I reviewed whether this change belongs in [`CHANGELOG.md`](../CHANGELOG.md).
- [ ] Relevant user-facing changes are under `[Unreleased]` with the appropriate Keep a Changelog category.
- [ ] This pull request does not invent a release, tag or release date.

## Domain and documentation review

- Affected bounded context(s): <!-- use the register, or write None -->
- Affected domain term(s): <!-- use the register, or write None -->
- [ ] I read the relevant domain guide and canonical register before changing domain-bearing artifacts.
- [ ] Missing, conflicting or changed domain terms are updated in the same change set.
- [ ] Exact external names, identifiers and quotations retain their required spelling and context.

## Structural checks and semantic review

<!-- CI can validate structure and syntax. It cannot decide whether commit intent, Gitmoji, changelog relevance or domain meaning is correct. -->

- [ ] Structural checks pass locally or in CI.
- [ ] I reviewed semantic intent, affected bounded contexts, documentation clarity and release impact.

## Verification

<!-- List the commands or checks that provide evidence for this change. -->
