import assert from 'node:assert/strict';
import { test } from 'node:test';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readFile, writeFile, mkdir, rm, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { deliver } from '../../scripts/codex-delivery.mjs';
import { validatePullRequestBody } from '../../scripts/validate-pull-request-body.mjs';

const exec = promisify(execFile);
const plan = {status:'ready', kind:'requirements', summary:'Add the requested file.', plan:'Add result.txt and verify it.', tasks:['Add result.txt.'], questions:[], changeType:'feat', title:'feat: ✨ add requested file'};
const SESSION_ID = '019fb023-24b8-7881-9119-509f078b610e';
const REPLACEMENT_SESSION_ID = '019fb023-24b8-7881-9119-509f078b611f';

async function fixture(t) {
  const root = await mkdtemp(path.join(tmpdir(), 'codex-controller-'));
  t.after(() => rm(root, {recursive:true, force:true}));
  const origin = path.join(root, 'origin');
  await exec('git', ['init', '--initial-branch=main', origin]);
  await writeFile(path.join(origin, 'README.md'), '# Fixture\n');
  await exec('git', ['-C', origin, 'add', '.']);
  await exec('git', ['-C', origin, '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '-m', 'docs: 📝 initialize fixture']);
  const stateRoot = path.join(root, 'state');
  const issueRoot = path.join(stateRoot, '101', '7');
  const workspace = path.join(issueRoot, 'workspace');
  const eventFile = path.join(root, 'event.json');
  await writeFile(eventFile, JSON.stringify({repository:{id:101,full_name:'fixture/repo',owner:{login:'maintainer'}}}));
  const env = {...process.env, GH_TOKEN:'fixture-token', PUBLISH_TOKEN:'fixture-publish-token', GITHUB_EVENT_PATH:eventFile, RUNNER_WORKSPACE:root,
    CODEX_DELIVERY_STATE_DIR:stateRoot, GITHUB_REPOSITORY:'fixture/repo', GITHUB_ACTOR:'maintainer',
    GITHUB_EVENT_NAME:'workflow_dispatch', GITHUB_RUN_ID:'1', SOURCE_ISSUE:'7'};
  const calls = {turns:[], prompts:[], commands:[], comments:[], prs:[], threads:[], publishHeaders:[], pushHeaders:[], clients:0, closes:0};
  const faults = {
    permission:'write', sourceState:'open', sourceTitle:'Add a file', sourceBody:'Create result.txt', sourceComments:[],
    sourceLabels:['type:task', 'state:ready-for-plan'], sourceNativeType:'Task',
    sourceFields:{lifecycle_stage:'planning', readiness:'ready'},
    startSessionId:SESSION_ID, resumeSessionId:SESSION_ID, refinement:null,
    organizationIssueFieldsMissing:false,
  };
  const issueTypes = [
    ['idea', 'Idea'], ['research', 'Research'], ['feature', 'Feature'], ['bug', 'Bug'],
    ['task', 'Task'], ['requirements', 'Requirements'], ['architecture', 'Architecture Decision'],
    ['implementation', 'Implementation'], ['validation', 'Validation'],
  ];
  const stageNames = {
    intake:'Intake', discovery:'Discovery', definition:'Definition', decision:'Decision',
    planning:'Planning', execution:'Execution', validation:'Validation', acceptance:'Acceptance',
    done:'Done', parked:'Parked',
  };
  const readinessNames = {
    'not-ready':'Not ready', 'needs-info':'Needs information', ready:'Ready', working:'Working',
    waiting:'Waiting', 'awaiting-human':'Awaiting human', blocked:'Blocked',
  };
  const controlPlane = (number = 7) => ({
    id:`I_${number}`, number, state:faults.sourceState, title:faults.sourceTitle, body:faults.sourceBody,
    issueType:faults.sourceNativeType ? {id:`IT_${issueTypes.find(([id, name]) => name === faults.sourceNativeType)?.[0] ?? 'task'}`, name:faults.sourceNativeType} : null,
    issueFieldValues:[
      {id:`FV_STAGE_${number}`, field:{id:'lifecycle-stage', name:'Lifecycle Stage'}, value:stageNames[faults.sourceFields.lifecycle_stage], name:stageNames[faults.sourceFields.lifecycle_stage], optionId:faults.sourceFields.lifecycle_stage},
      {id:`FV_READY_${number}`, field:{id:'delivery-readiness', name:'Delivery Readiness'}, value:readinessNames[faults.sourceFields.readiness], name:readinessNames[faults.sourceFields.readiness], optionId:faults.sourceFields.readiness},
    ],
    parent:null, subIssues:[],
    organizationIssueTypes:issueTypes.map(([id, name]) => ({id:`IT_${id}`, name, isEnabled:true})),
    organizationIssueFields:faults.organizationIssueFieldsMissing ? [] : [
      {id:'lifecycle-stage',name:'Lifecycle Stage',dataType:'SINGLE_SELECT',options:Object.entries(stageNames).map(([id,name]) => ({id,name}))},
      {id:'delivery-readiness',name:'Delivery Readiness',dataType:'SINGLE_SELECT',options:Object.entries(readinessNames).map(([id,name]) => ({id,name}))},
    ],
  });
  const dependencies = {
    fetch:async (url, options) => {
      const route = url.replace('https://api.github.com/repos/fixture/repo', '');
      const body = options.body ? JSON.parse(options.body) : undefined;
      if (route.startsWith('/pulls')) calls.publishHeaders.push(options.headers.Authorization);
      let data;
      if (route.startsWith('/collaborators/')) data = {permission:faults.permission};
      else if (route === '/issues/7') data = {
        state:faults.sourceState, title:faults.sourceTitle, body:faults.sourceBody,
        labels:faults.sourceLabels.map((name) => ({name})),
      };
      else if (route === '/issues/7/labels' && options.method === 'PUT') {
        faults.sourceLabels = body.labels;
        data = faults.sourceLabels.map((name) => ({name}));
      }
      else if (route.startsWith('/issues/7/comments')) {
        if (options.method === 'POST') {
          if (faults.failComments) return new Response('{}', {status:503});
          calls.comments.push(body.body); data = {id:calls.comments.length};
        } else data = [...calls.comments.map((body, index) => ({id:index+1, user:{login:'github-actions[bot]'}, body})), ...faults.sourceComments];
      } else if (route.startsWith('/pulls?')) data = calls.prs;
      else if (route === '/pulls' || route === '/pulls/8') {
        if (faults.failPublish) return new Response('{}', {status:503});
        data = {number:8, html_url:'https://github.com/fixture/repo/pull/8', ...body};
        if (!calls.prs.length) calls.prs.push(data);
      } else throw new Error(`Unexpected API request: ${route}`);
      return new Response(JSON.stringify(data), {status:200});
    },
    readControlPlane:async ({issueNumber}) => controlPlane(Number(issueNumber)),
    graphql:async (query, variables) => {
      if (query.includes('setIssueFieldValue')) {
        for (const field of variables.input.issueFields ?? []) {
          if (field.fieldId === 'lifecycle-stage') faults.sourceFields.lifecycle_stage = field.singleSelectOptionId;
          if (field.fieldId === 'delivery-readiness') faults.sourceFields.readiness = field.singleSelectOptionId;
        }
        return {setIssueFieldValue:{issue:{id:'I_7'}}};
      }
      if (query.includes('updateIssueIssueType')) {
        const entry = issueTypes.find(([id]) => `IT_${id}` === variables.input.issueTypeId);
        faults.sourceNativeType = entry?.[1] ?? faults.sourceNativeType;
        return {updateIssueIssueType:{issue:{id:'I_7',issueType:{id:variables.input.issueTypeId,name:faults.sourceNativeType}}}};
      }
      throw new Error(`Unexpected GraphQL request: ${query.slice(0, 80)}`);
    },
    execute:async (command, args, options) => {
      if (command === 'git' && args[0] === 'clone') args = ['clone', '--branch', 'main', origin, workspace];
      if (command === 'git' && args.includes('push')) calls.pushHeaders.push(options.env.GIT_CONFIG_VALUE_0);
      // Title validation is tested independently with the real trusted tooling.
      if (command === 'node') return {stdout:''};
      const result = await exec(command, args, options);
      if (faults.branchCrash && args.includes('switch')) { faults.branchCrash = false; throw new Error('Crash after branch creation'); }
      if (faults.commitCrash && args.includes('commit')) { faults.commitCrash = false; throw new Error('Crash after commit'); }
      return result;
    },
    createClient:() => {
      calls.clients++;
      return {
        initialize:async () => {},
        capabilities:async () => ({stop:Boolean(faults.quota), reason:'Quota reserve reached.'}),
        startThread:async () => {
          calls.threads.push({method:'start'});
          return {thread:{id:faults.startSessionId}};
        },
        resumeThread:async (_cwd, sessionId) => {
          calls.threads.push({method:'resume',sessionId});
          return {thread:{id:faults.resumeSessionId}};
        },
        exec:async (command, cwd, timeout, profile) => {
          calls.commands.push({command,cwd,profile});
          if (faults.validation && command[1] === 'install') return '';
          if (faults.validation) throw new Error('Fixture validation failed');
          return '';
        },
        close:async () => { calls.closes++; if (faults.shutdown) throw new Error('Owned process group is still active'); },
      };
    },
    runTurn:async ({phase,threadId,prompt,onProgress}) => {
      calls.turns.push(phase);
      calls.prompts.push({phase,threadId,prompt});
      if (faults.turnPause || (phase === 'implement' && faults.pauseImplementation)) {
        return {status:'paused', reason:'Quota reserve reached.'};
      }
      if (phase === 'plan') {
        if (faults.progressBurst) {
          await onProgress(JSON.stringify({...plan,summary:'Inspecting the repository.',tasks:['Inspect files.']}));
          await onProgress(JSON.stringify({...plan,summary:'Checking the workflow.',tasks:['Check workflow.']}));
        }
        return {status:'completed',text:JSON.stringify(faults.questions ? {...plan,status:'needs_input',questions:['Which file?']} : plan)};
      }
      if (phase === 'refine' && faults.refinement) return {status:'completed',text:JSON.stringify(faults.refinement)};
      await writeFile(path.join(workspace, 'result.txt'), 'implemented\n');
      await onProgress('Created result.txt; checking the result.');
      if (faults.closeDuringTurn) faults.sourceState = 'closed';
      if (faults.editDuringTurn) faults.sourceBody = 'Create a different file instead.';
      if (faults.implementationQuestion) return {status:'completed',text:JSON.stringify({status:'needs_input',summary:'Need a decision.',tasks:['Resolve the decision.'],questions:['Which wording?']})};
      if (faults.invalidCompleteTasks) return {status:'completed',text:JSON.stringify({status:'complete',summary:'Implementation is ready.',tasks:['Run controller verification.'],questions:[]})};
      if (faults.incompleteTurns > 0) {
        faults.incompleteTurns--;
        return {status:'completed',text:JSON.stringify({status:'continue',summary:'Implementation is progressing.',tasks:['Finish the implementation.'],questions:[]})};
      }
      return {status:'completed',text:JSON.stringify({status:'complete',summary:'Added result.txt.',tasks:[],questions:[]})};
    },
    validateCommits:async ({repositoryRoot,toolingRoot}) => {
      assert.equal(repositoryRoot,workspace);
      assert.notEqual(toolingRoot,workspace);
    },
  };
  return {root, stateRoot, issueRoot, workspace, env, calls, faults, dependencies,
    state:async () => JSON.parse(await readFile(path.join(issueRoot,'state.json'),'utf8')),
    run:async () => deliver(env,dependencies),
    resume:async () => { env.GITHUB_RUN_ID = String(Number(env.GITHUB_RUN_ID)+1); return deliver(env,dependencies); },
    comment:async ({id=200,body='Continue the saved task.',pullRequest=false,user='maintainer',type='User',association='OWNER'}={}) => {
      env.GITHUB_EVENT_NAME = 'issue_comment';
      env.GITHUB_ACTOR = 'rerun-actor';
      env.GITHUB_TRIGGERING_ACTOR = 'rerun-actor';
      await writeFile(eventFile, JSON.stringify({
        repository:{id:101,full_name:'fixture/repo',owner:{login:'maintainer'}},
        issue:{number:7,...(pullRequest ? {pull_request:{html_url:'https://example.invalid/pr/1'}} : {})},
        action:'created',
        comment:{id,body,user:{login:user,type},author_association:association},
      }));
    },
  };
}

test('publishes one recorded branch and PR with a complete issue audit trail', async (t) => {
  const f = await fixture(t); await f.run();
  const state = await f.state();
  assert.equal(state.status,'ready'); assert.equal(state.phase,'publish');
  assert.equal(state.version,3); assert.equal(state.sessionId,SESSION_ID);
  assert.equal(state.evidence.schemaVersion, 1);
  assert.equal(state.evidence.sourceIssue.number, 7);
  assert.equal(state.evidence.codexSession.id, SESSION_ID);
  assert.deepEqual(f.calls.turns,['plan','implement']); assert.equal(f.calls.prs.length,1);
  assert.deepEqual(f.calls.threads,[{method:'start'}]);
  assert.match(f.calls.prs[0].body,/Closes #7/);
  assert.match(f.calls.prs[0].body,/codex-delivery-evidence:v1/);
  const pullRequestBody = validatePullRequestBody({body:f.calls.prs[0].body,author:'github-actions[bot]'});
  assert.equal(pullRequestBody.valid,true,pullRequestBody.errors.join('\n'));
  const auditLines = (await readFile(path.join(f.issueRoot, 'audit.jsonl'), 'utf8')).trim().split(/\r?\n/).map((line) => JSON.parse(line));
  assert.ok(auditLines.every((entry) => entry.schemaVersion === 1 && entry.type === 'delivery-audit' && entry.sourceIssue === 7));
  assert.equal(f.calls.prs[0].base,'main'); assert.equal(f.calls.prs[0].head,state.branch);
  assert.ok(f.calls.comments.some((text) => text.includes('Plan complete')));
  assert.ok(f.calls.comments.some((text) => text.includes('Review pull request ready')));
  assert.equal(f.faults.sourceFields.lifecycle_stage, 'validation');
  assert.equal(f.faults.sourceFields.readiness, 'awaiting-human');
  assert.ok(f.calls.commands.some(({command,profile}) => command[1] === 'install' && profile === 'delivery-deps'));
  const validators = f.calls.commands.filter(({command}) => command[1]?.includes('validate-adrs'));
  assert.ok(validators.length); assert.ok(validators.every(({command}) => !command[1].startsWith(f.workspace)));
  await assert.rejects(access(path.join(f.stateRoot,'account.lock')));
  await f.run(); assert.equal(f.calls.prs.length,1); assert.equal(f.calls.turns.length,2);
});

test('does not start a model turn when the source issue is not ready for planning', async (t) => {
  const f = await fixture(t);
  f.faults.sourceNativeType = 'Idea';
  f.faults.sourceFields = {lifecycle_stage:'intake', readiness:'not-ready'};
  const result = await f.run();
  assert.equal(result.status, 'paused');
  assert.equal(f.calls.clients, 0, JSON.stringify(await f.state()));
  assert.deepEqual(f.calls.turns, []);
  assert.equal(f.calls.prs.length, 0);
  assert.match((await f.state()).reason, /not ready for planning/);
});

test('does not start delivery when the live organization field catalog is incomplete', async (t) => {
  const f = await fixture(t);
  f.faults.organizationIssueFieldsMissing = true;
  await assert.rejects(f.run(), /organization issue fields are not ready/);
  assert.equal(f.calls.clients, 0);
  assert.deepEqual(f.calls.turns, []);
});

test('refined atomic work receives a deterministic type and readiness transition before planning', async (t) => {
  const f = await fixture(t);
  f.env.INTAKE_ROUTE = 'refine';
  f.faults.sourceNativeType = null;
  f.faults.sourceLabels = [];
  f.faults.sourceFields = {lifecycle_stage:'intake', readiness:'not-ready'};
  f.faults.refinement = {
    status: 'refined', summary: 'The request is clear.', workType: 'task', questions: [],
    refinedGoal: 'Deliver the requested file.', audience: 'Maintainers', requirements: [], constraints: [],
    acceptanceCriteria: ['The result is reviewable.'], affectedContexts: ['agentic-delivery-governance'],
    unresolvedDecisions: [], workItems: [],
  };
  await f.run();
  assert.deepEqual(f.calls.turns, ['refine', 'plan', 'implement']);
  assert.equal((await f.state()).status, 'ready');
  assert.equal(f.faults.sourceNativeType, 'Task');
  assert.equal(f.faults.sourceFields.lifecycle_stage, 'validation');
  assert.equal(f.faults.sourceFields.readiness, 'awaiting-human');
});

test('continues incomplete implementation turns automatically before verification', async (t) => {
  const f = await fixture(t);
  f.faults.incompleteTurns = 4;
  await f.run();

  assert.equal((await f.state()).status,'ready');
  assert.deepEqual(f.calls.turns,['plan','implement','implement','implement','implement','implement']);
  assert.equal(f.calls.prs.length,1);
  assert.ok(f.calls.prompts.slice(1).every(({prompt}) => prompt.includes('workflow to verify')));
});

test('an owner continue comment resumes implementation and is consumed once across automatic turns', async (t) => {
  const f = await fixture(t);
  f.faults.pauseImplementation = true;
  assert.equal((await f.run()).status,'paused');

  f.faults.pauseImplementation = false;
  f.faults.incompleteTurns = 1;
  await f.comment({id:211,body:'continue'});
  await f.run();

  assert.equal((await f.state()).status,'ready');
  const implementationPrompts = f.calls.prompts.filter(({phase}) => phase === 'implement');
  assert.equal(implementationPrompts.length,3);
  assert.match(implementationPrompts[1].prompt,/Human continuation comment[\s\S]*continue/);
  assert.doesNotMatch(implementationPrompts[2].prompt,/Human continuation comment/);
  assert.match(implementationPrompts[2].prompt,/Remaining implementation tasks/);
});

test('persists exact tasks from a rejected completion outcome', async (t) => {
  const f = await fixture(t);
  f.faults.invalidCompleteTasks = true;
  assert.equal((await f.run()).status,'paused');

  const state = await f.state();
  assert.deepEqual(state.tasks,['Run controller verification.']);
  assert.match(await readFile(path.join(f.issueRoot,'CONTINUE.md'),'utf8'),/Remaining tasks prevent publication/);
  assert.doesNotMatch(await readFile(path.join(f.issueRoot,'CONTINUE.md'),'utf8'),/Run controller verification|Add result\.txt/);
});

test('coalesces rapid progress updates within one delivery phase', async (t) => {
  const f = await fixture(t);
  f.faults.progressBurst = true;
  await f.run();

  const planUpdates = f.calls.comments.filter((text) => text.includes('Progress update: Plan'));
  assert.equal(planUpdates.length,1);
  assert.match(planUpdates[0],/Inspecting the repository/);
  assert.doesNotMatch(planUpdates[0],/"status"|"tasks"/);
});

test('publication retry consumes no model turn or account preflight', async (t) => {
  const f = await fixture(t); f.faults.failPublish = true;
  assert.equal((await f.run()).status,'paused');
  assert.equal((await f.state()).phase,'publish');
  f.faults.failPublish = false; f.faults.quota = true;
  await f.comment({id:198,body:'Please continue from the saved work.'});
  await f.run();
  assert.equal((await f.state()).status,'ready'); assert.equal(f.calls.clients,1);
  assert.deepEqual(f.calls.turns,['plan','implement']);
});

test('publishes Git changes with the dedicated workflow-capable credential', async (t) => {
  const f = await fixture(t);
  await f.run();

  const expected = Buffer.from('x-access-token:fixture-publish-token').toString('base64');
  assert.deepEqual(f.calls.pushHeaders,[`AUTHORIZATION: basic ${expected}`]);
  assert.deepEqual(f.calls.publishHeaders,['Bearer fixture-publish-token','Bearer fixture-publish-token']);
});

test('requires the dedicated publication credential before model execution', async (t) => {
  const f = await fixture(t);
  delete f.env.PUBLISH_TOKEN;

  await assert.rejects(f.run(),/Publication credential/);
  assert.equal(f.calls.clients,0);
});

test('publication retry cannot push a clean but unverified replacement commit', async (t) => {
  const f = await fixture(t); f.faults.failPublish = true;
  await f.run();
  await writeFile(path.join(f.workspace,'result.txt'),'changed after verification\n');
  await exec('git',['-C',f.workspace,'add','.']);
  await exec('git',['-C',f.workspace,'-c','user.name=Fixture','-c','user.email=fixture@example.invalid',
    '-c','commit.gpgsign=false','commit','-m','fix: 🐛 change the result']);
  f.faults.failPublish = false;
  assert.equal((await f.resume())?.status,'paused');
  assert.equal(f.calls.prs.length,0); assert.equal(f.calls.clients,1);
});

test('recovers branch creation without repeating a completed plan', async (t) => {
  const f = await fixture(t); f.faults.branchCrash = true;
  assert.equal((await f.run()).status,'paused'); assert.equal((await f.state()).phase,'branch');
  await f.resume(); assert.equal((await f.state()).status,'ready');
  assert.deepEqual(f.calls.turns,['plan','implement']);
});

test('questions and quota exhaustion leave a readable continuation without implementation', async (t) => {
  for (const [fault, heading] of [
    ['questions', 'Action required'],
    ['quota', 'Delivery paused'],
    ['turnPause', 'Delivery paused'],
  ]) {
    const f = await fixture(t); f.faults[fault] = true; await f.run();
    assert.notEqual((await f.state()).status,'ready');
    assert.ok(!f.calls.turns.includes('implement')); assert.equal(f.calls.prs.length,0);
    assert.match(await readFile(path.join(f.issueRoot,'CONTINUE.md'),'utf8'),new RegExp(heading));
    if (fault === 'questions') assert.ok(!f.calls.comments.some((comment) => comment.includes('Plan complete')));
  }
});

test('saved planning cannot bypass a newly added governance gate', async (t) => {
  const f = await fixture(t); f.faults.questions = true;
  await f.run(); assert.equal((await f.state()).phase, 'plan');
  const clients = f.calls.clients;
  const turns = [...f.calls.turns];
  f.faults.questions = false;
  f.faults.sourceFields = {lifecycle_stage:'planning', readiness:'needs-info'};
  f.faults.sourceLabels = ['type:task', 'state:needs-info', 'adr:needed'];
  const result = await f.resume();
  assert.equal(result.status, 'awaiting-human');
  assert.match(result.reason, /not ready for planning/);
  assert.equal(f.calls.clients, clients);
  assert.deepEqual(f.calls.turns, turns);
});

test('retains and flushes a failed mandatory comment outbox on resume', async (t) => {
  const f = await fixture(t); f.faults.failComments = true;
  await assert.rejects(f.run(),/GitHub POST/);
  assert.ok((await f.state()).outbox.length); assert.equal(f.calls.turns.length,0);
  f.faults.failComments = false; await f.resume();
  assert.equal((await f.state()).outbox.length,0); assert.equal((await f.state()).status,'ready');
});

test('rejects untrusted actors, closed issues and stale account locks', async (t) => {
  const f = await fixture(t); f.faults.permission = 'read';
  await assert.rejects(f.run(),/write permission/); assert.equal(f.calls.clients,0);
  f.faults.permission = 'write'; f.faults.sourceState = 'closed';
  await assert.rejects(f.run(),/still be open/);
  f.faults.sourceState = 'open'; await mkdir(f.stateRoot,{recursive:true});
  await writeFile(path.join(f.stateRoot,'account.lock'),'operator must inspect');
  await f.run(); assert.equal(f.calls.clients,0);
  assert.equal(await readFile(path.join(f.stateRoot,'account.lock'),'utf8'),'operator must inspect');
});

test('source closure during implementation prevents publishing', async (t) => {
  const f = await fixture(t); f.faults.closeDuringTurn = true; await f.run();
  assert.equal((await f.state()).status,'paused'); assert.equal(f.calls.prs.length,0);
});

test('source edits during implementation pause for replanning without discarding files', async (t) => {
  const f = await fixture(t); f.faults.editDuringTurn = true;
  assert.equal((await f.run())?.status,'paused');
  assert.equal((await f.state()).phase,'plan'); assert.equal(f.calls.prs.length,0);
  assert.equal(await readFile(path.join(f.workspace,'result.txt'),'utf8'),'implemented\n');
  f.faults.editDuringTurn = false; await f.resume();
  assert.equal((await f.state()).status,'ready');
  assert.deepEqual(f.calls.turns,['plan','implement','plan','implement']);
});

test('publication retries reject new or edited issue discussion before pushing', async (t) => {
  const f = await fixture(t); f.faults.failPublish = true;
  f.faults.sourceComments = [{id:10001,user:{login:'maintainer'},body:'Use the proposed wording.'}];
  await f.run(); assert.equal((await f.state()).phase,'publish');
  f.faults.sourceComments[0].body = 'Stop: the wording needs another decision.';
  f.faults.failPublish = false;
  const previousTurns = f.calls.turns.length;
  assert.equal((await f.resume())?.status,'paused');
  assert.equal((await f.state()).phase,'plan'); assert.equal(f.calls.prs.length,0);
  assert.equal(f.calls.turns.length,previousTurns);
});

test('keeps the account lock when process termination cannot be confirmed', async (t) => {
  const f = await fixture(t); f.faults.turnPause = true; f.faults.shutdown = true;
  await assert.rejects(f.run(),/process group/);
  await access(path.join(f.stateRoot,'account.lock'));
  assert.match(await readFile(path.join(f.issueRoot,'CONTINUE.md'),'utf8'),/Delivery paused/);
});

test('verification retry does not repeat implementation after a manual repair', async (t) => {
  const f = await fixture(t); f.faults.validation = true;
  await f.run(); assert.equal((await f.state()).phase,'verify');
  const turns = f.calls.turns.length;
  f.faults.validation = false; await f.resume();
  assert.equal((await f.state()).status,'ready'); assert.equal(f.calls.turns.length,turns);
});

test('saved verification cannot continue after a lifecycle state change', async (t) => {
  const f = await fixture(t); f.faults.validation = true;
  await f.run(); assert.equal((await f.state()).phase,'verify');
  const clients = f.calls.clients;
  const turns = [...f.calls.turns];
  f.faults.sourceFields = {lifecycle_stage:'intake', readiness:'needs-info'};
  const result = await f.resume();
  assert.equal(result.status, 'paused');
  assert.match(result.reason, /not authorized for verification/);
  assert.equal(f.calls.clients, clients);
  assert.deepEqual(f.calls.turns, turns);
});

test('implementation questions preserve the implementation phase and existing branch', async (t) => {
  const f = await fixture(t); f.faults.implementationQuestion = true;
  await f.run(); const first = await f.state();
  assert.equal(first.phase,'implement'); assert.equal(first.status,'awaiting-human');
  assert.equal(f.faults.sourceFields.readiness, 'needs-info');
  f.faults.implementationQuestion = false; await f.comment({id:209,body:'Use the existing wording.'}); await f.run();
  assert.equal((await f.state()).status,'ready'); assert.equal((await f.state()).branch,first.branch);
  assert.deepEqual(f.calls.turns,['plan','implement','implement']);
});

test('recovers a completed commit without spending quota or creating another commit', async (t) => {
  const f = await fixture(t); f.faults.commitCrash = true;
  await f.run(); assert.equal((await f.state()).phase,'commit');
  const first = (await exec('git',['-C',f.workspace,'rev-parse','HEAD'])).stdout;
  f.faults.quota = true; await f.resume();
  assert.equal((await f.state()).status,'ready'); assert.equal(f.calls.clients,1);
  await assert.rejects(exec('git',['-C',f.workspace,'rev-parse','HEAD']));
  assert.ok(first);
});

test('flushes a ready-state outbox even when the event is a duplicate', async (t) => {
  const f = await fixture(t); await f.run();
  const state = await f.state(); state.outbox = ['Recovered final audit entry.'];
  await writeFile(path.join(f.issueRoot,'state.json'),JSON.stringify(state));
  await f.run();
  assert.equal((await f.state()).outbox.length,0); assert.equal(f.calls.clients,1);
  assert.equal(f.calls.comments.at(-1),'Recovered final audit entry.');
});

test('invalid saved state is preserved for inspection without models or publication', async (t) => {
  for (const saved of [JSON.stringify({repository:'another/repo',issue:'7'}), '{broken json',
    JSON.stringify({repository:'fixture/repo',issue:'7',phase:'unknown',status:'paused',events:[],tasks:[]})]) {
    const f = await fixture(t);
    await mkdir(f.issueRoot,{recursive:true});
    const file = path.join(f.issueRoot,'state.json'); await writeFile(file,saved);
    await assert.rejects(f.run(),/saved state/i);
    assert.equal(await readFile(file,'utf8'),saved);
    assert.equal(f.calls.clients,0); assert.equal(f.calls.prs.length,0);
  }
});

test('trusted owner comments continue the exact waiting session and finish successfully', async (t) => {
  const f = await fixture(t);
  f.faults.questions = true;
  assert.equal((await f.run()).status,'awaiting-human');
  const waiting = await f.state();
  assert.equal(waiting.status,'awaiting-human');
  assert.equal(waiting.sessionId,SESSION_ID);
  assert.ok(waiting.waitingCommentId);
  const handoff = await readFile(path.join(f.issueRoot,'CONTINUE.md'),'utf8');
  assert.match(handoff, /Reply with the answers/);
  assert.doesNotMatch(handoff, /Codex session ID|Continuation state|codex resume/);

  f.faults.questions = false;
  await f.comment({id:200,body:'Use the existing result file.'});
  const result = await f.run();

  assert.equal(result?.status, undefined);
  assert.equal((await f.state()).status,'ready');
  assert.deepEqual(f.calls.threads,[{method:'start'},{method:'resume',sessionId:SESSION_ID}]);
  assert.ok(f.calls.prompts.some(({prompt}) => prompt.includes('Use the existing result file.')));
  assert.ok(f.calls.prompts.some(({prompt}) => prompt.includes('Saved plan:')));
  const resumedImplementation = f.calls.prompts.find(({phase}) => phase === 'implement');
  assert.match(resumedImplementation.prompt,/Implement the saved plan/);
  assert.doesNotMatch(resumedImplementation.prompt,/Continue the interrupted plan turn/);
});

test('natural-language owner requests recover a technical pause in the exact session', async (t) => {
  const f = await fixture(t);
  f.faults.turnPause = true;
  assert.equal((await f.run()).status,'paused');

  f.faults.turnPause = false;
  await f.comment({id:201,body:'Please continue from the saved work.'});
  await f.run();
  assert.equal((await f.state()).status,'ready');
  assert.deepEqual(f.calls.threads,[{method:'start'},{method:'resume',sessionId:SESSION_ID}]);
  assert.ok(f.calls.prompts.some(({prompt}) => prompt.includes('Please continue from the saved work.')));
});

test('the controller trusts an already validated semantic resume route without parsing words', async (t) => {
  const f = await fixture(t);
  f.faults.turnPause = true;
  assert.equal((await f.run()).status,'paused');

  f.faults.turnPause = false;
  await f.comment({id:202,body:'This validated instruction contains no routing keyword.'});
  await f.run();
  assert.equal((await f.state()).status,'ready');
  assert.ok(f.calls.prompts.some(({prompt}) => prompt.includes('This validated instruction contains no routing keyword.')));
});

test('manual dispatch remains available for a waiting continuation', async (t) => {
  const f = await fixture(t);
  f.faults.questions = true;
  assert.equal((await f.run()).status,'awaiting-human');
  f.faults.questions = false;
  f.env.GITHUB_EVENT_NAME = 'workflow_dispatch';
  f.env.GITHUB_RUN_ID = '2';
  assert.equal((await f.run())?.status, undefined);
  assert.equal((await f.state()).status,'ready');
  assert.deepEqual(f.calls.threads,[{method:'start'},{method:'resume',sessionId:SESSION_ID}]);
});

test('missing and inactive continuation state never starts Codex', async (t) => {
  const missing = await fixture(t);
  await missing.comment({id:203,body:'Continue.'});
  assert.equal((await missing.run())?.status,'ignored');
  assert.equal(missing.calls.clients,0);

  const inactive = await fixture(t);
  inactive.faults.sourceState = 'closed';
  await inactive.comment({id:204,body:'Continue.'});
  assert.equal((await inactive.run())?.status,'ignored');
  assert.equal(inactive.calls.clients,0);
});

test('pull-request comments cannot enter controller continuation', async (t) => {
  const f = await fixture(t);
  await f.comment({id:205,body:'Continue.',pullRequest:true});
  await assert.rejects(f.run(),/pull request/);
  assert.equal(f.calls.clients,0);
});

test('a missing UUID in versioned waiting state fails without starting a replacement thread', async (t) => {
  const f = await fixture(t);
  await mkdir(f.issueRoot,{recursive:true});
  await writeFile(path.join(f.issueRoot,'state.json'),JSON.stringify({
    version:2,repository:'fixture/repo',issue:'7',phase:'plan',status:'awaiting-human',
    waitingCommentId:'100',events:[],consumedCommentIds:[],tasks:[],plan,
  }));
  await f.comment({id:206,body:'Use result.txt.'});
  assert.equal((await f.run())?.status,'paused');
  assert.equal(f.calls.clients,0);
  assert.match((await f.state()).reason,/session ID is missing/i);
});

test('a resumed UUID mismatch fails without falling back to a new thread', async (t) => {
  const f = await fixture(t);
  await mkdir(f.issueRoot,{recursive:true});
  await writeFile(path.join(f.issueRoot,'state.json'),JSON.stringify({
    version:2,repository:'fixture/repo',issue:'7',phase:'plan',status:'awaiting-human',
    sessionId:SESSION_ID,waitingCommentId:'100',events:[],consumedCommentIds:[],tasks:[],plan,
  }));
  f.faults.resumeSessionId = REPLACEMENT_SESSION_ID;
  await f.comment({id:207,body:'Use result.txt.'});
  assert.equal((await f.run())?.status,'paused');
  assert.deepEqual(f.calls.threads,[{method:'resume',sessionId:SESSION_ID}]);
  assert.equal(f.calls.turns.length,0);
  assert.match((await f.state()).reason,/session ID mismatch/i);
});

test('legacy waiting state is migrated once into a persistent replacement session', async (t) => {
  const f = await fixture(t);
  await mkdir(f.issueRoot,{recursive:true});
  await writeFile(path.join(f.issueRoot,'state.json'),JSON.stringify({
    repository:'fixture/repo',issue:'7',phase:'plan',status:'needs_input',
    auditCommentIds:[100],events:[],tasks:[],lastProgress:'The old thread asked a question.',
  }));
  await f.comment({id:208,body:'Use result.txt.'});
  await f.run();
  const state = await f.state();
  assert.equal(state.version,3);
  assert.equal(state.sessionId,SESSION_ID);
  assert.equal(state.legacySessionReconstructed,true);
  assert.deepEqual(f.calls.threads,[{method:'start'}]);
  assert.ok(f.calls.comments.some((body) => body.includes('Legacy continuation state reconstructed')));
});

test('comments at or before the waiting boundary are ignored without consuming the continuation', async (t) => {
  const f = await fixture(t);
  f.faults.questions = true;
  await f.run();
  const boundary = BigInt((await f.state()).waitingCommentId);
  await f.comment({id:String(boundary),body:'A stale answer.'});
  assert.equal((await f.run())?.status,'ignored');
  assert.equal((await f.state()).status,'awaiting-human');
  assert.deepEqual(f.calls.turns,['plan']);
});

test('a consumed continuation comment cannot run twice after a technical pause', async (t) => {
  const f = await fixture(t);
  f.faults.questions = true;
  await f.run();
  f.faults.questions = false;
  f.faults.turnPause = true;
  await f.comment({id:210,body:'Use result.txt.'});
  assert.equal((await f.run())?.status,'paused');
  const turns = f.calls.turns.length;
  assert.ok((await f.state()).consumedCommentIds.includes('210'));
  f.faults.turnPause = false;
  await f.run();
  assert.equal(f.calls.turns.length,turns);
  assert.equal((await f.state()).status,'paused');
});

test('bot comments do not change the saved source digest', async (t) => {
  const f = await fixture(t);
  f.faults.failPublish = true;
  f.faults.sourceComments = [{id:10001,user:{login:'github-actions[bot]',type:'Bot'},body:'bot progress one'}];
  await f.run();
  assert.equal((await f.state()).phase,'publish');
  f.faults.sourceComments[0].body = 'bot progress two';
  f.faults.failPublish = false;
  await f.resume();
  assert.equal((await f.state()).status,'ready');
  assert.deepEqual(f.calls.turns,['plan','implement']);
});
