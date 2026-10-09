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

The evaluation scenario retains the full synthetic report and its evidence by
report ID, then records a non-actionable hold with no owner target. It does not
call the proposed evaluation router: Control Plane PR #104 remains under
review, pins Evaluation Report 1.0.0, and conflicts with Architecture PR #14's
proposed 2.0.0 contract. The finding remains synthetic and is not relabeled as
observed to reach an owner-verification route.

These tests provide pre-adoption boundary coverage, not composed Project or
evaluation contract conformance. Reconcile the contracts and obtain the
required human review before adding those integrations. API and route-reasoning
adapters are local mocks: the Project-only event is rejected before either
adapter runs, and a delivery-policy rejection produces no protected effect.
No fixture performs a live API or model call, Issue-field mutation, repository
write, pull request, release, participant change, Project mutation or
evaluation run.
