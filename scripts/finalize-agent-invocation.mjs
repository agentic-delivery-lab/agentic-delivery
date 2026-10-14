// agentic-primitive: {"id":"agent-invocation-finalizer","kind":"script","enforcement":"deterministic","adrs":["ADR-0018"],"domains":["agentic-delivery-control-plane"]}
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

const completableRoutes = new Set(['refine', 'research', 'requirements', 'architecture', 'plan', 'implement', 'resume', 'validate', 'coordinate']);

export async function finalizeAgentInvocation({ env = process.env, store } = {}) {
  if (!env.GITHUB_EVENT_PATH) throw new Error('Agent invocation finalization requires the GitHub event payload.');
  const envelope = unwrapRepositoryDispatchClientPayload(JSON.parse(await readFile(env.GITHUB_EVENT_PATH, 'utf8'))?.client_payload);
  const key = replayKey({ installationId: envelope?.installation_id, deliveryId: envelope?.delivery_id });
  const leaseToken = controllerRunLeaseToken(env);
  const identity = assertControllerReceiptEnvelopeIdentity(envelope, controllerReceiptIdentityFromEnv(env));
  if (!['success', 'failure'].includes(env.INVOCATION_RESULT)) throw new Error('Agent invocation finalization requires a terminal workflow result.');
  const activeStore = store ?? (env.AGENTIC_DELIVERY_REPLAY_DATABASE_URL
    ? new NeonReplayStore({ connectionString: env.AGENTIC_DELIVERY_REPLAY_DATABASE_URL })
    : null);
  if (!activeStore) throw new Error('Agent invocation finalization requires the shared Neon replay database.');
  await activeStore.recordControllerIdentity(key, { leaseToken, identity });
  if (env.INVOCATION_RESULT === 'success' && completableRoutes.has(env.INVOCATION_ROUTE)) {
    await activeStore.completeController(key, { leaseToken, identity });
    return { status: 'completed' };
  }
  return activeStore.retryController(key, { leaseToken, identity });
}

const isMainModule = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMainModule) {
  try {
    const result = await finalizeAgentInvocation();
    process.stdout.write(`Agent invocation receipt ${result.status}.\n`);
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}
