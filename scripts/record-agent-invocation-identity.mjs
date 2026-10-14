// agentic-primitive: {"id":"agent-invocation-receipt-attribution","kind":"script","enforcement":"deterministic","adrs":["ADR-0018"],"domains":["agentic-delivery-control-plane"]}
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { unwrapRepositoryDispatchClientPayload } from './lib/agent-invocation.mjs';
import {
  assertControllerReceiptEnvelopeIdentity,
  controllerReceiptIdentityFromEnv,
  controllerRunLeaseToken,
  replayKey,
} from './lib/replay-protection.mjs';
import { NeonReplayStore } from './lib/neon-replay-store.mjs';

export async function recordAgentInvocationIdentity({ env = process.env, store } = {}) {
  if (!env.GITHUB_EVENT_PATH) throw new Error('Agent invocation attribution requires the GitHub event payload.');
  const event = JSON.parse(await readFile(env.GITHUB_EVENT_PATH, 'utf8'));
  const envelope = unwrapRepositoryDispatchClientPayload(event?.client_payload);
  const key = replayKey({ installationId: envelope?.installation_id, deliveryId: envelope?.delivery_id });
  const identity = assertControllerReceiptEnvelopeIdentity(envelope, controllerReceiptIdentityFromEnv(env));
  const leaseToken = controllerRunLeaseToken(env);
  const activeStore = store ?? (env.AGENTIC_DELIVERY_REPLAY_DATABASE_URL
    ? new NeonReplayStore({ connectionString: env.AGENTIC_DELIVERY_REPLAY_DATABASE_URL })
    : null);
  if (!activeStore) throw new Error('Agent invocation attribution requires the shared Neon replay database.');
  await activeStore.recordControllerIdentity(key, { leaseToken, identity });
  return { status: 'recorded' };
}

const isMainModule = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMainModule) {
  try {
    await recordAgentInvocationIdentity();
    process.stdout.write('Agent invocation identity recorded.\n');
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}
