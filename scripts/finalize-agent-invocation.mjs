// agentic-primitive: {"id":"agent-invocation-finalizer","kind":"script","enforcement":"deterministic","adrs":["ADR-0018"],"domains":["agentic-delivery-control-plane"]}
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { unwrapRepositoryDispatchClientPayload } from './lib/agent-invocation.mjs';
import { controllerRunLeaseToken, replayKey } from './lib/replay-protection.mjs';
import { NeonReplayStore } from './lib/neon-replay-store.mjs';

export async function finalizeAgentInvocation({ env = process.env, store } = {}) {
  if (!env.GITHUB_EVENT_PATH) throw new Error('Agent invocation finalization requires the GitHub event payload.');
  const envelope = unwrapRepositoryDispatchClientPayload(JSON.parse(await readFile(env.GITHUB_EVENT_PATH, 'utf8'))?.client_payload);
  const key = replayKey({ installationId: envelope?.installation_id, deliveryId: envelope?.delivery_id });
  const leaseToken = controllerRunLeaseToken(env);
  const activeStore = store ?? (env.AGENTIC_DELIVERY_REPLAY_DATABASE_URL
    ? new NeonReplayStore({ connectionString: env.AGENTIC_DELIVERY_REPLAY_DATABASE_URL })
    : null);
  if (!activeStore) throw new Error('Agent invocation finalization requires the shared Neon replay database.');
  if (env.INVOCATION_RESULT === 'success') {
    await activeStore.completeController(key, { leaseToken });
    return { status: 'completed' };
  }
  await activeStore.retryController(key, { leaseToken });
  return { status: 'retryable' };
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
