// agentic-primitive: {"id":"agent-invocation-boundary","kind":"validator","enforcement":"deterministic","adrs":["ADR-0017","ADR-0018"],"domains":["agentic-delivery-governance","agentic-delivery-control-plane"]}
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

export const INVOCATION_VERSION = 1;
export const AGENT_MENTION = '@agentic-delivery-lab-invoker-7f3a';
export const AGENT_BOT_LOGIN = 'agentic-delivery-lab-invoker-7f3a[bot]';
export const INVOCATION_EVENTS = Object.freeze({
  issues: Object.freeze(['opened', 'edited', 'reopened', 'typed', 'untyped', 'labeled', 'unlabeled', 'closed']),
  issue_comment: Object.freeze(['created', 'edited']),
  pull_request_review: Object.freeze(['submitted', 'edited']),
  pull_request_review_comment: Object.freeze(['created', 'edited']),
});

export function bodyDigest(body) {
  return createHash('sha256').update(String(body ?? ''), 'utf8').digest('hex');
}

function visibleLines(body) {
  const lines = String(body ?? '').replace(/^\uFEFF/, '').split(/\r?\n/);
  const result = [];
  let fenced = false;
  let htmlComment = false;
  for (const raw of lines) {
    const line = raw.trim();
    if (htmlComment) {
      if (line.includes('-->')) htmlComment = false;
      continue;
    }
    if (line.startsWith('<!--')) {
      if (!line.includes('-->')) htmlComment = true;
      continue;
    }
    if (/^(?:```|~~~)/.test(line)) {
      fenced = !fenced;
      continue;
    }
    if (fenced || !line || line.startsWith('>')) continue;
    result.push(line);
  }
  return result;
}

/**
 * The mention is an execution boundary, not a routing language. Only the
 * first visible Markdown line may invoke the orchestrator. Quoted text and
 * fenced code are deliberately ignored so examples cannot execute work.
 */
export function hasInvocationMention(body, mention = AGENT_MENTION) {
  const first = visibleLines(body)[0] ?? '';
  if (!first || first.includes(`\`${mention}\``)) return false;
  if (!first.startsWith(mention)) return false;
  const suffix = first.slice(mention.length);
  return suffix === '' || /^\s/.test(suffix);
}

export function invocationEventSupported(eventName, action) {
  return Object.hasOwn(INVOCATION_EVENTS, eventName)
    && INVOCATION_EVENTS[eventName].includes(action);
}

export function constantTimeSignatureValid({ secret, rawBody, signature } = {}) {
  if (!secret || !signature || !/^sha256=[0-9a-f]{64}$/i.test(signature)) return false;
  const expected = `sha256=${createHmac('sha256', secret).update(String(rawBody ?? ''), 'utf8').digest('hex')}`;
  const actual = String(signature);
  return expected.length === actual.length
    && timingSafeEqual(Buffer.from(expected), Buffer.from(actual));
}

export function webhookSignature({ secret, rawBody, signature, hmac }) {
  if (!secret || !signature || !/^sha256=[0-9a-f]{64}$/i.test(signature)) return false;
  const expected = `sha256=${hmac(secret, String(rawBody ?? ''))}`;
  const actual = String(signature);
  return expected.length === actual.length
    && timingSafeEqual(Buffer.from(expected), Buffer.from(actual));
}

export function actorEntry(catalog, login) {
  return (catalog?.actors ?? []).find((actor) => actor?.login === login) ?? null;
}

export function validateActorCatalog(catalog) {
  const errors = [];
  if (!catalog || catalog.version !== 1) errors.push('actor catalog version must be 1');
  if (catalog?.mention !== AGENT_MENTION) errors.push(`actor catalog mention must be ${AGENT_MENTION}`);
  if (catalog?.bot_login !== AGENT_BOT_LOGIN) errors.push(`actor catalog bot_login must be ${AGENT_BOT_LOGIN}`);
  if (!Array.isArray(catalog?.human_permissions)
    || catalog.human_permissions.join(',') !== 'write,maintain,admin') errors.push('human_permissions must be write,maintain,admin');
  if (JSON.stringify(catalog?.events) !== JSON.stringify(INVOCATION_EVENTS)) errors.push('events must match the supported invocation event catalog');
  if (!Number.isInteger(catalog?.max_bot_hops) || catalog.max_bot_hops < 0 || catalog.max_bot_hops > 1) errors.push('max_bot_hops must be 0 or 1');
  if (!Array.isArray(catalog?.actors)) errors.push('actors must be an array');
  else {
    const logins = new Set();
    for (const actor of catalog.actors) {
      if (!actor || typeof actor.login !== 'string' || !actor.login || logins.has(actor.login)) errors.push('actor logins must be unique non-empty strings');
      else logins.add(actor.login);
      if (typeof actor.can_invoke !== 'boolean') errors.push(`actor ${actor?.login ?? '<unknown>'} must declare can_invoke`);
    }
  }
  return Object.freeze({ valid: errors.length === 0, errors: Object.freeze(errors) });
}

export function sourceFromWebhook(eventName, payload) {
  const issue = payload?.issue;
  const pullRequest = payload?.pull_request ?? (issue?.pull_request ? issue : null);
  if (eventName === 'issues') return {
    issue_number: issue?.number ?? null,
    pull_request_number: null,
    comment_id: null,
    review_id: null,
    kind: 'issue',
  };
  return {
    issue_number: issue?.number ?? null,
    pull_request_number: pullRequest?.number ?? null,
    comment_id: payload?.comment?.id ?? null,
    review_id: payload?.review?.id ?? null,
    kind: eventName === 'issue_comment'
      ? (pullRequest ? 'pull_request_comment' : 'issue_comment')
      : eventName === 'pull_request_review' ? 'pull_request_review' : 'pull_request_review_comment',
  };
}

export function invocationBody(eventName, payload) {
  if (eventName === 'issues') return payload?.issue?.body ?? '';
  if (eventName === 'pull_request_review') return payload?.review?.body ?? '';
  return payload?.comment?.body ?? '';
}

export function invocationEnvelope({ deliveryId, eventName, action, repositoryId, source, actor, body, hop = 0, parentDeliveryId = null, controller } = {}) {
  return {
    version: INVOCATION_VERSION,
    delivery_id: String(deliveryId ?? ''),
    event: eventName,
    action,
    repository_id: String(repositoryId ?? ''),
    source,
    actor: { login: actor?.login ?? '', type: actor?.type ?? '' },
    hop,
    parent_delivery_id: parentDeliveryId,
    body_digest: bodyDigest(body),
    ...(controller ? { controller: { version: controller.version, commit: controller.commit } } : {}),
  };
}
