# Control Plane upgrades

Every participant pins an exact controller commit and compatible contract
versions. A merge to the controller's `main` branch is not an implicit
participant upgrade.

1. Publish a draft controller release manifest with SemVer, immutable commit,
   supported event/lifecycle/state-machine/evidence versions, the GitHub App
   contract version, and pinned Architecture and Primitive releases.
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

For the Control Plane's own intake workflow, the trusted bootstrap reads the
participant registry from `bootstrapCommit`. Update the central participant
pin in one reviewed pull request while retaining the current bootstrap. After
that pull request merges, use a second reviewed pull request to advance
`bootstrapCommit` and the matching workflow checkout refs to the first merge
commit. In that second change, run the issue-field masker from the updated
trusted bootstrap checkout (`working-directory: trusted-intake`) before
semantic classification. In the delivery job, check out the same bootstrap at
`trusted-bootstrap` and run its masker before source issue delivery. The
bootstrap then provides one versioned masker to every supported participant
pin, preserving compatibility and rollback. The workflow contract test should
verify both masker working directories and that each masker runs before its
consumer. Until the second change merges, intake continues to resolve the old
participant pin.

## Issue #60: staged routing repair

Draft `0.2.0-draft.66` pins the merged routing-schema repair at
`08728c4210ec2d227eec2b6c182dcf3bafd80db1`. The first change updates only the
central participant's controller version and commit. All participants remain
in shadow mode, their interface contracts and dependency pins stay unchanged,
and draft65 remains supported for rollback.

The bootstrap remains `01503edac6533370b24f2e882e6ea1f7b2a21304` during this
first step. After its review pull request merges, prepare the second change
using that merge commit as the bootstrap source. Record both review links and
the operator approval before retrying the remaining approved central issue
canary. A merged manifest alone does not prove live semantic routing recovery.

The existing Distribution bundle still pins draft37 and Architecture draft8.
The explicit-root release-chain check therefore reports seven mismatches on
both the previous manifest and this draft. Controller-local checks and
reproduced dependency digests do not establish a synchronized Distribution
release. Record this limitation separately from central shadow intake evidence;
participant activation and a Distribution upgrade require their own reviewed
changes and complete release-chain verification.

Incompatible changes use expand/migrate/contract. A security withdrawal may
fail closed, but the incident and replacement commit must be recorded.
