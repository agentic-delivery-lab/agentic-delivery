import { AUTH_STORAGE_CONFIG, CodexClient } from './lib/codex-client.mjs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const SESSION_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
  process.exit(1);
}

const client = new CodexClient({ cwd: process.cwd() });
try {
  await client.initialize();
  const quota = await client.capabilities();
  if (quota.stop) throw new Error(quota.reason);
  await client.close();
  const resumed = await probePersistentThread(process.cwd());
  const sessionProbe = resumed
    ? 'persistent thread start/resume'
    : 'persistent thread start; exact resume requires a first model rollout in this pinned CLI';
  console.log(`Codex preflight passed: Sol High, Luna Max, Plan mode, permission profiles, ChatGPT authentication, and ${sessionProbe}; highest window usage ${quota.usedPercent}%. No model turn was started.`);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  await closeClient(client);
}
