import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, appendFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { CodexClient } from './lib/codex-client.mjs';
import { runTurn, validateOutcome } from './lib/codex-loop.mjs';

// Opt-in subscription smoke test: two tiny, bounded real model turns. Never CI.
const workspace = await mkdtemp(path.join(tmpdir(), 'codex-delivery-handoff-'));
await writeFile(path.join(workspace, 'AGENTS.md'), '# Fixture instructions\n\nThis is an isolated protocol test. Do not contact external services, use other repositories, or perform Git operations. The only requested change is result.txt.\n');
const client = new CodexClient({cwd:workspace});
let trace = Promise.resolve();
client.on('message', ({method,params}) => {
  if ((method === 'item/completed' && params.item?.type !== 'reasoning') || method === 'turn/started' || method === 'turn/completed') {
    trace = trace.then(() => appendFile(path.join(client.runtime,'trace.jsonl'), `${JSON.stringify({method,params})}\n`));
  }
});
try {
  await client.initialize();
  const budget = await client.capabilities();
  assert.equal(budget.stop, false, budget.reason);
  const {thread} = await client.thread(workspace, 'This is an isolated, minimal protocol test. Follow the supplied JSON output schema. Keep the result concise. Do not start background processes.');
  const progress = async (message) => {
    await writeFile(path.join(client.runtime, 'last-message.txt'), message);
    console.log('Model progress saved in the isolated runtime.');
  };
  const planned = await runTurn({client,threadId:thread.id,phase:'plan',onProgress:progress,stallTimeoutMs:120_000,
    prompt:'Plan exactly one change: create result.txt containing the single line verified. No other changes. This is fully specified and no external information is needed. Return a ready requirements plan with one task, no questions, changeType test, and title "test: ✅ verify model handoff" in the output schema. Do not create the file during planning.'});
  assert.equal(planned.status,'completed',planned.reason);
  const plan = validateOutcome('plan',planned.text);
  assert.equal(plan.status,'ready');
  await assert.rejects(readFile(path.join(workspace,'result.txt')));
  console.log('Sol High completed actual Plan mode without writing the target file.');
  const implemented = await runTurn({client,threadId:thread.id,phase:'implement',onProgress:progress,stallTimeoutMs:120_000,
    prompt:`Implement this completed plan: ${JSON.stringify(plan)}. Create only result.txt containing verified followed by a newline. Read it back. Return complete in the output schema with no remaining tasks or questions.`});
  assert.equal(implemented.status,'completed',implemented.reason);
  assert.equal(validateOutcome('implement',implemented.text).status,'complete');
  assert.equal(await readFile(path.join(workspace,'result.txt'),'utf8'),'verified\n');
  console.log('Luna Max implemented and verified the saved plan.');
} finally {
  await client.close();
  await trace;
  console.log(`Inspection fixture retained at ${workspace}.`);
  console.log(`Protocol trace retained at ${client.runtime}.`);
}
