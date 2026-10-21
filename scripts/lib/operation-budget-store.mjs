// agentic-primitive: {"id":"operation-resource-budget-store","kind":"validator","enforcement":"deterministic","adrs":["ADR-0009","ADR-0018"],"domains":["agentic-delivery-governance","agentic-delivery-control-plane"]}
const resources = Object.freeze({
  model: { column:'model_turns', limit:8 }, validation: { column:'validation_attempts', limit:3 },
  transport: { column:'transport_attempts', limit:8 },
  controller: { column:'controller_attempts', limit:8 },
});
const scopeKeys = ['operationId','repositoryId','issue','controllerCommit','policySha256','contextSha256','runtimeSha256'];
const hex = (value, length) => typeof value === 'string' && new RegExp(`^[0-9a-f]{${length}}$`).test(value);
const hold = (message) => Object.assign(new Error(message), {code:'OPERATION_BUDGET_HOLD'});
const exact = (value, keys) => value && typeof value === 'object' && Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value,key));
function inputs(scope, fence) {
  if (!exact(scope,scopeKeys) || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(scope.operationId)
    || !/^[1-9][0-9]*$/.test(scope.repositoryId) || !Number.isSafeInteger(scope.issue) || scope.issue < 1
    || !hex(scope.controllerCommit,40) || !['policySha256','contextSha256','runtimeSha256'].every((key) => hex(scope[key],64))) throw hold('Operation budget scope is invalid.');
  if (!exact(fence,['replayKey','leaseToken','workflowRunId','workflowRunAttempt'])
    || typeof fence.replayKey !== 'string' || !fence.replayKey || fence.replayKey.length > 256
    || !/^[1-9][0-9]*$/.test(fence.workflowRunId) || !Number.isSafeInteger(fence.workflowRunAttempt) || fence.workflowRunAttempt < 1
    || fence.leaseToken !== `${fence.workflowRunId}:${fence.workflowRunAttempt}`) throw hold('Operation budget lease identity is invalid.');
  return [...scopeKeys.map((key) => scope[key]),fence.replayKey,fence.leaseToken,fence.workflowRunId,fence.workflowRunAttempt];
}
const scopeMatch = `b.operation_id = $1::uuid AND b.origin_repository_id = $2::bigint AND b.source_issue_number = $3::integer
  AND b.controller_commit = $4 AND b.policy_sha256 = $5 AND b.context_sha256 = $6 AND b.runtime_sha256 = $7`;
const fenceMatch = `r.replay_key = $8 AND r.status = 'running' AND r.lease_token = $9
  AND r.lease_expires_at > clock_timestamp() AND r.expires_at > clock_timestamp()
  AND r.origin_repository_id = $2::bigint AND r.source_issue_number = $3::integer
  AND r.controller_commit = $4 AND r.workflow_run_id = $10 AND r.workflow_run_attempt = $11::integer`;

export class OperationBudgetStore {
  constructor({client} = {}) {
    if (typeof client?.query !== 'function') throw hold('An admitted operation budget store is required.');
    this.client = client;
  }
  async query(statement, values) {
    try {
      const rows = await this.client.query(statement,values);
      if (!Array.isArray(rows)) throw new Error();
      return rows;
    } catch { throw hold('Operation budget storage outcome is uncertain; reconcile before retrying protected work.'); }
  }
  async initialize(scope, consumed, fence) {
    const values = inputs(scope,fence);
    if (!exact(consumed,Object.keys(resources)) || Object.entries(resources).some(([key,{limit}]) => !Number.isSafeInteger(consumed[key]) || consumed[key] < 0 || consumed[key] > limit)) throw hold('Operation consumption is unknown or invalid.');
    const columns = Object.values(resources).map(({column}) => column);
    const rows = await this.query(`INSERT INTO public.delivery_operation_budgets AS b
      (operation_id,origin_repository_id,source_issue_number,controller_commit,policy_sha256,context_sha256,runtime_sha256,${columns.join(',')})
      SELECT $1::uuid,$2::bigint,$3::integer,$4,$5,$6,$7,$12::integer,$13::integer,$14::integer,$15::integer,$16::integer
      WHERE EXISTS (SELECT 1 FROM public.webhook_controller_receipts AS r WHERE ${fenceMatch})
      ON CONFLICT (origin_repository_id,source_issue_number) DO UPDATE SET operation_id = b.operation_id
      WHERE ${scopeMatch} AND ${columns.map((column,index) => `b.${column} >= $${12+index}::integer`).join(' AND ')}
      RETURNING b.*`, [...values,...Object.keys(resources).map((key) => consumed[key])]);
    if (rows.length !== 1) throw hold('Operation budget identity, lease or consumption requires readmission.');
    return rows[0];
  }
  async reserve(scope, resource, requestKey, fence) {
    const values = inputs(scope,fence);
    if (!Object.hasOwn(resources,resource) || !hex(requestKey,64)) throw hold('Operation budget resource or request identity is invalid.');
    // Identifiers and limits come only from this compiled policy, never payload SQL.
    const {column,limit} = resources[resource];
    const rows = await this.query(`WITH reservation AS (
      INSERT INTO public.delivery_operation_reservations
        (operation_id,request_key,resource,receipt_replay_key,lease_token,workflow_run_id,workflow_run_attempt)
      SELECT b.operation_id,$12,$13,$8,$9,$10,$11::integer
      FROM public.delivery_operation_budgets AS b
      WHERE ${scopeMatch} AND b.${column} < ${limit}
        AND EXISTS (SELECT 1 FROM public.webhook_controller_receipts AS r WHERE ${fenceMatch})
      ON CONFLICT (operation_id,request_key) DO NOTHING RETURNING operation_id
    ) UPDATE public.delivery_operation_budgets AS b
      SET ${column} = b.${column} + 1, updated_at = clock_timestamp()
      FROM reservation AS reserved
      WHERE b.operation_id = reserved.operation_id AND ${scopeMatch} AND b.${column} < ${limit}
        AND EXISTS (SELECT 1 FROM public.webhook_controller_receipts AS r WHERE ${fenceMatch})
      RETURNING b.*`, [...values,requestKey,resource]);
    // A lost response stays charged. Reusing its key never authorizes execution twice.
    return rows.length === 1 ? {allowed:true,consumption:rows[0]} : {allowed:false};
  }
}
