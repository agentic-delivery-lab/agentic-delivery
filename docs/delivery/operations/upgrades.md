# Control Plane upgrades

Every participant pins an exact controller commit and compatible contract
versions. A merge to the controller's `main` branch is not an implicit
participant upgrade.

1. Publish a draft controller release manifest with SemVer, immutable commit,
   supported event/lifecycle/state-machine/evidence versions, and pinned
   Architecture and Primitive releases.
2. Run all deterministic checks and evaluate every active participant against
   the new release.
3. Run the new controller in shadow mode and compare routing proposals,
   authorization decisions, and evidence identifiers without duplicate writes.
4. Update one participant registry entry at a time through a reviewed pull
   request. Keep old supported participants on their previous commit until
   their intentional upgrade window.
5. Record the release, participant changes, and evidence links. Remove an old
   compatibility path only after the published support window and a complete
   release cycle without fallback use.

Incompatible changes use expand/migrate/contract. A security withdrawal may
fail closed, but the incident and replacement commit must be recorded.

