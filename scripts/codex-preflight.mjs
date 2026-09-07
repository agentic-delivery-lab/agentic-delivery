import { CodexClient } from './lib/codex-client.mjs';

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
  client.close();
}
