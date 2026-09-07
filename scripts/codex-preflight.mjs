import { CodexClient } from './lib/codex-client.mjs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

try {
  await promisify(execFile)('codex', ['login', 'status'], {timeout:15_000});
} catch {
  console.error('Codex login is unavailable for this account. An operator must run codex login --device-auth as the runner service user. Do not copy or publish authentication files.');
  process.exit(1);
}

const client = new CodexClient({ cwd: process.cwd() });
try {
  await client.initialize();
  const quota = await client.capabilities();
  if (quota.stop) throw new Error(quota.reason);
  await client.thread(process.cwd());
  console.log(`Codex preflight passed: Sol High, Luna Max, Plan mode, permission profiles, ChatGPT authentication; highest window usage ${quota.usedPercent}%. No model turn was started.`);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  await client.close();
}
