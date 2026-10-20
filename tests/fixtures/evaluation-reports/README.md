# Evaluation report schema snapshot

The report YAML files here are offline test data. The tests read the report
schema directly from its pinned Architecture Git commit and verify its SHA-256
before compiling it. They do not carry a second copy of that contract.

The fixtures use Evaluation Report 2.0.0 from Architecture draft
`0.1.0-draft.24` at commit
`7b1d21462f70c411e75ae67ce80dcf688c9973e8`. Tests read the schema from that
exact commit and verify its SHA-256 before compiling it. This draft pin supports
offline contract validation only; it does not approve runtime adoption or make
the schema a default participant or controller-release dependency.

The YAML report examples are synthetic test data, even when their `classification`
field is set to `observed` to exercise the actionable routing path. Their
evidence references and source pins do not claim a real evaluation.
