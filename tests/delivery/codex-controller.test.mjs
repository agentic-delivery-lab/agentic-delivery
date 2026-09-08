import assert from 'node:assert/strict';
import { test } from 'node:test';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readFile, writeFile, mkdir, rm, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { deliver } from '../../scripts/codex-delivery.mjs';

const exec = promisify(execFile);
const plan = {status:'ready', kind:'requirements', summary:'Add the requested file.', plan:'Add result.txt and verify it.', tasks:['Add result.txt.'], questions:[], changeType:'feat', title:'feat: ✨ add requested file'};

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
  await writeFile(eventFile, JSON.stringify({repository:{id:101}}));
  const env = {...process.env, GH_TOKEN:'fixture-token', GITHUB_EVENT_PATH:eventFile, RUNNER_WORKSPACE:root,
    CODEX_DELIVERY_STATE_DIR:stateRoot, GITHUB_REPOSITORY:'fixture/repo', GITHUB_ACTOR:'maintainer',
    GITHUB_EVENT_NAME:'workflow_dispatch', GITHUB_RUN_ID:'1', SOURCE_ISSUE:'7'};
  const calls = {turns:[], commands:[], comments:[], prs:[], clients:0, closes:0};
  const faults = {permission:'write', sourceState:'open'};
  const dependencies = {
    fetch:async (url, options) => {
      const route = url.replace('https://api.github.com/repos/fixture/repo', '');
      const body = options.body ? JSON.parse(options.body) : undefined;
      let data;
      if (route.startsWith('/collaborators/')) data = {permission:faults.permission};
      else if (route === '/issues/7') data = {state:faults.sourceState, title:'Add a file', body:'Create result.txt'};
      else if (route.startsWith('/issues/7/comments')) {
        if (options.method === 'POST') {
          if (faults.failComments) return new Response('{}', {status:503});
          calls.comments.push(body.body); data = {id:calls.comments.length};
        } else data = [];
      } else if (route.startsWith('/pulls?')) data = calls.prs;
      else if (route === '/pulls' || route === '/pulls/8') {
        if (faults.failPublish) return new Response('{}', {status:503});
        data = {number:8, html_url:'https://github.com/fixture/repo/pull/8', ...body};
        if (!calls.prs.length) calls.prs.push(data);
      } else throw new Error(`Unexpected API request: ${route}`);
      return new Response(JSON.stringify(data), {status:200});
    },
    execute:async (command, args, options) => {
      if (command === 'git' && args[0] === 'clone') args = ['clone', '--branch', 'main', origin, workspace];
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
        thread:async () => ({thread:{id:'fixture-thread'}}),
        exec:async (command, cwd, timeout, profile) => {
          calls.commands.push({command,cwd,profile});
          if (faults.validation && command[1] === 'install') return '';
          if (faults.validation) throw new Error('Fixture validation failed');
          return '';
        },
        close:async () => { calls.closes++; if (faults.shutdown) throw new Error('Owned process group is still active'); },
      };
    },
    runTurn:async ({phase,onProgress}) => {
      calls.turns.push(phase);
      if (faults.turnPause) return {status:'paused', reason:'Quota reserve reached.'};
      if (phase === 'plan') return {status:'completed',text:JSON.stringify(faults.questions ? {...plan,status:'needs_input',questions:['Which file?']} : plan)};
      await writeFile(path.join(workspace, 'result.txt'), 'implemented\n');
      await onProgress('Created result.txt; checking the result.');
      if (faults.closeDuringTurn) faults.sourceState = 'closed';
      if (faults.implementationQuestion) return {status:'completed',text:JSON.stringify({status:'needs_input',summary:'Need a decision.',tasks:['Resolve the decision.'],questions:['Which wording?']})};
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
  };
}

test('publishes one recorded branch and PR with a complete issue audit trail', async (t) => {
  const f = await fixture(t); await f.run();
  const state = await f.state();
  assert.equal(state.status,'ready'); assert.equal(state.phase,'publish');
  assert.deepEqual(f.calls.turns,['plan','implement']); assert.equal(f.calls.prs.length,1);
  assert.match(f.calls.prs[0].body,/Closes #7/);
  assert.equal(f.calls.prs[0].base,'main'); assert.equal(f.calls.prs[0].head,state.branch);
  assert.ok(f.calls.comments.some((text) => text.includes('Intake and plan')));
  assert.ok(f.calls.comments.some((text) => text.includes('Review pull request ready')));
  assert.ok(f.calls.commands.some(({command,profile}) => command[1] === 'install' && profile === 'delivery-deps'));
  const validators = f.calls.commands.filter(({command}) => command[1]?.includes('validate-adrs'));
  assert.ok(validators.length); assert.ok(validators.every(({command}) => !command[1].startsWith(f.workspace)));
  await assert.rejects(access(path.join(f.stateRoot,'account.lock')));
  await f.run(); assert.equal(f.calls.prs.length,1); assert.equal(f.calls.turns.length,2);
});

test('publication retry consumes no model turn or account preflight', async (t) => {
  const f = await fixture(t); f.faults.failPublish = true;
  assert.equal((await f.run()).status,'paused');
  assert.equal((await f.state()).phase,'publish');
  f.faults.failPublish = false; f.faults.quota = true; await f.resume();
  assert.equal((await f.state()).status,'ready'); assert.equal(f.calls.clients,1);
  assert.deepEqual(f.calls.turns,['plan','implement']);
});

test('recovers branch creation without repeating a completed plan', async (t) => {
  const f = await fixture(t); f.faults.branchCrash = true;
  assert.equal((await f.run()).status,'paused'); assert.equal((await f.state()).phase,'branch');
  await f.resume(); assert.equal((await f.state()).status,'ready');
  assert.deepEqual(f.calls.turns,['plan','implement']);
});

test('questions and quota exhaustion leave a readable continuation without implementation', async (t) => {
  for (const fault of ['questions','quota','turnPause']) {
    const f = await fixture(t); f.faults[fault] = true; await f.run();
    assert.notEqual((await f.state()).status,'ready');
    assert.ok(!f.calls.turns.includes('implement')); assert.equal(f.calls.prs.length,0);
    assert.match(await readFile(path.join(f.issueRoot,'CONTINUE.md'),'utf8'),/Follow-up prompt/);
  }
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

test('keeps the account lock when process termination cannot be confirmed', async (t) => {
  const f = await fixture(t); f.faults.turnPause = true; f.faults.shutdown = true;
  await assert.rejects(f.run(),/process group/);
  await access(path.join(f.stateRoot,'account.lock'));
  assert.match(await readFile(path.join(f.issueRoot,'CONTINUE.md'),'utf8'),/Continuation/);
});

test('verification retry does not repeat implementation after a manual repair', async (t) => {
  const f = await fixture(t); f.faults.validation = true;
  await f.run(); assert.equal((await f.state()).phase,'verify');
  const turns = f.calls.turns.length;
  f.faults.validation = false; await f.resume();
  assert.equal((await f.state()).status,'ready'); assert.equal(f.calls.turns.length,turns);
});

test('implementation questions return to planning while preserving the existing branch', async (t) => {
  const f = await fixture(t); f.faults.implementationQuestion = true;
  await f.run(); const first = await f.state();
  assert.equal(first.phase,'plan'); assert.equal(first.status,'needs_input');
  f.faults.implementationQuestion = false; await f.resume();
  assert.equal((await f.state()).status,'ready'); assert.equal((await f.state()).branch,first.branch);
  assert.deepEqual(f.calls.turns,['plan','implement','plan','implement']);
});

test('recovers a completed commit without spending quota or creating another commit', async (t) => {
  const f = await fixture(t); f.faults.commitCrash = true;
  await f.run(); assert.equal((await f.state()).phase,'commit');
  const first = (await exec('git',['-C',f.workspace,'rev-parse','HEAD'])).stdout;
  f.faults.quota = true; await f.resume();
  assert.equal((await f.state()).status,'ready'); assert.equal(f.calls.clients,1);
  assert.equal((await exec('git',['-C',f.workspace,'rev-parse','HEAD'])).stdout,first);
});

test('flushes a ready-state outbox even when the event is a duplicate', async (t) => {
  const f = await fixture(t); await f.run();
  const state = await f.state(); state.outbox = ['Recovered final audit entry.'];
  await writeFile(path.join(f.issueRoot,'state.json'),JSON.stringify(state));
  await f.run();
  assert.equal((await f.state()).outbox.length,0); assert.equal(f.calls.clients,1);
  assert.equal(f.calls.comments.at(-1),'Recovered final audit entry.');
});
