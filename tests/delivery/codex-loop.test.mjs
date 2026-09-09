import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { test } from 'node:test';
import {
  runTurn,
  validateOutcome,
  continuation,
  formatPlanComment,
  formatProgressComment,
} from '../../scripts/lib/codex-loop.mjs';

const quota = (usedPercent = 20) => ({rateLimits:{credits:{hasCredits:false,unlimited:false},primary:{usedPercent,windowDurationMins:300,resetsAt:Date.now()/1000+1000}}});
class FakeCodex extends EventEmitter {
  constructor(action) { super(); this.action=action; this.calls=[]; }
  async request(method, params) {
    this.calls.push({method,params});
    if(method==='account/rateLimits/read') return quota();
    if(method==='turn/start') {
      setImmediate(() => this.action(this));
      return {turn:{id:'turn-1'}};
    }
    if(method==='turn/interrupt') this.emit('message',{method:'turn/completed',params:{threadId:'thread-1',turn:{id:'turn-1',status:'interrupted'}}});
    return {};
  }
  close() { this.closed=true; }
  finish(text) {
    this.emit('message',{method:'item/completed',params:{threadId:'thread-1',item:{type:'agentMessage',phase:'final_answer',text}}});
    this.emit('message',{method:'turn/completed',params:{threadId:'thread-1',turn:{id:'turn-1',status:'completed'}}});
  }
}

test('uses actual Plan mode with Sol High, then Luna Max for implementation', async () => {
  for (const phase of ['plan','implement']) {
    const client=new FakeCodex((c)=>c.finish('{"ok":true}'));
    const result=await runTurn({client,threadId:'thread-1',phase,prompt:'assignment',onProgress:async()=>{}});
    assert.equal(result.text,'{"ok":true}');
    const start=client.calls.find(c=>c.method==='turn/start').params;
    assert.deepEqual(start.collaborationMode,{mode:phase==='plan'?'plan':'default',settings:{model:phase==='plan'?'gpt-5.6-sol':'gpt-5.6-luna',reasoning_effort:phase==='plan'?'high':'max',developer_instructions:null}});
    assert.equal(start.permissions,phase==='plan'?'delivery-plan':'delivery-edit');
    assert.equal(start.environments,undefined,'an empty environment list disables all filesystem tools');
  }
});

test('interrupts on clarification without inventing an answer', async () => {
  const client=new FakeCodex((c)=>c.emit('message',{id:22,method:'item/tool/requestUserInput',params:{threadId:'thread-1',turnId:'turn-1',questions:[{question:'Which outcome?',options:[{label:'A',description:'First'}]}]}}));
  const result=await runTurn({client,threadId:'thread-1',phase:'plan',prompt:'idea',onProgress:async()=>{}});
  assert.equal(result.status,'needs_input');
  assert.match(result.reason,/Which outcome/);
  assert.equal(client.calls.filter(c=>c.method==='turn/start').length,1);
});

test('interrupts near exhaustion and refuses to start when quota is unavailable', async () => {
  const client=new FakeCodex((c)=>c.emit('message',{method:'account/rateLimits/updated',params:quota(98)}));
  const result=await runTurn({client,threadId:'thread-1',phase:'implement',prompt:'work',onProgress:async()=>{}});
  assert.equal(result.status,'paused');
  assert.equal(client.calls.filter(c=>c.method==='turn/interrupt').length,1);
  const unavailable=new FakeCodex(()=>assert.fail('must not generate'));
  unavailable.request=async (method)=> {assert.equal(method,'account/rateLimits/read');return {};};
  assert.equal((await runTurn({client:unavailable,threadId:'thread-1',phase:'plan',prompt:'work',onProgress:async()=>{}})).status,'paused');
});

test('failure to publish progress stops model work', async () => {
  const client=new FakeCodex(c=>c.emit('message',{method:'item/completed',params:{threadId:'thread-1',item:{type:'agentMessage',text:'Progress'}}}));
  const result=await runTurn({client,threadId:'thread-1',phase:'implement',prompt:'work',onProgress:async()=>{throw Error('audit unavailable');}});
  assert.equal(result.status,'paused');
  assert.match(result.reason,/audit/);
});

test('invalid structured plans cannot advance to implementation', () => {
  assert.throws(()=>validateOutcome('plan','plain text'),/structured/);
  assert.throws(()=>validateOutcome('plan',JSON.stringify({status:'ready',questions:['Unanswered']})),/structured/);
  assert.throws(()=>validateOutcome('implement',JSON.stringify({status:'complete',summary:'done',tasks:[],questions:['Which one?']})),/questions/);
});

test('structured model progress becomes concise Markdown instead of raw JSON', () => {
  const text = formatProgressComment('plan', JSON.stringify({
    status:'ready',
    summary:'The repository contracts are understood.',
    tasks:['Inspect the controller.', 'Confirm the tests.', 'Write the plan.', 'Do not expose this fourth task.'],
    questions:[],
    kind:'requirements',
    plan:'',
    changeType:'fix',
    title:'fix(delivery): 🐛 format comments',
  }));

  assert.match(text, /^### Progress update: Plan/m);
  assert.match(text, /The repository contracts are understood\./);
  assert.match(text, /\*\*Next\*\*/);
  assert.match(text, /- Inspect the controller\./);
  assert.doesNotMatch(text, /"status"|"questions"|"changeType"/);
  assert.doesNotMatch(text, /fourth task/);

  const incomplete = formatProgressComment('implement', '{"status":"running","tasks":[]}');
  assert.match(incomplete,/Progress was saved to the delivery state/);
  assert.doesNotMatch(incomplete,/"status"|"tasks"/);
});

test('completed plans keep details available without overwhelming the issue timeline', () => {
  const text = formatPlanComment({
    ...JSON.parse(JSON.stringify({
      status:'ready', kind:'requirements', summary:'Use the existing controller.',
      plan:'<proposed_plan>\n# Detailed plan\n\nImplement the renderer.\n</proposed_plan>',
      tasks:['Add tests.', 'Implement formatting.'], questions:[], changeType:'fix',
      title:'fix(delivery): 🐛 format comments',
    })),
  });

  assert.match(text, /^## Plan complete/m);
  assert.match(text, /<details>/);
  assert.match(text, /<summary>View implementation plan and tasks<\/summary>/);
  assert.match(text, /# Detailed plan/);
  assert.doesNotMatch(text, /proposed_plan/);
  assert.doesNotMatch(text, /"status"|"questions"/);
});

test('continuation includes source, phase, saved work, and outstanding tasks', () => {
  const text=continuation({issue:15,status:'paused',phase:'implement',reason:'Quota reserve',branch:'feat/issue-15-change',plan:{plan:'The plan',tasks:['First task']},tasks:['Remaining task'],lastProgress:'Edited controller'});
  for(const value of ['Delivery paused: recovery required','#15','Implement','Quota reserve','feat/issue-15-change','Remaining task','Edited controller','/codex resume']) assert.ok(text.includes(value),value);
  assert.match(text,/No decision is requested/);
});

test('awaiting-human handoffs lead with questions and separate recovery details', () => {
  const text = continuation({
    issue:18, phase:'plan', status:'awaiting-human', sessionId:'019fb023-24b8-7881-9119-509f078b610e',
    reason:'The model requested a decision.', tasks:['Answer the question.'],
    questions:['Which lifecycle should apply?', 'Should delivery start automatically?'],
  });
  for (const value of [
    '## Action required: answer Codex',
    '### Questions',
    '1. Which lifecycle should apply?',
    '2. Should delivery start automatically?',
    'Reply with your answers in a new comment.',
    'Codex session ID: `019fb023-24b8-7881-9119-509f078b610e`',
    'Continuation state: `awaiting-human`',
    'Issue: `#18`',
    '<summary>Saved delivery details</summary>',
  ]) assert.ok(text.includes(value),value);
  assert.doesNotMatch(text,/Saved progress: \{/);
  assert.doesNotMatch(text,/comment `\/codex resume`/);
});
