// agentic-primitive: {"id":"pull-request-check-readiness","kind":"customization","enforcement":"deterministic","adrs":["ADR-0009","ADR-0011"],"domains":["agentic-delivery-governance"]}

export const REQUIRED_REVIEW_CHECKS = Object.freeze([
  'Validate pull request body',
  'quality',
  'portability (ubuntu-latest)',
  'portability (macos-latest)',
  'portability (windows-latest)',
]);

export function reviewCheckReadiness(checkRuns, expectedSha, requireAdrValidation = false) {
  const required = requireAdrValidation ? [...REQUIRED_REVIEW_CHECKS, 'validate'] : REQUIRED_REVIEW_CHECKS;
  const latestByName = new Map();
  const runs = Array.isArray(checkRuns) ? checkRuns : [];
  for (const run of runs) {
    const headSha = run.head_sha ?? run.headSha;
    const appName = typeof run.app === 'string' ? run.app : run.app?.name;
    if (headSha !== expectedSha || appName !== 'GitHub Actions' || !required.includes(run.name)) continue;
    const previous = latestByName.get(run.name);
    const currentStarted = Date.parse(run.started_at ?? run.startedAt ?? '') || 0;
    const previousStarted = Date.parse(previous?.started_at ?? previous?.startedAt ?? '') || 0;
    if (!previous || currentStarted > previousStarted || (currentStarted === previousStarted && run.id > previous.id)) {
      latestByName.set(run.name, run);
    }
  }
  const missing = required.filter((name) => !latestByName.has(name));
  const pending = required.filter((name) => {
    const run = latestByName.get(name);
    return run && (run.status !== 'completed' || typeof run.conclusion !== 'string');
  });
  const failed = required.filter((name) => {
    const run = latestByName.get(name);
    return run?.status === 'completed' && run.conclusion !== 'success';
  });
  const allRunsComplete = runs.every((run) => run.status === 'completed' && typeof run.conclusion === 'string');
  const requiredReady = missing.length === 0 && pending.length === 0 && failed.length === 0;
  return {
    ready: requiredReady,
    requiredReady,
    allRunsComplete,
    missing,
    pending,
    failed,
  };
}
