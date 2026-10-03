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

test('uses actual Plan mode, implementation mode, and read-only review mode', async () => {
  for (const phase of ['plan','implement','review']) {
    const client=new FakeCodex((c)=>c.finish('{"ok":true}'));
    const result=await runTurn({client,threadId:'thread-1',phase,prompt:'assignment',onProgress:async()=>{}});
    assert.equal(result.text,'{"ok":true}');
    const start=client.calls.find(c=>c.method==='turn/start').params;
    const expectedModel = phase === 'implement'
      ? {model:'gpt-6-luna',reasoning_effort:'max'}
      : {model:'gpt-6-sol',reasoning_effort:'high'};
    assert.deepEqual(start.collaborationMode,{mode:phase==='plan'?'plan':'default',settings:{...expectedModel,developer_instructions:null}});
    assert.equal(start.permissions,phase==='plan'?'delivery-plan':phase==='implement'?'delivery-edit':'delivery-review');
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

test('start rejection exposes only allowlisted error metadata', async () => {
  const client = new FakeCodex(() => {});
  const request = client.request.bind(client);
  client.request = async (method, params) => {
    if (method === 'turn/start') {
      client.calls.push({method, params});
      const error = new Error('Authentication failed: access_token=fixture-secret');
      error.codexErrorInfo = 'unauthorized';
      error.httpStatusCode = 401;
      throw error;
    }
    return request(method, params);
  };
  const result = await runTurn({client,threadId:'thread-1',phase:'implement',prompt:'work',onProgress:async()=>{}});
  assert.equal(result.status, 'paused');
  assert.match(result.reason, /codex_error=unauthorized/);
  assert.match(result.reason, /http_status=401/);
  assert.match(result.reason, /diagnostic_message=unrecognized/);
  assert.match(result.reason, /terminal_source=turn_start_rejection/);
  assert.match(result.reason, /failure_duration_ms=\d+/);
  assert.doesNotMatch(result.reason, /fixture-secret|access_token/);
});

test('terminal error notifications require exact thread and active turn IDs', async () => {
  const cases = [
    {name:'missing thread', params:{turnId:'turn-1'}},
    {name:'foreign thread', params:{threadId:'another-thread',turnId:'turn-1'}},
    {name:'foreign turn', params:{threadId:'thread-1',turnId:'another-turn'}},
    {name:'retrying turn', params:{threadId:'thread-1',turnId:'turn-1',willRetry:true}, retries:1},
    {name:'exact active turn', params:{threadId:'thread-1',turnId:'turn-1'}, expected:true},
  ];

  for (const testCase of cases) {
    const client = new FakeCodex((current) => {
      current.emit('message', {
        method:'error',
        params:{...testCase.params,error:{codexErrorInfo:'other',message:'access_token=fixture-secret'}},
      });
      current.emit('message', {
        method:'turn/completed',
        params:{threadId:'thread-1',turn:{id:'turn-1',status:'failed'}},
      });
    });
    const result = await runTurn({client,threadId:'thread-1',phase:'review',prompt:'review',onProgress:async()=>{}});
    assert.equal(result.status, 'paused', testCase.name);
    assert.equal(result.reason.includes('codex_error=other'), testCase.expected ?? false, testCase.name);
    assert.match(result.reason, new RegExp('retry_notifications=' + (testCase.retries ?? 0)), testCase.name);
    assert.doesNotMatch(result.reason, /fixture-secret|access_token/, testCase.name);
  }
});

test('turn failure reports bounded diagnostic shape without publishing error content', async () => {
  const cases = [
    {name:'missing message', error:{codexErrorInfo:'other'}, shape:'absent'},
    {name:'empty message', error:{codexErrorInfo:'other',message:'  '}, shape:'empty'},
    {name:'non-string message', error:{codexErrorInfo:'other',message:{token:'fixture-secret'}}, shape:'non_string'},
    {
      name:'unknown message and additional details',
      error:{codexErrorInfo:'other',message:'access_token=fixture-secret',additionalDetails:'private-detail-secret'},
      shape:'unrecognized',
      details:'present',
    },
    {
      name:'recognized message',
      error:{codexErrorInfo:'other',message:'workspace routing discovery failed'},
      shape:'recognized',
      diagnostic:'diagnostic=workspace_routing_discovery_failed',
    },
  ];

  for (const testCase of cases) {
    const client = new FakeCodex((current) => {
      current.emit('message', {
        method:'error',
        params:{threadId:'thread-1',turnId:'turn-1',error:testCase.error},
      });
      current.emit('message', {
        method:'turn/completed',
        params:{threadId:'thread-1',turn:{id:'turn-1',status:'failed'}},
      });
    });
    const result = await runTurn({client,threadId:'thread-1',phase:'route',prompt:'route',onProgress:async()=>{}});
    assert.equal(result.status, 'paused', testCase.name);
    assert.match(result.reason, new RegExp('diagnostic_message=' + testCase.shape), testCase.name);
    assert.match(result.reason, new RegExp('additional_details=' + (testCase.details ?? 'absent')), testCase.name);
    assert.match(result.reason, /terminal_source=turn_completed/, testCase.name);
    assert.match(result.reason, /diagnostic_source=error_notification/, testCase.name);
    assert.match(result.reason, /retry_notifications=0/, testCase.name);
    assert.match(result.reason, /failure_duration_ms=\d+/, testCase.name);
    if (testCase.diagnostic) assert.match(result.reason, new RegExp(testCase.diagnostic), testCase.name);
    assert.doesNotMatch(result.reason, /fixture-secret|private-detail-secret|access_token/, testCase.name);
  }
});

test('turn completion errors retain only bounded shape metadata', async () => {
  const client = new FakeCodex((current) => {
    current.emit('message', {
      method:'turn/completed',
      params:{
        threadId:'thread-1',
        turn:{
          id:'turn-1',
          status:'failed',
          error:{codexErrorInfo:'other',message:'access_token=fixture-secret',additionalDetails:'private-detail-secret'},
        },
      },
    });
  });
  const result = await runTurn({client,threadId:'thread-1',phase:'route',prompt:'route',onProgress:async()=>{}});
  assert.match(result.reason, /diagnostic_source=turn_completed_error/);
  assert.match(result.reason, /diagnostic_message=unrecognized/);
  assert.match(result.reason, /additional_details=present/);
  assert.doesNotMatch(result.reason, /fixture-secret|private-detail-secret|access_token/);
});

test('completion events with another thread or turn cannot finish the active turn', async () => {
  const terminalEvents = [
    {threadId:'another-thread',turn:{id:'turn-1',status:'failed'}},
    {turn:{id:'turn-1',status:'failed'}},
    {threadId:'thread-1',turn:{id:'another-turn',status:'failed'}},
    {threadId:'thread-1',turn:{status:'failed'}},
  ];
  for (const params of terminalEvents) {
    const client = new FakeCodex((current) => {
      current.emit('message', {method:'turn/completed',params});
      setTimeout(() => current.finish('{"ok":true}'), 5);
    });
    const result = await runTurn({client,threadId:'thread-1',phase:'review',prompt:'review',onProgress:async()=>{}});
    assert.equal(result.status, 'completed');
    assert.equal(result.text, '{"ok":true}');
  }
});

test('app-server disconnect preserves a fixed startup hint without publishing raw text', async () => {
  const client = new FakeCodex((current) => {
    setImmediate(() => {
      const error = new Error('Codex app-server stopped; access_token=fixture-secret');
      Object.defineProperty(error, 'codexDiagnostic', {value:'default_permission_profile_missing'});
      current.emit('failure', error);
    });
  });
  const result = await runTurn({client,threadId:'thread-1',phase:'review',prompt:'review',onProgress:async()=>{}});
  assert.equal(result.status, 'paused');
  assert.match(result.reason, /Codex app-server disconnected/);
  assert.match(result.reason, /A default permission profile is required/);
  assert.doesNotMatch(result.reason, /fixture-secret|access_token/);
});

test('interrupts near exhaustion and refuses to start when quota is unavailable', async () => {
  const client=new FakeCodex((c)=>c.emit('message',{method:'account/rateLimits/updated',params:{rateLimits:{primary:{usedPercent:98}}}}));
  let reads=0;
  const request=client.request.bind(client);
  client.request=async (method,params) => {
    if(method==='account/rateLimits/read') {
      client.calls.push({method,params});
      return reads++ ? quota(98) : quota();
    }
    return request(method,params);
  };
  const result=await runTurn({client,threadId:'thread-1',phase:'implement',prompt:'work',onProgress:async()=>{}});
  assert.equal(result.status,'paused');
  assert.match(result.reason,/allowance/i);
  assert.equal(reads,2,'a sparse notification triggers a full quota read');
  assert.equal(client.calls.filter(c=>c.method==='turn/interrupt').length,1);
  assert.equal(result.stopPhase,'active_turn');
  assert.equal(result.budget.reasonCode,'window_reserve');
  assert.equal(result.budget.diagnostics.triggeringWindows[0].slot,'primary');
  const unavailable=new FakeCodex(()=>assert.fail('must not generate'));
  unavailable.request=async (method)=> {assert.equal(method,'account/rateLimits/read');return {};};
  const preflight=await runTurn({client:unavailable,threadId:'thread-1',phase:'plan',prompt:'work',onProgress:async()=>{}});
  assert.equal(preflight.status,'paused');
  assert.equal(preflight.stopPhase,'preflight');
  assert.equal(preflight.budget.reasonCode,'missing_or_invalid_window');
  assert.equal(unavailable.calls.filter(c=>c.method==='turn/start').length,0);
});

test('quota telemetry failures have a stable safe reason at preflight and during an active turn', async () => {
  const preflight = new FakeCodex(() => assert.fail('must not generate'));
  preflight.request = async () => { throw new Error('account token fixture-secret'); };
  const beforeStart = await runTurn({client:preflight,threadId:'thread-1',phase:'review',prompt:'review',onProgress:async()=>{}});
  assert.equal(beforeStart.stopPhase,'preflight');
  assert.equal(beforeStart.budget.reasonCode,'telemetry_unavailable');
  assert.doesNotMatch(JSON.stringify(beforeStart),/fixture-secret|account token/);
  assert.equal(preflight.calls.filter(c=>c.method==='turn/start').length,0);

  let reads = 0;
  const active = new FakeCodex(() => {});
  active.request = async (method,params) => {
    active.calls.push({method,params});
    if (method === 'account/rateLimits/read' && reads++ === 0) return quota();
    if (method === 'account/rateLimits/read') throw new Error('account token fixture-secret');
    if (method === 'turn/start') {
      setImmediate(() => active.emit('message',{method:'account/rateLimits/updated',params:{}}));
      return {turn:{id:'turn-1'}};
    }
    if (method === 'turn/interrupt') {
      active.emit('message',{method:'turn/completed',params:{threadId:'thread-1',turn:{id:'turn-1',status:'interrupted'}}});
      return {};
    }
    return {};
  };
  const duringTurn = await runTurn({client:active,threadId:'thread-1',phase:'review',prompt:'review',onProgress:async()=>{}});
  assert.equal(duringTurn.stopPhase,'active_turn');
  assert.equal(duringTurn.budget.reasonCode,'telemetry_unavailable');
  assert.doesNotMatch(JSON.stringify(duringTurn),/fixture-secret|account token/);
});

test('quota stops before turn startup is acknowledged remain in preflight', async () => {
  let reads = 0;
  const client = new FakeCodex(() => {});
  client.request = async (method, params) => {
    client.calls.push({method,params});
    if (method === 'account/rateLimits/read') return reads++ === 0 ? quota() : quota(98);
    if (method === 'turn/start') {
      setImmediate(() => client.emit('message',{method:'account/rateLimits/updated',params:{}}));
      await new Promise((resolve) => setTimeout(resolve,20));
      return {turn:{id:'turn-1'}};
    }
    if (method === 'turn/interrupt') {
      client.emit('message',{method:'turn/completed',params:{threadId:'thread-1',turn:{id:'turn-1',status:'interrupted'}}});
      return {};
    }
    return {};
  };
  const result = await runTurn({client,threadId:'thread-1',phase:'review',prompt:'review',onProgress:async()=>{}});
  assert.equal(result.status,'paused');
  assert.equal(result.stopPhase,'preflight');
  assert.equal(result.budget.reasonCode,'window_reserve');
  assert.equal(reads,2);
  assert.equal(client.calls.filter((call)=>call.method==='turn/interrupt').length,1);
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
  assert.throws(()=>validateOutcome('implement',JSON.stringify({status:'continue',summary:'working',tasks:[],questions:[]})),/remaining task/);
  let error;
  try { validateOutcome('implement',JSON.stringify({status:'complete',summary:'done',tasks:['Run verification.'],questions:[]})); }
  catch (failure) { error=failure; }
  assert.match(error.message,/Remaining tasks/);
  assert.deepEqual(error.outcome.tasks,['Run verification.']);
});

test('active turns can outlive the stall interval while inactive turns are interrupted', async () => {
  const active=new FakeCodex((client)=> {
    const activity=setInterval(()=>client.emit('message',{method:'thread/tokenUsage/updated',params:{threadId:'thread-1',turnId:'turn-1'}}),100);
    setTimeout(()=>{clearInterval(activity);client.finish('{"status":"complete"}');},5_500);
  });
  const completed=await runTurn({
    client:active,threadId:'thread-1',phase:'implement',prompt:'work',onProgress:async()=>{},
    stallTimeoutMs:5_000,pollMs:10_000,
  });
  assert.equal(completed.status,'completed');
  assert.equal(active.calls.filter(c=>c.method==='turn/interrupt').length,0);

  const inactive=new FakeCodex(()=>{});
  const paused=await runTurn({
    client:inactive,threadId:'thread-1',phase:'implement',prompt:'work',onProgress:async()=>{},
    stallTimeoutMs:10,pollMs:1_000,
  });
  assert.equal(paused.status,'paused');
  assert.match(paused.reason,/no activity/i);
  assert.equal(inactive.calls.filter(c=>c.method==='turn/interrupt').length,1);

  let foreignMessages=0;
  let foreignTimer;
  const foreign=new FakeCodex((client)=> {
    foreignTimer=setInterval(()=> {
      foreignMessages++;
      client.emit('message',{method:'thread/tokenUsage/updated',params:{threadId:'another-thread',turnId:'another-turn'}});
    },2);
  });
  const foreignPaused=await runTurn({
    client:foreign,threadId:'thread-1',phase:'implement',prompt:'work',onProgress:async()=>{},
    stallTimeoutMs:15,pollMs:1_000,
  });
  clearInterval(foreignTimer);
  assert.equal(foreignPaused.status,'paused');
  assert.ok(foreignMessages < 15,'another thread cannot keep this turn active');
});

test('the inactivity watchdog starts after turn startup is acknowledged', async () => {
  const client=new FakeCodex(()=>{});
  const request=client.request.bind(client);
  client.request=async (method,params) => {
    if(method!=='turn/start') return request(method,params);
    client.calls.push({method,params});
    await new Promise((resolve)=>setTimeout(resolve,25));
    setImmediate(()=>client.finish('{"status":"complete"}'));
    return {turn:{id:'turn-1'}};
  };

  const result=await runTurn({
    client,threadId:'thread-1',phase:'implement',prompt:'work',onProgress:async()=>{},
    stallTimeoutMs:10,pollMs:1_000,
  });

  assert.equal(result.status,'completed');
  assert.equal(client.calls.filter(c=>c.method==='turn/interrupt').length,0);
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

test('technical pauses are short and do not ask for a continuation comment or field change', () => {
  const text=continuation({issue:15,status:'paused',phase:'implement',reason:'Quota reserve',budget:{stop:true,resetsAt:1_800_000_100},branch:'feat/issue-15-change',plan:{plan:'The plan',tasks:['First task']},tasks:['Remaining task'],lastProgress:'Edited controller'});
  for(const value of ['## Delivery paused','**Stopped at:** Implement','Quota reserve','Rerun the failed workflow','Do not change lifecycle fields or post a continuation comment']) assert.ok(text.includes(value),value);
  for(const hidden of ['#15','feat/issue-15-change','Remaining task','Edited controller','Codex session ID']) assert.doesNotMatch(text,new RegExp(hidden));
});

test('quota words in a technical failure do not trigger reset advice without quota telemetry', () => {
  for (const reason of [
    'The quota service rejected workspace routing.',
    'The session budget could not be read.',
    'Codex reports codex_error=session_budget_exceeded.',
    'The account credit endpoint returned an error.',
  ]) {
    const text = continuation({status:'paused',phase:'implement',reason});
    assert.match(text, /Fix the reported cause, then rerun the failed workflow/);
    assert.doesNotMatch(text, /Rerun the failed workflow after/);
  }

  const measured = continuation({
    status:'paused',phase:'implement',reason:'The measured allowance is nearly exhausted.',
    budget:{stop:true,resetsAt:1_800_000_100},
  });
  assert.match(measured, /Rerun the failed workflow after 2027-01-15T08:01:40\.000Z/);
});

test('validation recovery surfaces the latest error without restoring completed plan tasks', () => {
  const text = continuation({
    issue:29,
    status:'paused',
    phase:'verify',
    reason:'Repository validation failed three times. Fix the latest error shown below before resuming.',
    branch:'feat/issue-29-codex-delivery',
    plan:{tasks:['Implement the approved plan.']},
    tasks:[],
    validation:'ADR check: 0011-example.md breaks the record sequence.',
    lastProgress:'Implementation is complete.',
  });

  assert.match(text, /\*\*Latest check failure:\*\*/);
  assert.match(text, /Fix the latest error shown below before resuming\./);
  assert.match(text, /ADR check: 0011-example\.md breaks the record sequence\./);
  assert.doesNotMatch(text, /saved tasks|Implement the approved plan/);
});

test('awaiting-human handoffs contain only the question and direct next action', () => {
  const text = continuation({
    issue:18, phase:'plan', status:'awaiting-human', sessionId:'019fb023-24b8-7881-9119-509f078b610e',
    reason:'The model requested a decision.', tasks:['Answer the question.'],
    questions:['Which lifecycle should apply?', 'Should delivery start automatically?'],
  });
  for (const value of [
    '## Action required',
    '**Stopped at:** Plan',
    '**Answer:**',
    '1. Which lifecycle should apply?',
    '2. Should delivery start automatically?',
    'Reply with the answers. Do not change lifecycle fields or governance metadata.',
  ]) assert.ok(text.includes(value),value);
  assert.doesNotMatch(text,/Codex session ID|Saved delivery details|continuation state/i);
});
