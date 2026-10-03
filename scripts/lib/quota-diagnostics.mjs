// agentic-primitive: {"id":"quota-diagnostics-contract","kind":"script","enforcement":"deterministic","adrs":["ADR-0003","ADR-0009","ADR-0011","ADR-0018"],"domains":["agentic-delivery-control-plane","agentic-delivery-governance"]}
// Shared schema version and safe cause codes for review quota evidence.
export const QUOTA_DIAGNOSTICS_SCHEMA_VERSION = '1.0.0';

const QUOTA_DIAGNOSTICS_SCHEMA_MAJOR = QUOTA_DIAGNOSTICS_SCHEMA_VERSION.split('.')[0];
const SEMVER_VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/;

export function supportsQuotaDiagnosticsSchemaVersion(value) {
  if (typeof value !== 'string') return false;
  const match = SEMVER_VERSION.exec(value);
  return match?.[1] === QUOTA_DIAGNOSTICS_SCHEMA_MAJOR;
}

export const QUOTA_REASON = Object.freeze({
  available: 'available',
  invalidBucket: 'invalid_bucket',
  creditSpillover: 'credit_spillover',
  unlimitedCredits: 'unlimited_credits',
  creditTelemetryUnavailable: 'credit_telemetry_unavailable',
  missingOrInvalidWindow: 'missing_or_invalid_window',
  windowReserve: 'window_reserve',
  serverRateLimit: 'server_rate_limit',
  spendControl: 'spend_control',
  telemetryUnavailable: 'telemetry_unavailable',
});

export const QUOTA_REASON_CODES = Object.freeze([
  QUOTA_REASON.invalidBucket,
  QUOTA_REASON.creditSpillover,
  QUOTA_REASON.unlimitedCredits,
  QUOTA_REASON.creditTelemetryUnavailable,
  QUOTA_REASON.missingOrInvalidWindow,
  QUOTA_REASON.windowReserve,
  QUOTA_REASON.serverRateLimit,
  QUOTA_REASON.spendControl,
  QUOTA_REASON.telemetryUnavailable,
]);

export const QUOTA_TRIGGER_CODES = QUOTA_REASON_CODES;

export const QUOTA_STOP_PHASE = Object.freeze({
  preflight: 'preflight',
  activeTurn: 'active_turn',
  unknown: 'unknown',
});

export const QUOTA_STOP_PHASES = Object.freeze(Object.values(QUOTA_STOP_PHASE));

export const QUOTA_STOP_PHASE_LABELS = Object.freeze({
  [QUOTA_STOP_PHASE.preflight]: 'preflight',
  [QUOTA_STOP_PHASE.activeTurn]: 'active turn',
  [QUOTA_STOP_PHASE.unknown]: 'unknown',
});

export const QUOTA_REASON_LABELS = Object.freeze({
  [QUOTA_REASON.invalidBucket]: 'quota telemetry contained an invalid bucket',
  [QUOTA_REASON.creditSpillover]: 'spendable credits are available',
  [QUOTA_REASON.unlimitedCredits]: 'unlimited credits are available',
  [QUOTA_REASON.creditTelemetryUnavailable]: 'credit telemetry was unavailable or incomplete',
  [QUOTA_REASON.missingOrInvalidWindow]: 'a required quota window was missing, invalid, or expired',
  [QUOTA_REASON.windowReserve]: 'a quota window reached the 98% reserve',
  [QUOTA_REASON.serverRateLimit]: 'the server reported a rate limit',
  [QUOTA_REASON.spendControl]: 'the server reported a spend control',
  [QUOTA_REASON.telemetryUnavailable]: 'quota telemetry could not be read',
});

export const QUOTA_TRIGGER_LABELS = Object.freeze({
  [QUOTA_REASON.invalidBucket]: 'invalid quota bucket',
  [QUOTA_REASON.creditSpillover]: 'spendable credits',
  [QUOTA_REASON.unlimitedCredits]: 'unlimited credits',
  [QUOTA_REASON.creditTelemetryUnavailable]: 'incomplete credit telemetry',
  [QUOTA_REASON.missingOrInvalidWindow]: 'missing or invalid quota window',
  [QUOTA_REASON.windowReserve]: '98% usage reserve',
  [QUOTA_REASON.serverRateLimit]: 'server rate limit',
  [QUOTA_REASON.spendControl]: 'server spend control',
  [QUOTA_REASON.telemetryUnavailable]: 'quota telemetry unavailable',
});
