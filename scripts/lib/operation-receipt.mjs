// agentic-primitive: {"id":"operation-attempt-receipts","kind":"validator","enforcement":"deterministic","adrs":["ADR-0009","ADR-0018"],"domains":["agentic-delivery-governance","agentic-delivery-control-plane"]}
import { randomUUID } from 'node:crypto';
import { mkdir, open, readFile, rename, unlink, lstat } from 'node:fs/promises';
import path from 'node:path';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';

const schema = JSON.parse(await readFile(new URL('../../docs/architecture/operation-attempt-receipt.schema.json', import.meta.url), 'utf8'));
const ajv = new Ajv2020({ strict: false });
addFormats(ajv);
const validate = ajv.compile(schema);

export function createOperationReceipt({ stage, outcome, repository, repositoryId, issue, actor, runId, runAttempt,
  authorityChecked = false, state = {}, shutdown = null, nowMs = Date.now() }) {
  const receipt = structuredClone({
    schemaVersion: 1, stage, operationId: state.operationId ?? null,
    origin: { repository, repositoryId: String(repositoryId), issue: Number(issue) },
    actor: { login: actor || null, authorityChecked },
    run: { id: runId || null, attempt: runAttempt || null },
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
