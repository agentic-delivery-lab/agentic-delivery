# Credential rotation

GitHub App private keys, webhook secrets, dispatch-signing secrets, and
workflow publication credentials belong to central secret storage. They are
never committed to the Control Plane, a consumer, `.github-private`, or an
agent profile.

1. Create the replacement credential in the central secret store with the
   least permission required by the App contract.
2. Deploy the replacement alongside the current credential and verify a
   signed event, installation-token mint, controller dispatch, and origin
   mutation in shadow or a controlled test participant.
3. Revoke the old credential only after evidence confirms the replacement is
   active and the old value is absent from logs, runner environments, and
   workflow inputs.
4. Record the rotation timestamp, affected installation, validation evidence,
   and rollback owner without recording secret material.

Consumer workflows use their normal `GITHUB_TOKEN` only for local read-only
work. They do not receive the App private key or central dispatch secret.

