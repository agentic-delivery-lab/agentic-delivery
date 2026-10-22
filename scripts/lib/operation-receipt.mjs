// agentic-primitive: {"id":"operation-attempt-receipts","kind":"validator","enforcement":"deterministic","adrs":["ADR-0009","ADR-0018"],"domains":["agentic-delivery-governance","agentic-delivery-control-plane"]}
import { randomUUID } from 'node:crypto';
import { mkdir, open, readFile, rename, unlink, lstat } from 'node:fs/promises';
import path from 'node:path';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { INITIAL_OPERATION_LIMITS, matchesCurrentOperationPolicy } from './operation-budget-policy.mjs';

const schema = JSON.parse(await readFile(new URL('../../docs/architecture/operation-attempt-receipt.schema.json', import.meta.url), 'utf8'));
const ajv = new Ajv2020({ strict: false });
addFormats(ajv);
const validate = ajv.compile(schema);

// Classifications contain controller-owned codes and instructions, never provider text.
function diagnostic({outcome, state, shutdown, failureCode}) {
  let failureClass = null, stopReason = null;
  if (state.issuedTokenCleanupPending || shutdown?.issuedTokenRevocationConfirmed === false) {
    failureClass = 'credential-cleanup'; stopReason = 'issued-token-revocation-unconfirmed';
  } else if (shutdown && (!shutdown.ownedExecutionStopped || !shutdown.activeTimeSettled)) {
    failureClass = 'shutdown'; stopReason = 'execution-or-time-settlement-unconfirmed';
  } else if (outcome === 'awaiting-human') {
    failureClass = 'clarification'; stopReason = 'source-clarification-required';
  } else if (outcome === 'held') {
    if (failureCode === 'OPERATION_ADMISSION_HOLD') {
      failureClass = 'policy'; stopReason = 'policy-readmission';
    } else if (failureCode === 'VALIDATION_PROFILE_HOLD') {
      failureClass = 'profile'; stopReason = 'validation-profile-readmission';
    } else if (failureCode === 'OPERATION_BUDGET_HOLD') {
      if (!state.operationId) {
        failureClass = 'budget'; stopReason = 'unknown-consumption';
      } else if (!matchesCurrentOperationPolicy(state.budgetPolicyReference)) {
        failureClass = 'policy'; stopReason = 'policy-readmission';
      } else {
        failureClass = 'budget';
        const unknown = !state.operationId || !state.activeTime || ['controllerAttemptCount','modelTurnCount','validationAttemptCount'].some((key) => !Number.isSafeInteger(state[key]));
        const exhausted = [
          ['active-time-limit', state.activeTime?.spentMs, INITIAL_OPERATION_LIMITS.activeTimeMs],
          ['controller-attempt-limit', state.controllerAttemptCount, INITIAL_OPERATION_LIMITS.controllerAttempts],
          ['validation-attempt-limit', state.validationAttemptCount, INITIAL_OPERATION_LIMITS.validationAttempts],
          ['model-turn-limit', state.modelTurnCount, INITIAL_OPERATION_LIMITS.modelTurns],
        ].find(([,spent,limit]) => Number.isSafeInteger(spent) && spent >= limit);
        stopReason = unknown ? 'unknown-consumption' : exhausted?.[0] ?? 'resource-reservation-unconfirmed';
      }
    } else { failureClass = 'execution'; stopReason = 'execution-held'; }
  }
  const actions = {
    'credential-cleanup':'Interactive operator: reconcile token issuance and revocation before resuming; preserve the checkpoint and ownership lock.',
    shutdown:'Interactive operator: verify owned execution has stopped and reconcile its active-time reservation before resuming.',
    clarification:'Interactive operator: answer the pending clarification on the source Issue, then revalidate the same operation.',
    profile:'Interactive operator: readmit the exact trusted validation profile without resetting operation consumption.',
    policy:'Interactive operator: reconcile the immutable policy and operation history before readmission; do not reset consumption.',
    budget:'Interactive operator: reconcile the source, remaining allowance and uncertain reservations without resetting spent consumption.',
    execution:'Interactive operator: inspect the source Issue and preserved checkpoint, reconcile uncertain actions, then revalidate admission.',
  };
  return {failureClass,stopReason,recoveryAction:failureClass ? actions[failureClass] : null};
}

export function createOperationReceipt({ stage, outcome, repository, repositoryId, issue, actor, runId, runAttempt,
  authorityChecked = false, state = {}, shutdown = null, failureCode = null, nowMs = Date.now() }) {
  const receipt = structuredClone({
    schemaVersion: 2, stage, operationId: state.operationId ?? null,
    origin: { repository, repositoryId: String(repositoryId), issue: Number(issue) },
    actor: { login: actor || null, authorityChecked },
    run: { id: runId || null, attempt: runAttempt || null },
    configuredLimits: matchesCurrentOperationPolicy(state.budgetPolicyReference) ? INITIAL_OPERATION_LIMITS : null,
    ...diagnostic({outcome,state,shutdown,failureCode}),
    policy: state.budgetPolicyReference ?? null, profile: state.validationProfileReference ?? null,
    consumption: { controllerAttempts: state.controllerAttemptCount ?? null, modelTurns: state.modelTurnCount ?? null,
      validationAttempts: state.validationAttemptCount ?? null, toolInvocations: null },
    activeTime: state.activeTime ?? null, authorityContext: null, outcome, shutdown,
    priorIssuedTokenCleanupPending: state.issuedTokenCleanupPending ?? false,
    recordedAt: new Date(nowMs).toISOString(),
  });
  if (!validate(receipt)) throw new Error(`Operation receipt is invalid: ${ajv.errorsText(validate.errors)}`);
  return receipt;
}

export async function writeOperationReceipt(issueRoot, receipt) {
  if (!validate(receipt)) throw new Error('Operation receipt is invalid.');
  const root = path.join(issueRoot, 'operation-receipts');
  await mkdir(root, { recursive: true, mode: 0o700 });
  const info = await lstat(root);
  if (!info.isDirectory() || info.isSymbolicLink()
    || (process.platform !== 'win32' && ((info.mode & 0o077) !== 0 || info.uid !== process.getuid()))) {
    throw new Error('Operation receipt journal requires an owned private directory.');
  }
  const file = path.join(root, `${randomUUID()}.json`);
  const temporary = `${file}.next`;
  let handle;
  try {
    handle = await open(temporary, 'wx', 0o600);
    await handle.writeFile(`${JSON.stringify(receipt, null, 2)}\n`);
    await handle.sync();
    await handle.close(); handle = null;
    await rename(temporary, file);
    // Node cannot open directory handles on Windows. File sync and rename
    // remain available; production durability admission is evaluated separately.
    if (process.platform !== 'win32') {
      const directory = await open(root, 'r');
      try { await directory.sync(); } finally { await directory.close(); }
    }
    return file;
  } finally {
    await handle?.close();
    await unlink(temporary).catch((error) => { if (error.code !== 'ENOENT') throw error; });
  }
}
