import { resolveValidationProfile, validationProfileReference } from '../../scripts/lib/validation-profile.mjs';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { test } from 'node:test';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readFile, writeFile, mkdir, rm, access, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { deliver, invocationSourceRoute } from '../../scripts/codex-delivery.mjs';
import { validatePullRequestBody } from '../../scripts/validate-pull-request-body.mjs';
import { ACTIVE_TIME_LIMIT_MS, createActiveTimeAllowance, reserveActiveTime } from '../../scripts/lib/operation-active-time.mjs';
import { currentOperationPolicyReference } from '../../scripts/lib/operation-budget-policy.mjs';

const exec = promisify(execFile);
const plan = {status:'ready', kind:'requirements', summary:'Add the requested file.', plan:'Add result.txt and verify it.', tasks:['Add result.txt.'], questions:[], changeType:'feat', title:'feat: ✨ add requested file'};
const SESSION_ID = '019fb023-24b8-7881-9119-509f078b610e';
const REPLACEMENT_SESSION_ID = '019fb023-24b8-7881-9119-509f078b611f';

test('uses the global GitHub issue-comment route for conversation comments', () => {
  assert.equal(invocationSourceRoute({ sourceKind: 'issue_comment', sourceId: '7', pullRequestNumber: '44' }), '/issues/comments/7');
  assert.equal(invocationSourceRoute({ sourceKind: 'pull_request_comment', sourceId: '7', pullRequestNumber: '44' }), '/issues/comments/7');
  assert.equal(invocationSourceRoute({ sourceKind: 'pull_request_review', sourceId: '7', pullRequestNumber: '44' }), '/pulls/44/reviews/7');
  assert.equal(invocationSourceRoute({ sourceKind: 'pull_request_review_comment', sourceId: '7', pullRequestNumber: '44' }), '/pulls/comments/7');
});

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
  const env = {...process.env, GITHUB_ACTIONS:'false', GH_TOKEN:'fixture-token', PUBLISH_TOKEN:'fixture-publish-token', GITHUB_EVENT_PATH:eventFile, RUNNER_WORKSPACE:root,
    CODEX_DELIVERY_STATE_DIR:stateRoot, GITHUB_REPOSITORY:'fixture/repo', GITHUB_ACTOR:'maintainer', PARTICIPANT_MODE:'active',
    GITHUB_EVENT_NAME:'workflow_call', READ_ONLY_RUN:'false', GITHUB_RUN_ID:'1', SOURCE_ISSUE:'7'};
  const calls = {turns:[], prompts:[], commands:[], comments:[], prs:[], threads:[], publishHeaders:[], pushHeaders:[], accessTokenRequests:[], clients:0, closes:0};
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
    organizationIssueTypes:issueTypes.map(([id, name]) => ({id:`IT_${id}`, name, isEnabled:true, pinnedFields:[
      {id:'lifecycle-stage',name:'Lifecycle Stage',dataType:'SINGLE_SELECT'},
      {id:'delivery-readiness',name:'Delivery Readiness',dataType:'SINGLE_SELECT'},
    ]})),
    organizationPinnedIssueFields:[
      {id:'lifecycle-stage',name:'Lifecycle Stage',dataType:'SINGLE_SELECT'},
      {id:'delivery-readiness',name:'Delivery Readiness',dataType:'SINGLE_SELECT'},
    ],
    organizationIssueFields:faults.organizationIssueFieldsMissing ? [] : [
      {id:'lifecycle-stage',name:'Lifecycle Stage',dataType:'SINGLE_SELECT',options:Object.entries(stageNames).map(([id,name]) => ({id,name}))},
      {id:'delivery-readiness',name:'Delivery Readiness',dataType:'SINGLE_SELECT',options:Object.entries(readinessNames).map(([id,name]) => ({id,name}))},
    ],
  });
  const dependencies = {
    resolveValidationProfile:({ controllerCommit }) => resolveValidationProfile({ repositoryId:'1358455028', repository:'agentic-delivery-lab/agentic-delivery', controllerCommit }),
    now: () => faults.nowMs ?? Date.now(),
    fetch:async (url, options) => {
      if (url.endsWith('/installation/token') && options.method === 'DELETE') return new Response(null, {status:204});
      if (url.endsWith('/access_tokens')) {
        calls.accessTokenRequests.push(JSON.parse(options.body));
        return new Response(JSON.stringify({token:'fixture-installation-token', expires_at:'2099-01-01T00:00:00Z'}), {status:201});
      }
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
          if (faults.beforeCommand) await faults.beforeCommand(command);
          calls.commands.push({command,cwd,profile,timeout});
          if (faults.installation && command[1] === 'install') throw new Error('Fixture dependency installation failed');
          if (faults.validation && command[1] === 'install') return '';
          if (faults.validation) throw new Error('Fixture validation failed');
          return '';
        },
        close:async () => { calls.closes++; if (faults.shutdown) throw new Error('Owned process group is still active'); },
      };
    },
    runTurn:async ({phase,threadId,prompt,onProgress}) => {
      if (faults.beforeTurn) await faults.beforeTurn();
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
    validationProfileReference:async () => validationProfileReference(dependencies.resolveValidationProfile({controllerCommit:(await exec('git',['-C',path.resolve(import.meta.dirname,'../..'),'rev-parse','HEAD'])).stdout.trim()})),
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
  assert.equal(state.version,5); assert.equal(state.sessionId,SESSION_ID);
  assert.equal(state.evidence.schemaVersion, 2);
  assert.equal(state.evidence.sourceIssue.number, 7);
  assert.equal(state.evidence.operation.id, state.operationId);
  assert.equal(state.evidence.operation.repositoryId, '101');
  assert.equal(state.evidence.operation.consumption.modelTurns, 2);
  assert.equal(state.evidence.operation.consumption.toolInvocations, null);
  assert.equal(state.evidence.operation.activeTime.reservation.owner, `${f.env.GITHUB_RUN_ID}:${f.env.GITHUB_RUN_ATTEMPT ?? '1'}`);
  assert.equal(state.evidence.codexSession.id, SESSION_ID);
  assert.deepEqual(f.calls.turns,['plan','implement']); assert.equal(f.calls.prs.length,1);
  assert.deepEqual(f.calls.threads,[{method:'start'}]);
  assert.match(f.calls.prs[0].body,/Closes #7/);
  assert.match(f.calls.prs[0].body,/codex-delivery-evidence:v2/);
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

test('rejects an origin repository ID that differs from the authenticated event before execution', async (t) => {
  const f = await fixture(t);
  f.env.ORIGIN_REPOSITORY_ID = '202';
  await assert.rejects(f.run(), /Origin repository ID does not match the authenticated event repository/);
  assert.equal(f.calls.clients, 0);
  assert.equal(f.calls.prs.length, 0);
});

test('delivery mints an origin-scoped App token with the declared organization metadata reads', async (t) => {
  const f = await fixture(t);
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  f.env.CODEX_DELIVERY_APP_ID = '5011055';
  f.env.CODEX_DELIVERY_APP_PRIVATE_KEY = privateKey.export({ type: 'pkcs8', format: 'pem' });
  f.env.CODEX_DELIVERY_APP_INSTALLATION_ID = '163255060';
  delete f.env.PUBLISH_TOKEN;

  await f.run();

  assert.deepEqual(f.calls.accessTokenRequests, [{
    permissions: {
      contents: 'write', issues: 'write', pull_requests: 'write',
      issue_fields: 'read', issue_types: 'read',
    },
    repository_ids: ['101'],
  }]);
});

test('delivery rejects read-only and missing run policy before token creation and model startup', async (t) => {
  for (const scenario of [
    { name: 'read-only run', value: 'true' },
    { name: 'missing run policy', value: undefined },
  ]) {
    await t.test(scenario.name, async (subtest) => {
      const f = await fixture(subtest);
      const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
      f.env.CODEX_DELIVERY_APP_ID = '5011055';
      f.env.CODEX_DELIVERY_APP_PRIVATE_KEY = privateKey.export({ type: 'pkcs8', format: 'pem' });
      f.env.CODEX_DELIVERY_APP_INSTALLATION_ID = '163255060';
      delete f.env.PUBLISH_TOKEN;
      if (scenario.value === undefined) delete f.env.READ_ONLY_RUN;
      else f.env.READ_ONLY_RUN = scenario.value;

      await assert.rejects(f.run(), /explicitly non-read-only run/);
      assert.equal(f.calls.accessTokenRequests.length, 0);
      assert.equal(f.calls.clients, 0);
      assert.equal(f.calls.turns.length, 0);
      assert.equal(f.calls.prs.length, 0);
    });
  }
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

test('GitHub Actions delivery refuses publication-token fallbacks when App credentials are missing', async (t) => {
  const f = await fixture(t);
  f.env.GITHUB_ACTIONS = 'true';

  await assert.rejects(f.run(), /GitHub Actions delivery requires the organization-installed GitHub App credentials; refusing PUBLISH_TOKEN or GH_TOKEN fallback/);
  assert.equal(f.calls.accessTokenRequests.length, 0);
  assert.equal(f.calls.clients, 0);
  assert.equal(f.calls.turns.length, 0);
  assert.equal(f.calls.prs.length, 0);
});

test('rejects delivery execution for a shadow participant before model startup', async (t) => {
  const f = await fixture(t);
  f.env.PARTICIPANT_MODE = 'shadow';
  await assert.rejects(f.run(), /Shadow participants are read-only/);
  assert.equal(f.calls.clients, 0);
});

test('rejects missing or invalid participant mode before delivery startup', async (t) => {
  for (const mode of [undefined, 'unknown']) {
    const f = await fixture(t);
    if (mode === undefined) delete f.env.PARTICIPANT_MODE;
    else f.env.PARTICIPANT_MODE = mode;
    await assert.rejects(f.run(), /requires an active participant mode resolved during intake/);
    assert.equal(f.calls.accessTokenRequests.length, 0);
    assert.equal(f.calls.clients, 0);
  }
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
  assert.equal((await f.state()).activeTime.reservation.owner, '1:1');
  assert.equal((await f.state()).activeTime.spentMs, 0);
  assert.match(await readFile(path.join(f.issueRoot,'CONTINUE.md'),'utf8'),/Delivery paused/);
});

test('manual repair cannot replenish exhausted validation or repeat implementation', async (t) => {
  const f = await fixture(t); f.faults.validation = true;
  await f.run(); assert.equal((await f.state()).phase,'verify');
  const turns = f.calls.turns.length;
  f.faults.validation = false; await f.resume();
  assert.equal((await f.state()).status,'paused'); assert.equal(f.calls.turns.length,turns);
  assert.equal((await f.state()).validationAttemptCount, 3);
  assert.equal(f.calls.prs.length, 0);
});

test('exhausted saved verification holds before reading changed lifecycle state', async (t) => {
  const f = await fixture(t); f.faults.validation = true;
  await f.run(); assert.equal((await f.state()).phase,'verify');
  const clients = f.calls.clients;
  const turns = [...f.calls.turns];
  f.faults.sourceFields = {lifecycle_stage:'intake', readiness:'needs-info'};
  const result = await f.resume();
  assert.equal(result.status, 'paused');
  assert.match(result.reason, /validation allowance is exhausted/);
  assert.equal(f.calls.clients, clients);
  assert.deepEqual(f.calls.turns, turns);
});

test('resuming exhausted validation cannot reset the operation allowance or invoke model tools', async (t) => {
  const f = await fixture(t);
  f.faults.validation = true;
  assert.equal((await f.run()).status, 'paused');
  const clients = f.calls.clients;
  const commands = f.calls.commands.length;
  const turns = [...f.calls.turns];
  const result = await f.resume();
  assert.equal(result.status, 'paused');
  assert.equal(f.calls.clients, clients, 'exhausted operations must hold before opening another model client');
  assert.equal(f.calls.commands.length, commands, 'resumption cannot start another validation allowance');
  assert.deepEqual(f.calls.turns, turns);
  assert.equal(f.calls.prs.length, 0);
  assert.equal(f.calls.pushHeaders.length, 0);
});

test('missing validation consumption holds a saved operation instead of resetting its allowance', async (t) => {
  const f = await fixture(t);
  f.faults.validation = true;
  await f.run();
  const state = await f.state();
  delete state.validationAttemptCount;
  await writeFile(path.join(f.issueRoot, 'state.json'), JSON.stringify(state));
  const clients = f.calls.clients;
  const result = await f.resume();
  assert.equal(result.status, 'paused');
  assert.match(result.reason, /Validation consumption is unknown/);
  assert.equal(f.calls.clients, clients);
  assert.equal((await f.state()).validationAttemptCount, undefined, 'held input remains unchanged');
  const receiptRoot = path.join(f.issueRoot, 'budget-holds');
  const receipts = await Promise.all((await readdir(receiptRoot)).map(async (file) =>
    JSON.parse(await readFile(path.join(receiptRoot, file), 'utf8'))));
  const receipt = receipts.find((entry) => entry.outcome === 'admission-held');
  assert.ok(receipt, 'the resumed invocation records its own admission hold');
  assert.equal(receipt.consumption.validationAttempts,null);assert.equal(receipt.privilegedActionsPerformed,false);
});

test('model turns share one eight-turn allowance across automatic continuation and resume', async (t) => {
  const f = await fixture(t);
  f.faults.incompleteTurns = 10;
  const result = await f.run();
  assert.equal(result?.status, 'paused');
  assert.match(result.reason, /model turn allowance is exhausted/);
  assert.equal(f.calls.turns.length, 8);
  assert.equal((await f.state()).modelTurnCount, 8);
  assert.equal((await f.state()).execution.lastFailure.recoverability, 'owner-action');
  const clients = f.calls.clients;
  const resumed = await f.resume();
  assert.equal(resumed.status, 'paused');
  assert.equal(f.calls.clients, clients);
  assert.equal(f.calls.turns.length, 8);
  assert.equal(f.calls.prs.length, 0);
  assert.equal(f.calls.pushHeaders.length, 0);
});

test('the eighth model turn can complete within the same saved allowance', async (t) => {
  const f = await fixture(t);
  f.faults.incompleteTurns = 6;
  await f.run();
  const state = await f.state();
  assert.equal(state.status, 'ready');
  assert.equal(state.modelTurnCount, 8);
  assert.equal(state.validationAttemptCount, 1);
  assert.equal(f.calls.turns.length, 8);
  assert.equal(f.calls.prs.length, 1);
});

test('resource reservations are saved before model turns and validation commands execute', async (t) => {
  const f = await fixture(t);
  let validations = 0;
  f.faults.beforeTurn = async () => {
    assert.equal((await f.state()).modelTurnCount, f.calls.turns.length + 1);
  };
  f.faults.beforeCommand = async (command) => {
    if (command[0] === 'node' && path.basename(command[1]) === 'run-delivery-tests.mjs') {
      validations++;
      assert.equal((await f.state()).validationAttemptCount, validations);
    }
  };
  await f.run();
  assert.equal(validations, 1);
  assert.equal((await f.state()).status, 'ready');
});

test('active time settles across attempts and excludes time awaiting clarification', async (t) => {
  const f = await fixture(t);
  f.faults.nowMs = 100;
  f.faults.questions = true;
  f.faults.beforeTurn = async () => { f.faults.nowMs += 1000; };
  await f.run();
  const paused = await f.state();
  assert.ok(paused.activeTime, 'the controller must persist an active-time receipt');
  assert.equal(paused.activeTime.spentMs, 1000);
  assert.equal(paused.activeTime.reservation, null);
  f.faults.nowMs += ACTIVE_TIME_LIMIT_MS * 10;
  f.faults.questions = false;
  await f.comment({ id: 209, body: 'Use result.txt.' });
  await f.run();
  const completed = await f.state();
  assert.equal(completed.status, 'ready');
  assert.equal(completed.activeTime.spentMs, 3000);
  assert.equal(completed.activeTime.reservation, null);
});

test('active time exhaustion stops implementation and publication after the planning turn', async (t) => {
  const f = await fixture(t);
  f.faults.nowMs = 100;
  let commentsAtStop;
  f.faults.beforeTurn = async () => { f.faults.nowMs += ACTIVE_TIME_LIMIT_MS;commentsAtStop=f.calls.comments.length; };
  const result = await f.run();
  assert.equal(result?.status, 'paused');
  assert.match(result.reason, /active time allowance is exhausted/);
  assert.deepEqual(f.calls.turns, ['plan']);
  assert.equal(f.calls.comments.length,commentsAtStop,'deadline stops must not post an exempt audit comment');
  assert.equal(f.calls.prs.length, 0);
  assert.equal(f.calls.pushHeaders.length, 0);
  assert.equal((await f.state()).activeTime.spentMs, ACTIVE_TIME_LIMIT_MS);
});

test('an unsettled active-time reservation cannot be replaced on resume', async (t) => {
  const f = await fixture(t);
  f.faults.turnPause = true;
  await f.run();
  const saved = await f.state();
  saved.activeTime = reserveActiveTime(createActiveTimeAllowance(), { owner: '1:1', nowMs: 100 });
  await writeFile(path.join(f.issueRoot, 'state.json'), JSON.stringify(saved));
  const clients = f.calls.clients;
  const result = await f.resume();
  assert.equal(result.status, 'paused');
  assert.match(result.reason, /unsettled/);
  assert.equal(f.calls.clients, clients);
  assert.deepEqual((await f.state()).activeTime.reservation, saved.activeTime.reservation);
});

test('controlled tools receive at most the remaining active-time allowance', async (t) => {
  const f = await fixture(t);
  f.faults.nowMs = 100;
  f.faults.beforeTurn = async () => { f.faults.nowMs += 850_000; };
  await f.run();
  assert.equal((await f.state()).status, 'ready');
  const verification = f.calls.commands.filter(({ command }) => command[0] === 'node');
  assert.ok(verification.length > 0);
  assert.ok(verification.every(({ timeout }) => timeout === ACTIVE_TIME_LIMIT_MS - 1_700_000));
  assert.equal((await f.state()).activeTime.spentMs, 1_700_000);
});

test('one operation identity and policy reference survive an answered clarification', async (t) => {
  const f = await fixture(t);
  f.faults.questions = true;
  await f.run();
  const paused = await f.state();
  assert.match(paused.operationId ?? '', /^[a-f0-9-]{36}$/);
  assert.deepEqual(paused.budgetPolicyReference, currentOperationPolicyReference());
  f.faults.questions = false;
  await f.comment({ id: 210, body: 'Use result.txt.' });
  await f.run();
  const completed = await f.state();
  assert.equal(completed.operationId, paused.operationId);
  assert.deepEqual(completed.budgetPolicyReference, paused.budgetPolicyReference);
});

test('changed policy identity holds before another model client or protected publication', async (t) => {
  const f = await fixture(t);
  f.faults.turnPause = true;
  await f.run();
  const saved = await f.state();
  saved.budgetPolicyReference = { ...currentOperationPolicyReference(), sha256: '0'.repeat(64) };
  await writeFile(path.join(f.issueRoot, 'state.json'), JSON.stringify(saved));
  const clients = f.calls.clients;
  const result = await f.resume();
  assert.equal(result.status, 'paused');
  assert.match(result.reason, /budget policy is missing or changed/);
  assert.equal(f.calls.clients, clients);
  assert.equal(f.calls.prs.length, 0);
  assert.equal(f.calls.pushHeaders.length, 0);
});

test('publication retries retain one bounded controller-attempt allowance', async (t) => {
  const f = await fixture(t);
  f.faults.failPublish = true;
  await f.run();
  for (let attempt = 2; attempt <= 8; attempt++) await f.resume();
  const saved = await f.state();
  assert.equal(saved.controllerAttemptCount, 8);
  const turns = [...f.calls.turns];
  const publishRequests = f.calls.publishHeaders.length;
  f.faults.failPublish = false;
  const result = await f.resume();
  assert.equal(result.status, 'paused');
  assert.match(result.reason, /controller attempt allowance is exhausted/);
  assert.equal(f.calls.publishHeaders.length, publishRequests);
  assert.deepEqual(f.calls.turns, turns);
  assert.equal(f.calls.prs.length, 0);
});

test('missing controller-attempt history cannot become a fresh allowance on resume', async (t) => {
  const f = await fixture(t);
  f.faults.turnPause = true;
  await f.run();
  const saved = await f.state();
  delete saved.controllerAttemptCount;
  await writeFile(path.join(f.issueRoot, 'state.json'), JSON.stringify(saved));
  const clients = f.calls.clients;
  const result = await f.resume();
  assert.equal(result.status, 'paused');
  assert.match(result.reason, /Controller attempt consumption is unknown/);
  assert.equal(f.calls.clients, clients);
  assert.equal((await f.state()).controllerAttemptCount, undefined, 'unknown history is preserved');
  const receiptRoot = path.join(f.issueRoot, 'budget-holds');
  const receipts = await Promise.all((await readdir(receiptRoot)).map(async (file) =>
    JSON.parse(await readFile(path.join(receiptRoot, file), 'utf8'))));
  const receipt = receipts.find((entry) => entry.outcome === 'admission-held');
  assert.ok(receipt, 'the resumed invocation records its own admission hold');
  assert.equal(receipt.consumption.controllerAttempts,null);assert.equal(receipt.authorityRevalidated,false);
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
  f.env.READ_ONLY_RUN = 'false';
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
    version:5,repository:'fixture/repo',issue:'7',phase:'plan',status:'awaiting-human',
    waitingCommentId:'100',events:[],consumedCommentIds:[],tasks:[],plan,
    modelTurnCount:0,validationAttemptCount:0,controllerAttemptCount:0,activeTime:createActiveTimeAllowance(),
    operationId:'12345678-1234-4234-8234-123456789012',budgetPolicyReference:currentOperationPolicyReference(),validationProfileReference:await f.validationProfileReference(),
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
    modelTurnCount:0,validationAttemptCount:0,
    controllerAttemptCount:0,
    activeTime:createActiveTimeAllowance(),
    operationId:'12345678-1234-4234-8234-123456789012',budgetPolicyReference:currentOperationPolicyReference(),validationProfileReference:await f.validationProfileReference(),
  }));
  f.faults.resumeSessionId = REPLACEMENT_SESSION_ID;
  await f.comment({id:207,body:'Use result.txt.'});
  assert.equal((await f.run())?.status,'paused');
  assert.deepEqual(f.calls.threads,[{method:'resume',sessionId:SESSION_ID}]);
  assert.equal(f.calls.turns.length,0);
  assert.match((await f.state()).reason,/session ID mismatch/i);
});

test('legacy waiting state with unknown consumption is held without a replacement session', async (t) => {
  const f = await fixture(t);
  await mkdir(f.issueRoot,{recursive:true});
  await writeFile(path.join(f.issueRoot,'state.json'),JSON.stringify({
    repository:'fixture/repo',issue:'7',phase:'plan',status:'needs_input',
    auditCommentIds:[100],events:[],tasks:[],lastProgress:'The old thread asked a question.',
  }));
  await f.comment({id:208,body:'Use result.txt.'});
  const before=await readFile(path.join(f.issueRoot,'state.json'),'utf8');
  const result=await f.run();
  const state = await f.state();
  assert.equal(await readFile(path.join(f.issueRoot,'state.json'),'utf8'),before);
  assert.equal(state.version,undefined);
  assert.equal(result.status, 'paused');
  assert.equal(state.status, 'needs_input');
  assert.equal(state.sessionId, undefined);
  assert.equal(state.modelTurnCount, undefined);
  assert.match(result.reason, /operation identity is unknown/);
  assert.equal(f.calls.clients, 0);
  assert.deepEqual(f.calls.threads, []);
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

test('unsupported validation identity holds before model execution', async (t) => {
  const f = await fixture(t);
  delete f.dependencies.resolveValidationProfile;
  await assert.rejects(f.run(), /validation profile/i);
  assert.equal(f.calls.clients, 0);
  assert.equal(f.calls.prs.length, 0);
});

test('public validation profile omits dependency installation and factory layout checks', async (t) => {
  const f = await fixture(t);
  f.dependencies.resolveValidationProfile = ({ controllerCommit }) => resolveValidationProfile({ repositoryId:'1368850419', repository:'agentic-delivery-lab/.github', controllerCommit });
  await f.run();
  assert.ok(f.calls.commands.some(({command}) => command.includes('--surface-root')));
  assert.ok(!f.calls.commands.some(({command}) => command[0] === 'pnpm'));
  const state = await f.state();
  assert.equal(state.validationProfileReference.id, 'public-adapter');
  assert.equal(state.validationEvidence.tree, state.validatedTree);
  assert.equal(state.validationEvidence.commands.length, 2);
});

test('changed validation profile cannot resume or publish the saved operation', async (t) => {
  const f = await fixture(t);
  f.faults.pauseImplementation = true;
  await f.run();
  const state = await f.state();
  state.validationProfileReference.contentSha256 = '0'.repeat(64);
  await writeFile(path.join(f.issueRoot,'state.json'), JSON.stringify(state));
  const clients = f.calls.clients;
  await f.resume();
  assert.equal(f.calls.clients, clients);
  assert.equal(f.calls.prs.length, 0);
  assert.match((await f.state()).reason, /validation profile/i);
});

test('missing saved validation profile holds without provisioning a replacement pin', async (t) => {
  const f = await fixture(t);
  f.faults.pauseImplementation = true;
  await f.run();
  const state = await f.state();
  delete state.validationProfileReference;
  await writeFile(path.join(f.issueRoot,'state.json'), JSON.stringify(state));
  const clients = f.calls.clients;
  await f.resume();
  const held = await f.state();
  assert.equal(f.calls.clients, clients);
  assert.equal(held.validationProfileReference, null);
  assert.equal(held.modelTurnCount, state.modelTurnCount);
  assert.match(held.reason, /validation profile/i);
});

test('private validation holds while its canonical source input is unavailable', async (t) => {
  const f = await fixture(t);
  f.dependencies.resolveValidationProfile = ({controllerCommit}) => resolveValidationProfile({repositoryId:'1380894756',repository:'agentic-delivery-lab/.github-private',controllerCommit});
  await assert.rejects(f.run(), /trusted absolute read-only input/);
  assert.equal(f.calls.clients,0);
  assert.equal(f.calls.prs.length,0);
});

test('failed validation records its candidate tree and command failure digest', async (t) => {
  const f = await fixture(t);
  f.faults.validation = true;
  await f.run();
  const state = await f.state();
  assert.match(state.validationEvidence.tree, /^[a-f0-9]{40}$/);
  assert.equal(state.validationEvidence.commands[0].status,'failed');
  assert.match(state.validationEvidence.commands[0].errorSha256,/^[a-f0-9]{64}$/);
  assert.equal(state.validationAttemptCount,3);
  assert.equal(f.calls.prs.length,0);
});

test('exhausted resumption holds before token minting and preserves queued comments',async(t)=>{
 const f=await fixture(t);f.faults.validation=true;await f.run();
 const saved=await f.state();saved.outbox=['Queued evidence that must remain local after exhaustion.'];
 await writeFile(path.join(f.issueRoot,'state.json'),JSON.stringify(saved));
 const {privateKey}=generateKeyPairSync('rsa',{modulusLength:2048});
 f.env.CODEX_DELIVERY_APP_ID='5011055';f.env.CODEX_DELIVERY_APP_PRIVATE_KEY=privateKey.export({type:'pkcs8',format:'pem'});
 f.env.CODEX_DELIVERY_APP_INSTALLATION_ID='163255060';delete f.env.PUBLISH_TOKEN;
 const comments=f.calls.comments.length;const result=await f.resume();
 assert.equal(result.status,'paused');assert.match(result.reason,/validation allowance is exhausted/);
 assert.equal(f.calls.accessTokenRequests.length,0);assert.equal(f.calls.comments.length,comments);
 assert.deepEqual((await f.state()).outbox,saved.outbox);assert.equal((await f.state()).validationAttemptCount,3);
});

test('native GraphQL field writes receive the remaining operation deadline', async (t) => {
  const f = await fixture(t);
  f.faults.nowMs = 100;
  f.faults.beforeTurn = async () => { f.faults.nowMs = 100 + ACTIVE_TIME_LIMIT_MS - 5; };
  const graphql = f.dependencies.graphql;
  const fetchApi = f.dependencies.fetch;
  delete f.dependencies.graphql;
  f.env.GITHUB_GRAPHQL = 'true';
  let expiredSignal;
  let commentsAtStop;
  f.dependencies.fetch = async (url, options) => {
    if (url !== 'https://api.github.com/graphql') return fetchApi(url, options);
    const { query, variables } = JSON.parse(options.body);
    if (f.faults.nowMs > 100) {
      expiredSignal = options.signal;
      await new Promise((resolve, reject) => {
        const timer = setTimeout(resolve, 1000);
        options.signal.addEventListener('abort', () => {
          clearTimeout(timer);
          f.faults.nowMs = 100 + ACTIVE_TIME_LIMIT_MS;
          commentsAtStop = f.calls.comments.length;
          reject(options.signal.reason);
        }, { once: true });
      });
      assert.fail('field request should abort within the remaining allowance');
    }
    return new Response(JSON.stringify({ data: await graphql(query, variables) }), { status: 200 });
  };
  await assert.rejects(() => f.run(), /active time allowance is exhausted/);
  assert.equal(expiredSignal.aborted, true);
  assert.equal(f.calls.comments.length, commentsAtStop);
  assert.equal(f.calls.prs.length, 0);
  assert.equal(f.calls.pushHeaders.length, 0);
});


test('failed dependency preparation consumes validation allowance across resumed attempts', async (t) => {
  const f = await fixture(t);
  f.faults.installation = true;
  await f.run();
  const first = await f.state();
  assert.equal(first.validationAttemptCount, 1);
  assert.deepEqual(f.calls.turns, ['plan']);
  await f.resume();
  assert.equal((await f.state()).validationAttemptCount, 2);
  const exhausted = await f.resume();
  assert.match(exhausted.reason, /validation allowance is exhausted/);
  assert.equal((await f.state()).validationAttemptCount, 3);
  const attempts = f.calls.commands.length;
  const clients = f.calls.clients;
  await f.resume();
  assert.equal(f.calls.commands.length, attempts);
  assert.equal(f.calls.clients, clients);
  assert.equal((await f.state()).operationId, first.operationId);
  assert.equal(f.calls.prs.length, 0);
});

test('a prepared third validation attempt survives clarification without minting a fourth', async (t) => {
  const f = await fixture(t);
  f.faults.installation = true;
  await f.run();
  await f.resume();
  f.faults.installation = false;
  f.faults.implementationQuestion = true;
  await f.resume();
  const waiting = await f.state();
  assert.equal(waiting.status, 'awaiting-human');
  assert.equal(waiting.validationAttemptCount, 3);
  assert.equal(waiting.validationPrepared, true);
  f.faults.implementationQuestion = false;
  await f.comment({ id: 219, body: 'Use the existing wording.' });
  await f.run();
  const completed = await f.state();
  assert.equal(completed.status, 'ready');
  assert.equal(completed.validationAttemptCount, 3);
  assert.equal(completed.validationPrepared, false);
  assert.equal(completed.operationId, waiting.operationId);
  assert.equal(f.calls.prs.length, 1);
});

async function operationReceipts(f) {
  const root = path.join(f.issueRoot, 'operation-receipts');
  return Promise.all((await readdir(root)).filter((file) => file.endsWith('.json')).map(async (file) =>
    JSON.parse(await readFile(path.join(root, file), 'utf8'))));
}

test('invalid saved state journals held admission and terminal without trusting or changing its bytes', async (t) => {
  const f = await fixture(t);
  await mkdir(f.issueRoot, {recursive:true});
  const stateFile = path.join(f.issueRoot, 'state.json');
  const invalid = '{"operationId":"untrusted", "controllerAttemptCount":0';
  await writeFile(stateFile, invalid);
  appCredentials(f);
  await assert.rejects(() => f.run(), /Invalid saved state/);
  assert.equal(await readFile(stateFile, 'utf8'), invalid);
  const receipts = await operationReceipts(f);
  assert.equal(receipts.length, 2);
  assert.deepEqual(receipts.map(value => value.stage).sort(), ['admission','terminal']);
  for (const receipt of receipts) {
    assert.equal(receipt.outcome, 'held');
    assert.equal(receipt.operationId, null);
    assert.equal(receipt.policy, null);
    assert.equal(receipt.configuredLimits, null);
    assert.equal(receipt.actor.authorityChecked, false);
    assert.deepEqual(receipt.consumption, {controllerAttempts:null,modelTurns:null,validationAttempts:null,toolInvocations:null});
    assert.match(receipt.recoveryAction, /operator.*inspect/i);
  }
  assert.equal(f.calls.clients, 0);
  assert.equal(f.calls.accessTokenRequests.length, 0);
  assert.deepEqual(f.calls.comments, []);
  assert.deepEqual(f.calls.prs, []);
  assert.deepEqual(f.calls.pushHeaders, []);
});

test('controller journals execution admission and settled publication as separate attempt receipts', async (t) => {
  const f = await fixture(t); await f.run();
  const receipts = await operationReceipts(f);
  const admission = receipts.find((value) => value.stage === 'admission');
  const terminal = receipts.find((value) => value.stage === 'terminal');
  assert.equal(admission.outcome, 'admitted');
  assert.equal(terminal.outcome, 'candidate-published');
  assert.equal(terminal.schemaVersion, 2);
  assert.equal(terminal.configuredLimits.toolInvocations, 100);
  assert.equal(terminal.failureClass, null);
  assert.equal(terminal.operationId, admission.operationId);
  assert.equal(terminal.origin.repositoryId, '101');
  assert.equal(terminal.actor.authorityChecked, true);
  assert.equal(terminal.activeTime.reservation, null);
  assert.equal(terminal.consumption.modelTurns, 2);
  assert.equal(terminal.consumption.toolInvocations, null);
  assert.deepEqual(terminal.shutdown, { ownedExecutionStopped: true, activeTimeSettled: true, issuedTokenRevocationConfirmed: true });
});

test('uncertain owned shutdown writes a held receipt without claiming settled execution', async (t) => {
  const f = await fixture(t); f.faults.shutdown = true;
  await assert.rejects(() => f.run(), /Owned process group is still active/);
  const terminal = (await operationReceipts(f)).find((value) => value.stage === 'terminal');
  assert.equal(terminal.outcome, 'held');
  assert.equal(terminal.shutdown.ownedExecutionStopped, false);
  assert.equal(terminal.shutdown.activeTimeSettled, false);
  assert.equal(terminal.failureClass, 'shutdown');
  assert.match(terminal.recoveryAction, /operator.*stopped/i);
  assert.notEqual(terminal.activeTime.reservation, null);
});

test('failed admission journal prevents model execution and publication', async (t) => {
  const f = await fixture(t);
  f.dependencies.writeOperationReceipt = async () => { throw new Error('Fixture journal unavailable'); };
  await assert.rejects(() => f.run(), /Fixture journal unavailable/);
  assert.equal(f.calls.clients, 0);
  assert.deepEqual(f.calls.turns, []);
  assert.equal(f.calls.prs.length, 0);
  assert.equal(f.calls.pushHeaders.length, 0);
});

test('unconfirmed issued-token revocation holds the attempt and retains its recovery tree', async (t) => {
  const f = await fixture(t);
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  f.env.CODEX_DELIVERY_APP_ID = '5011055';
  f.env.CODEX_DELIVERY_APP_PRIVATE_KEY = privateKey.export({ type: 'pkcs8', format: 'pem' });
  f.env.CODEX_DELIVERY_APP_INSTALLATION_ID = '163255060';
  const fetchApi = f.dependencies.fetch;
  f.dependencies.fetch = async (url, options) => url.endsWith('/installation/token')
    ? new Response(null, { status: 503 }) : fetchApi(url, options);
  await assert.rejects(() => f.run(), /token revocation could not be confirmed/);
  const terminal = (await operationReceipts(f)).find((value) => value.stage === 'terminal');
  assert.equal(terminal.outcome, 'held');
  assert.equal(terminal.shutdown.ownedExecutionStopped, true);
  assert.equal(terminal.shutdown.issuedTokenRevocationConfirmed, false);
  assert.equal(terminal.failureClass, 'credential-cleanup');
  assert.equal(terminal.stopReason, 'issued-token-revocation-unconfirmed');
  assert.equal((await f.state()).status, 'paused');
  await access(f.workspace);
  assert.equal(f.calls.prs.length, 1, 'a published candidate is distinct from accepted cleanup');
  const tokenRequests = f.calls.accessTokenRequests.length;
  const resumed = await f.resume();
  assert.equal(resumed.status, 'paused');
  assert.match(resumed.reason, /account execution lock/);
  assert.equal(f.calls.accessTokenRequests.length, tokenRequests);
  assert.equal((await f.state()).issuedTokenCleanupPending, true);
  // Simulated operator releases the fixture lock, but cannot waive cleanup state.
  await rm(path.join(f.stateRoot, 'account.lock'));
  const afterLockReview = await f.resume();
  assert.match(afterLockReview.reason, /operator reconciliation/);
  assert.equal(f.calls.accessTokenRequests.length, tokenRequests);
  assert.ok((await operationReceipts(f)).some((value) => value.stage === 'admission' && value.priorIssuedTokenCleanupPending && value.outcome === 'held'));
});

function appCredentials(f) {
  const {privateKey}=generateKeyPairSync('rsa',{modulusLength:2048});
  f.env.CODEX_DELIVERY_APP_ID='5011055';f.env.CODEX_DELIVERY_APP_INSTALLATION_ID='163255060';
  f.env.CODEX_DELIVERY_APP_PRIVATE_KEY=privateKey.export({type:'pkcs8',format:'pem'});
}

test('App account-lock collision and new-task comments cannot mint credentials', async(t)=>{
  const f=await fixture(t);appCredentials(f);
  await mkdir(f.stateRoot,{recursive:true});await writeFile(path.join(f.stateRoot,'account.lock'),'other owner');
  assert.equal((await f.run()).status,'paused');assert.equal(f.calls.accessTokenRequests.length,0);
  assert.equal(await readFile(path.join(f.stateRoot,'account.lock'),'utf8'),'other owner');
  await rm(path.join(f.stateRoot,'account.lock'));
  await f.comment({id:301,body:'Continue.'});
  assert.equal((await f.run()).status,'ignored');assert.equal(f.calls.accessTokenRequests.length,0);
});

test('App preflight failure revokes issued tokens without posting or starting models', async(t)=>{
  const f=await fixture(t);appCredentials(f);f.faults.permission='read';let revoked=0;
  const fetchApi=f.dependencies.fetch;
  f.dependencies.fetch=async(url,options)=>{if(url.endsWith('/installation/token')&&options.method==='DELETE')revoked++;return fetchApi(url,options);};
  await assert.rejects(()=>f.run(),/write permission/);
  assert.equal(f.calls.accessTokenRequests.length,1);assert.equal(revoked,1);
  assert.equal(f.calls.clients,0);assert.equal(f.calls.comments.length,0);
  assert.equal((await f.state()).controllerAttemptCount,1);
  assert.equal((await f.state()).activeTime.reservation,null);
  await assert.rejects(()=>access(path.join(f.stateRoot,'account.lock')),/ENOENT/);
});

test('App minting starts only after a persisted time reservation and uses its remaining deadline', async(t)=>{
  const f=await fixture(t);appCredentials(f);f.faults.nowMs=1000;
  const fetchApi=f.dependencies.fetch;let mintSignal;
  f.dependencies.fetch=async(url,options)=>{
    if(url.endsWith('/access_tokens')){
      const state=await f.state();assert.equal(state.controllerAttemptCount,1);assert.ok(state.activeTime.reservation);
      mintSignal=options.signal;f.faults.nowMs+=ACTIVE_TIME_LIMIT_MS;
    }
    return fetchApi(url,options);
  };
  const result=await f.run();assert.equal(result.status,'paused');assert.match(result.reason,/active time allowance is exhausted/);assert.ok(mintSignal);assert.equal(f.calls.clients,0);assert.equal(f.calls.comments.length,0);
  assert.equal((await f.state()).activeTime.spentMs,ACTIVE_TIME_LIMIT_MS);
});

test('uncertain App issuance preserves the lock and blocks resumption before another token',async(t)=>{
  const f=await fixture(t);appCredentials(f);let requests=0;
  const fetchApi=f.dependencies.fetch;
  f.dependencies.fetch=async(url,options)=>{if(url.endsWith('/access_tokens')){requests++;throw new Error('fixture token response lost');}return fetchApi(url,options);};
  await assert.rejects(()=>f.run(),/revocation could not be confirmed/);
  assert.equal((await f.state()).issuedTokenCleanupPending,true);assert.equal(f.calls.clients,0);assert.equal(f.calls.comments.length,0);
  await access(path.join(f.stateRoot,'account.lock'));
  assert.equal((await f.resume()).status,'paused');assert.equal(requests,1);
});

test('inactive saved-comment exits revoke App credentials and preserve unprepared runtime files',async(t)=>{
  const f=await fixture(t);await f.run();appCredentials(f);f.faults.sourceState='closed';
  await f.comment({id:302,body:'Continue.'});
  const home=path.join(f.issueRoot,'run-home');await mkdir(home,{recursive:true});await writeFile(path.join(home,'preserved.txt'),'unprepared input');
  const comments=f.calls.comments.length,clients=f.calls.clients;let revoked=0;const fetchApi=f.dependencies.fetch;
  f.dependencies.fetch=async(url,options)=>{if(url.endsWith('/installation/token')&&options.method==='DELETE')revoked++;return fetchApi(url,options);};
  assert.equal((await f.run()).status,'ignored');assert.equal(revoked,1);
  assert.equal(f.calls.comments.length,comments);assert.equal(f.calls.clients,clients);
  assert.equal(await readFile(path.join(home,'preserved.txt'),'utf8'),'unprepared input');
});
