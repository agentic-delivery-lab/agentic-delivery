import { execFile } from 'node:child_process';
import { appendFile, writeFile } from 'node:fs/promises';
import { promisify } from 'node:util';

import { AUTH_STORAGE_CONFIG, CodexClient, MODELS } from './lib/codex-client.mjs';
import { RELEASE } from './setup-runner-codex.mjs';

const SESSION_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MODEL_EFFORT_PAIRS = [...new Map(Object.values(MODELS).map(({ model, effort }) => [
  `${model}/${effort}`,
  { model, effort },
])).values()];

async function writePreflightReport(report) {
  const reportPath = process.env.CODEX_PREFLIGHT_REPORT_PATH;
  if (!reportPath) return;
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
}

async function writeFailureSummary(quota) {
  const summaryPath = process.env.GITHUB_STEP_SUMMARY;
  if (!summaryPath) return;
  const windows = quota?.windows?.length
    ? quota.windows.map((window) => (
      `bucket ${window.bucketIndex} ${window.slot}: ${window.durationMinutes}m at ${window.usedPercent}%, resets ${new Date(window.resetsAt * 1000).toISOString()}`
    )).join('; ')
    : 'unavailable';
  const guardSignals = quota?.guardSignals
    ? `window threshold=${quota.guardSignals.windowThresholdReached}; rate-limit=${quota.guardSignals.rateLimitReached}; spend-control=${quota.guardSignals.spendControlReached}`
    : 'unavailable';
  await appendFile(summaryPath, [
    '### Codex runner preflight',
    '',
    '- Status: failed before a model turn.',
    `- Codex CLI version: ${RELEASE.version}`,
    `- Highest-window usage: ${quota ? `${quota.highestWindowUsedPercent}%` : 'unavailable'}`,
    `- Rate-limit windows: ${windows}`,
    `- Quota guard signals: ${guardSignals}`,
    '- Model turn: not started.',
    '',
  ].join('\n'));
}

async function closeClient(client) {
  if (client) await client.close();
}

async function probePersistentThread(cwd) {
  const startedClient = new CodexClient({ cwd });
  let sessionId;
  try {
    await startedClient.initialize();
    const started = await startedClient.startThread(cwd);
    sessionId = started?.thread?.id;
    if (typeof sessionId !== 'string' || !SESSION_ID_PATTERN.test(sessionId)) {
      throw new Error('Codex persistent thread start returned an invalid session ID.');
    }
  } finally {
    await closeClient(startedClient);
  }

  const resumedClient = new CodexClient({ cwd });
  try {
    await resumedClient.initialize();
    const resumed = await resumedClient.resumeThread(cwd, sessionId);
    if (resumed?.thread?.id !== sessionId) {
      throw new Error('Codex persistent thread resume returned a different session ID.');
    }
    return true;
  } catch (error) {
    if (error.message.includes('no persisted rollout')) return false;
    throw error;
  } finally {
    await closeClient(resumedClient);
  }
}

try {
  await promisify(execFile)('codex', ['-c', AUTH_STORAGE_CONFIG, 'login', 'status'], {timeout:15_000});
} catch {
  console.error('Codex login is unavailable for this account. An operator must run codex login --device-auth as the runner service user. Do not copy or publish authentication files.');
  const report = {
    schemaVersion: 1,
    status: 'failed',
    codexCliVersion: RELEASE.version,
    noModelTurn: true,
    capturedAt: new Date().toISOString(),
  };
  await writePreflightReport(report);
  await writeFailureSummary(null);
  process.exit(1);
}

const client = new CodexClient({ cwd: process.cwd() });
let quotaObservation = null;
try {
  await client.initialize();
  const quota = await client.capabilities();
  if (Number.isFinite(quota?.usedPercent) && quota.usedPercent >= 0 && quota.usedPercent <= 100) {
    quotaObservation = {
      highestWindowUsedPercent: quota.usedPercent,
      allowanceAvailable: quota.stop === false,
      windows: quota.windows,
      guardSignals: quota.guardSignals,
    };
  }
  if (quota.stop !== false || !quotaObservation) {
    throw new Error(quota.reason || 'Codex quota telemetry is unavailable or at the finalization reserve.');
  }
  await client.close();
  const resumed = await probePersistentThread(process.cwd());
  const sessionProbe = resumed
    ? 'persistent thread start/resume'
    : 'persistent thread start; exact resume requires a first model rollout in this pinned CLI';
  await writePreflightReport({
    schemaVersion: 1,
    status: 'passed',
    codexCliVersion: RELEASE.version,
    accountType: 'chatgpt',
    planMode: 'passed',
    modelCatalog: 'passed',
    permissionProfiles: 'passed',
    modelEffortPairs: MODEL_EFFORT_PAIRS,
    quota: quotaObservation,
    sessionProbe: resumed ? 'start-and-resume-passed' : 'start-passed-resume-needs-first-rollout',
    noModelTurn: true,
    capturedAt: new Date().toISOString(),
  });
  console.log(`Codex preflight passed: GPT-6 Luna Low/Medium/Max, GPT-6 Sol High, Plan mode, permission profiles, ChatGPT authentication, and ${sessionProbe}; highest window usage ${quota.usedPercent}%. No model turn was started.`);
} catch (error) {
  console.error(error.message);
  const report = {
    schemaVersion: 1,
    status: 'failed',
    codexCliVersion: RELEASE.version,
    ...(quotaObservation ? { quota: quotaObservation } : {}),
    noModelTurn: true,
    capturedAt: new Date().toISOString(),
  };
  await writePreflightReport(report);
  await writeFailureSummary(quotaObservation);
  process.exitCode = 1;
} finally {
  await closeClient(client);
}
