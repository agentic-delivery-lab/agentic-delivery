// agentic-primitive: {"id":"repository-dispatch-transport","kind":"validator","enforcement":"deterministic","adrs":["ADR-0018"],"domains":["agentic-delivery-control-plane"]}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

// GitHub may serialize JSON objects in another property order. Keep the signed
// envelope as opaque JSON text, with an identity copy for workflow concurrency.
// There is still only one top-level client_payload property.
export function packRepositoryDispatchClientPayload(envelope) {
  if (!isRecord(envelope)) throw new Error('A repository dispatch envelope is required.');
  if (typeof envelope.delivery_id !== 'string' || !envelope.delivery_id) throw new Error('A repository dispatch delivery identifier is required.');
  return { envelope: { json: JSON.stringify(envelope), delivery_id: envelope.delivery_id } };
}

export function unwrapRepositoryDispatchClientPayload(clientPayload) {
  if (!isRecord(clientPayload)) return clientPayload;
  const keys = Object.keys(clientPayload);
  if (keys.length !== 1 || keys[0] !== 'envelope' || !isRecord(clientPayload.envelope)) return clientPayload;
  const container = clientPayload.envelope;
  // Retain the legacy object wrapper during deployment and rollback.
  if (!Object.hasOwn(container, 'json')) return container;
  if (Object.keys(container).length !== 2 || !Object.hasOwn(container, 'delivery_id')
    || typeof container.json !== 'string' || typeof container.delivery_id !== 'string') return clientPayload;
  try {
    const envelope = JSON.parse(container.json);
    return isRecord(envelope) && envelope.delivery_id === container.delivery_id ? envelope : clientPayload;
  } catch {
    // Parser excerpts can contain arbitrary input. Readers reject the unchanged
    // malformed wrapper with their fixed, payload-free validation messages.
    return clientPayload;
  }
}
