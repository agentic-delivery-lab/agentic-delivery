// agentic-primitive: {"id":"pull-request-check-readiness","kind":"customization","enforcement":"deterministic","adrs":["ADR-0009","ADR-0011"],"domains":["agentic-delivery-governance"]}

export const REQUIRED_REVIEW_CHECKS = Object.freeze([
  'Validate pull request body',
  'quality',
  'portability (ubuntu-latest)',
  'portability (macos-latest)',
  'portability (windows-latest)',
]);

const REVIEW_CHECK_WORKFLOWS = Object.freeze({
  'Validate pull request body': '.github/workflows/pull-request-body.yml',
  quality: '.github/workflows/delivery-quality.yml',
  'portability (ubuntu-latest)': '.github/workflows/delivery-quality.yml',
  'portability (macos-latest)': '.github/workflows/delivery-quality.yml',
  'portability (windows-latest)': '.github/workflows/delivery-quality.yml',
  validate: '.github/workflows/adr-quality.yml',
});

export function reviewCheckWorkflowPath(checkName) {
  return REVIEW_CHECK_WORKFLOWS[checkName] ?? null;
}

function parseWorkflowJobUrl(detailsUrl, repository) {
  try {
    const url = new URL(detailsUrl);
    if (url.protocol !== 'https:' || url.hostname !== 'github.com' || url.username || url.password || url.hash) return null;
    const prefix = `/${repository}/actions/runs/`;
    if (!url.pathname.startsWith(prefix)) return null;
    const match = url.pathname.slice(prefix.length).match(/^([1-9][0-9]*)\/job\/([1-9][0-9]*)$/);
    if (!match) return null;
    return { runId: Number(match[1]), jobId: Number(match[2]) };
  } catch {
    return null;
  }
}

async function fetchActionsEvidence(url, token, fetchImpl) {
  const response = await fetchImpl(url, {
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'X-GitHub-Api-Version': '2026-03-10',
    },
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`GitHub Actions check provenance returned HTTP ${response.status}.`);
  return response.json();
}

export async function verifyReviewCheckRunProducers(checkRuns, {
  repository,
  expectedSha,
  token,
  fetchImpl = globalThis.fetch,
} = {}) {
  if (!/^[\w.-]+\/[\w.-]+$/.test(repository ?? '') || !/^[0-9a-f]{40}$/.test(expectedSha ?? '') || !token) {
    throw new Error('A repository, exact head SHA, and GH_TOKEN are required to verify check-run workflow sources.');
  }

  const workflowRuns = new Map();
  const workflowJobs = new Map();
  const runs = Array.isArray(checkRuns) ? checkRuns : [];
  const verifiedRuns = [];
  for (const run of runs) {
    const expectedPath = reviewCheckWorkflowPath(run?.name);
    const appName = typeof run?.app === 'string' ? run.app : run?.app?.name;
    if (!expectedPath || run?.head_sha !== expectedSha || appName !== 'GitHub Actions') {
      verifiedRuns.push({ ...run, workflowVerified: false, workflowPath: null });
      continue;
    }

    const location = parseWorkflowJobUrl(run.details_url, repository);
    if (!location) {
      verifiedRuns.push({ ...run, workflowVerified: false, workflowPath: null });
      continue;
    }

    const runKey = String(location.runId);
    if (!workflowRuns.has(runKey)) {
      workflowRuns.set(runKey, fetchActionsEvidence(
        `https://api.github.com/repos/${repository}/actions/runs/${location.runId}`,
        token,
        fetchImpl,
      ));
    }
    let workflow;
    try { workflow = await workflowRuns.get(runKey); } catch (error) {
      workflowRuns.delete(runKey);
      throw error;
    }
    const workflowMatches = workflow?.id === location.runId
      && workflow.head_sha === expectedSha
      && Number.isSafeInteger(workflow.workflow_id)
      && workflow.workflow_id > 0
      && workflow.path === expectedPath
      && ['pull_request', 'pull_request_target', 'workflow_dispatch'].includes(workflow.event);
    if (!workflowMatches) {
      verifiedRuns.push({
        ...run,
        workflowVerified: false,
        workflowPath: typeof workflow?.path === 'string' ? workflow.path : null,
        workflowRunId: location.runId,
      });
      continue;
    }

    const jobKey = String(location.jobId);
    if (!workflowJobs.has(jobKey)) {
      workflowJobs.set(jobKey, fetchActionsEvidence(
        `https://api.github.com/repos/${repository}/actions/jobs/${location.jobId}`,
        token,
        fetchImpl,
      ));
    }
    let job;
    try { job = await workflowJobs.get(jobKey); } catch (error) {
      workflowJobs.delete(jobKey);
      throw error;
    }
    const jobMatches = job?.id === location.jobId
      && job.run_id === location.runId
      && job.head_sha === expectedSha
      && job.name === run.name
      && job.workflow_name === workflow.name
      && job.check_run_url === run.url
      && job.status === run.status
      && job.conclusion === run.conclusion;
    verifiedRuns.push({
      ...run,
      workflowVerified: jobMatches,
      workflowPath: jobMatches ? expectedPath : null,
      workflowRunId: location.runId,
      workflowJobId: location.jobId,
      workflowId: Number.isSafeInteger(workflow.workflow_id) ? workflow.workflow_id : null,
      workflowEvent: workflow.event,
    });
  }
  return verifiedRuns;
}

// Keep these path rules aligned with `adr-quality.yml`'s pull_request.paths.
const ADR_QUALITY_EXACT_FILES = new Set([
  'AGENTS.md',
  '.github/workflows/adr-quality.yml',
  '.markdownlint-cli2.jsonc',
  'CHANGELOG.md',
  '.node-version',
  'commitlint.config.mjs',
  'package.json',
  'pnpm-lock.yaml',
  'pnpm-workspace.yaml',
]);
const ADR_QUALITY_PREFIXES = Object.freeze([
  '.agents/skills/',
  'docs/decisions/',
  'docs/architecture/',
  'docs/delivery/',
  'docs/domain/',
  'tests/adr/',
  'tests/communication/',
  'tests/delivery/',
  'tests/domain/',
]);

export function adrQualityWorkflowAppliesToFiles(files) {
  return Array.isArray(files) && files.some((entry) => {
    const file = String(entry ?? '');
    return ADR_QUALITY_EXACT_FILES.has(file)
      || ADR_QUALITY_PREFIXES.some((prefix) => file.startsWith(prefix))
      || (file.startsWith('scripts/') && file.endsWith('.mjs'));
  });
}

export function reviewCheckReadiness(checkRuns, expectedSha, requireAdrValidation = false, requireWorkflowProvenance = true) {
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
  const wrongWorkflow = requireWorkflowProvenance ? required.filter((name) => {
    const run = latestByName.get(name);
    return run && (run.workflowVerified !== true || run.workflowPath !== reviewCheckWorkflowPath(name));
  }) : [];
  const failed = required.filter((name) => {
    const run = latestByName.get(name);
    return run?.status === 'completed' && run.conclusion !== 'success';
  });
  const allRunsComplete = runs.every((run) => run.status === 'completed' && typeof run.conclusion === 'string');
  const failedOrWrongWorkflow = [...new Set([...failed, ...wrongWorkflow])];
  const requiredReady = missing.length === 0 && pending.length === 0 && failedOrWrongWorkflow.length === 0;
  return {
    ready: requiredReady,
    requiredReady,
    allRunsComplete,
    missing,
    pending,
    failed: failedOrWrongWorkflow,
    wrongWorkflow,
  };
}
