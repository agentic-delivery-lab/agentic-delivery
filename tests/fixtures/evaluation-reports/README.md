# Evaluation report schema snapshot

The report YAML files here are offline test data. The tests read the report
schema directly from its pinned Architecture Git commit and verify its SHA-256
before compiling it. They do not carry a second copy of that contract.

The feature branch depends on Architecture PR #14 and must not be merged until
that contract has been reviewed and merged; the tests do not make it a default
participant or controller-release dependency.

The YAML report examples are synthetic test data, even when their `classification`
field is set to `observed` to exercise the actionable routing path. Their
evidence references and source pins do not claim a real evaluation.
