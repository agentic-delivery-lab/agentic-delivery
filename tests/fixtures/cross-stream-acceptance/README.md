# Cross-stream offline acceptance fixtures

Every repository ID, repository name, Issue number, Issue node ID, Project ID,
item ID, actor and report pin in `scenarios.json` is synthetic. The fixtures do
not establish a live Project association, product repository, product steward,
owner mapping, participant or evaluation result. `liveGitHubVerification` is
`not-run` because the tests use local adapters only.

The factory and product scenarios pass through the existing Issue intake
router with mocked REST and GraphQL responses. The tests verify the originating
repository, exact Issue node, writer permission, native Issue Type, Lifecycle
Stage, Delivery State, plan state and selected orchestration pattern. Project
planning fields are kept outside the Issue routing input. The product scenario
can reach planning in this synthetic harness, but it does not claim that a
product repository or steward exists.

The Project-only webhook case includes a Project item linked to a synthetic
Issue, but has no source Issue event or Issue number. The actual webhook handler
returns 204 from its event catalog before App-token or API access, and the
direct Issue classifier rejects it when no source Issue number is supplied.
The route harness checks trusted participant and App access
before route reasoning, then passes the selected route and triggering
repository identity through the trusted delivery-participant resolver. A
repository ID mismatch is rejected before API or model-adapter access.
Same-number Issues are routed in both synthetic repositories and retain their
distinct Issue nodes. A delayed event with stale Issue fields still re-fetches
the current synthetic Issue before reasoning. The Project-read failure case
records the missing-scope planning gap and exercises the existing Issue-first
manual recovery route.

The evaluation scenario sends its complete synthetic Evaluation Report 2.0.0
through the offline router using the exact Architecture schema commit recorded
in the fixture. The report includes an owner-Issue assertion, but routing
returns an `awaiting-owner-verification` disposition with no candidate target,
actionable target, proposal, or execution authority. The source report,
evidence, and pins remain preserved. The report is not relabeled as observed.

The pinned schema belongs to Architecture draft `0.1.0-draft.24`. The test
demonstrates offline contract conformance only; it does not approve a release,
change the runtime participant or controller pins, or add a live consumer.
API and route-reasoning adapters are local mocks: the Project-only event is
rejected before either adapter runs, and a delivery-policy rejection produces
no protected effect. No fixture performs a live API or model call, Issue-field
mutation, repository write, pull request, release, participant change, Project
mutation or evaluation run.
