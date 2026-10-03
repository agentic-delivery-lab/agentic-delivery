# Webhook replay live integration evidence

This record captures the disposable Neon integration run for Control Plane
issue #64 on 2026-10-03. The run applied all replay migrations to a temporary
project, exercised the real database adapter, and deleted the project after
the test completed.

## Environment

- Neon project: `morning-sound-23002890` (`aws-us-east-1`), created at
  `2026-10-03T20:36:34Z`.
- Migrations applied through a direct connection: `0001-webhook-replay-claims.sql`,
  `0002-recoverable-webhook-delivery.sql`,
  `0003-resumable-webhook-scan.sql`,
  `0004-aggregate-webhook-scan-observations.sql`, and
  `0005-queue-webhook-redeliveries.sql`.
- The integration test used the pooled connection URL. No connection URL or
  credential is included in this record.

## Command and result

```sh
AGENTIC_DELIVERY_REPLAY_TEST_DATABASE_URL="$POOLED_URL" \
  node --test tests/delivery/neon-replay-store.test.mjs
```

The run completed with **18 passed, 0 failed, and 0 skipped**. The live test,
`Neon replay integration proves claim, lost-response recovery, expiry, release
and stored columns`, passed in 9.3 seconds. It also exercised eight interrupted
controller leases: an expired final attempt became `exhausted` and was absent
from due redelivery selection.

## Cleanup

The temporary project was deleted after the test. A subsequent
`neon projects list --org-id org-icy-firefly-35085943` returned “You don't have
any projects yet.”
