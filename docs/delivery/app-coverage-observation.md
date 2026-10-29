# App coverage observation

Source Issue [#60](https://github.com/agentic-delivery-lab/agentic-delivery/issues/60)
permits read-only permission and configuration inspection. The existing
organization inventory command has an owner-workflow mode, `--app-coverage`,
for that inspection. The ordinary OAuth inventory remains available unchanged.

The audit checks App `5011055`, installation `163255060` and organization
`327861320` against seven fixed factory repository identities, including
Requirements and both GitHub adapters. This list bounds administrative reads;
it does not enroll repositories or replace native GitHub identity authority.

## Supported authentication and scope

The audit reuses the existing App JWT signer, issuance tracking and revocation
helper. An App JWT reads installation metadata and each repository's installation.
For a matching installation it requests a token with exactly one integer
`repository_ids` value and `metadata: read`. Returned permissions and any returned
repository list must match that request. A token-authenticated repository listing
must contain exactly one repository with the expected native ID, canonical name
and organization. The known token is revoked before another repository is queried.

GitHub documents these [installation-token and App JWT interfaces](https://docs.github.com/en/rest/apps/apps)
and the [installation repository listing](https://docs.github.com/en/rest/apps/installations).
No installation-wide token, Issue/Project/content write, installation-selection
change, permission grant or participant change is part of this audit. Token
issuance and revocation are the credential lifecycle operations required for
the metadata read.

## Owner invocation

After source review and acceptance, the delegated owner can invoke the existing
inventory command through `github-app-coverage.yml`:

```sh
gh workflow run github-app-coverage.yml --ref main \
  -f source_commit=<accepted-main-commit>
```

The workflow accepts only the central repository, named owner's native actor ID,
main ref and exact selected source commit. It checks the rerun initiator as well
as the original actor: [GitHub reruns retain the original actor's privileges](https://docs.github.com/en/actions/how-tos/manage-workflow-runs/re-run-workflows-and-jobs).
The source input binds the checked-out code; it is not a runtime approval flag.
Only the metadata step receives the existing central App key. No model process,
consumer checkout, caller-selected target list or additional credential is used.
The environment checks assume GitHub's trusted job context and secret boundary;
arbitrary local environment values do not establish authenticated authority.

The sanitized JSON report is written to the native job log. Bind retained
evidence to its actual workflow, actor, source SHA, run ID and attempt, then
retain the log and digest privately. The report contains no JWT, installation
token, private key, Issue content or private repository content.

## Evidence and stop behavior

`currentFactorySetCoverageVerified` requires positive native identity and token
scope observations for all seven targets, with installation-token cleanup
confirmed. Unavailable or inconsistent observations remain unverified. A 403 or
404 does not prove that a repository or installation is absent.

`allRepositoriesSelected` separately records observed `all` versus `selected`
installation metadata; it is null when that metadata is unavailable. Verified
access to the current seven repositories cannot prove future enrollment.
[Canonical Architecture ADR-0018 at the selected immutable release](https://github.com/agentic-delivery-lab/agentic-delivery-architecture/blob/59df514a3a6dc8a75b79b3fc75fe61aae4e6fdf3/decisions/0018-organization-wide-agentic-delivery-control-plane-distribution-and-versioning.md#decision-outcome)
chooses All-repositories installation access with independent participant
registration. The historical local ADR copy and current versioned App contract
still specify selected-repository access. This audit observes that distinction;
it neither resolves the contract drift nor changes either source of authority.
`runtimeAdmissionAuthorized` and `repositoryMutationsRequested` remain false.
The report has no runtime admission consumer.

API work has a 180-second window, individual execution requests have at most
15 seconds, and responses are limited to 1 MiB. Redirects are rejected and the
audit performs no application-level retries. These windows do not establish an
aggregate bound on the stock HTTP client's internal transport attempts. Existing
token cleanup may use its separate bounded timeout after
execution time expires. Unexpected scope or uncertain issuance/revocation stops
all later minting in this process; the original HTTP failure and cleanup status
remain separate diagnostics.

Preserve a held or interrupted run and reconcile issuance, revocation or expiry
before another audit. The cleanup flag covers this process's installation
tokens; it is not a durable cross-run ledger or proof of whole-state-loss
recovery. W08 budget/store admission, W12 context/profile approval and W13 runner
qualification remain separate. Unit fixtures exercise the reader and its
denials; native App coverage remains unverified until an actual bound owner run
supplies the observations.
