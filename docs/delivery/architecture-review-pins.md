# Architecture review pins

For manifest schemaVersion 2, the read-only Architecture pin check accepts
the complete historical 4.0.0
contract set and the reviewed 5.1.0 sets with index 3.0.0 or 4.0.0, inventory
1.1.0, evaluation report 2.0.0 and Requirements reference 1.0.0. Each supported
set also requires conformance and architecture artifacts 1.0.0. Missing,
unknown or mixed contract versions fail closed. Historical contracts retain
their original version; this reader does not rewrite them.

The check still requires an immutable commit, the exact checked-out head by
default, the expected source repository, required paths and policy/tooling
hashes, and a content digest reproduced by the tool at that commit. The
unchanged pinned digest script runs through its physical path so Node can
recognize its CLI entry point when the host temporary directory is a symlink. A draft
can supply development review evidence. Passing the check does not approve an
operation context, update controller dependencies, admit a validation profile
or activate a participant. Issue #106 retains its approved-context gate.

The repository tests use the immutable Architecture fixture at
`59df514a3a6dc8a75b79b3fc75fe61aae4e6fdf3` and its reviewed predecessor
`6392c3770219304a78393faac42276e12eb1525f`. CI checks out the exact fixture
separately from the evaluation-report contract; it does not change that
report contract pin. Set `ARCHITECTURE_PIN_TEST_ROOT` to an already fetched
Architecture checkout containing both commits when running these tests away
from the usual sibling layout. A missing fixture fails rather than skipping
these compatibility tests. Test clones are owned fixtures in the sibling
`agentic-delivery.worktrees` container and are removed after each test.

Source: Control Plane #105 and the original W16 remediation plan. This is
review-reader preparation for the coordinated release graph, with no runtime
context injection or release/tag publication. Reverting this source change
restores the historical reader; consumers remain pinned until their separate
reviewed migration.
