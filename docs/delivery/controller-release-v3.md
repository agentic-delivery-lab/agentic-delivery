# Controller release contract v3

Source: [Control Plane #105](https://github.com/agentic-delivery-lab/agentic-delivery/issues/105)
and the original W16 remediation plan under
[Architecture #11](https://github.com/agentic-delivery-lab/agentic-delivery-architecture/issues/11),
coordinated with [Architecture #7](https://github.com/agentic-delivery-lab/agentic-delivery-architecture/issues/7)
and [Distribution #2](https://github.com/agentic-delivery-lab/agentic-delivery-distribution/issues/2).
This implements the existing ADR-0018 ownership and immutable-pin boundary;
it does not add a new authority or change a participant's mode.

V3 current dependency pins contain exactly repository, repositoryId, version,
commit and contentSha256. Architecture is native repository1380894616;
AgentCustomizations is native repository1380894656 at its current name.
IDs are integers and digests are required. Wrong identities, partial native
pins, null digests and unknown fields reject before dependency admission.
Matching metadata alone does not prove hosting access or runtime approval.

The historical v1/v2 schemas remain immutable. V3 compatibility entries can
retain the complete historical idless dependency shape or the complete native
shape. They cannot mix the two. The catalog must contain the exact current
controller's contracts and dependency pins; a mismatched catalog entry cannot
supply another set of inputs for the same current version/commit. Historical
pins remain available for explicit rollback.

Primitive selection1.1 retains its string-typed native ID. Its comparison with
v3 dependencies is an explicit version boundary: each side must equal its
own declared ID representation, and version, commit and digest must match.
No generic coercion or name-only fallback admits a v3 dependency. Callers pass
`dependencySchemaVersion: 3` after validating the controller manifest.

The forward graph separates the immutable runtime-code commit, trusted
bootstrap commit and workflow-source commit. Bootstrap enrollment selects a
supported controller; publishing new release metadata does not migrate that
enrollment. The delivery runtime does not load its own release manifest as a
substitute for the trusted bootstrap selection. A workflow projection must
bind the declared bootstrap and source commits rather than moving a consumer
back to a stale graph.

Distribution inventory, bundle, plugin, automation and publication provenance
must agree with the selected controller and producer pins. Tests of planned
combinations are compatibility fixtures, not proof that those consumers have
adopted the graph. W16 acceptance still needs the actual accepted source
combination, wrong-ID/digest/version rejection, installation, managed update,
interruption recovery and rollback evidence. Draft metadata does not approve
the Issue #106 runtime context, a validation profile or participant activation.

Rollback selects an exact supported historical controller and its dependency
set. It preserves saved operation consumption and the existing admission
holds; it does not reinstate withdrawn native tool/transport ceilings.
