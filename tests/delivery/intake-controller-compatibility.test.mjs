import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import vm from 'node:vm';

import { resolveIntakePolicy } from '../../scripts/lib/intake-policy.mjs';
import { parseRepositoryYaml } from '../../scripts/lib/yaml.mjs';

const root = path.resolve(import.meta.dirname, '../..');
const workflow = parseRepositoryYaml(await readFile(path.join(root, '.github/workflows/issue-intake.yml'), 'utf8'));
const steps = workflow.jobs.classify.steps;
const adapter = steps.find((step) => step.id === 'intake-compatibility');
// Execute the permission decision from the actual enrolled legacy source,
// rather than a second implementation of its mode handling.
const legacy = execFileSync('git', ['show', '7d38227f7f8d8377ed7cd1b883d90b71b69bfc9b:scripts/issue-intake.mjs'], { cwd: root, encoding: 'utf8' });
const statement = legacy.match(/const shadowMode = [^;]+;/)?.[0];
const permissions = legacy.match(/permissions: (\{ contents: 'read', issues: shadowMode \? 'read' : 'write', pull_requests: 'read', metadata: 'read' \}),/)?.[1];
assert.ok(statement && permissions, 'the immutable legacy permission decision must be available');

test('direct and invoked intake both have the exact trusted compatibility source', () => {
  const checkout = steps.find((step) => step.with?.path === 'dispatch-boundary');
  assert.ok(checkout);
  assert.equal(checkout.if, undefined, 'direct/manual intake also requires the adapter source');
  assert.equal(checkout.with.ref, '${{ github.sha }}');
  assert.equal(checkout.with['persist-credentials'], false);
  assert.ok(steps.indexOf(checkout) < steps.indexOf(adapter));
});

async function translatedMode(value) {
  if (!adapter) return undefined; // Reproduce the original missing caller edge.
  assert.equal(adapter['working-directory'], 'dispatch-boundary');
  assert.equal(adapter.env.READ_ONLY_RUN, '${{ steps.intake-policy.outputs.read_only_run }}');
  const command = adapter.run.match(/^node (scripts\/lib\/[a-z-]+\.mjs)$/);
  assert.ok(command, 'compatibility runs a trusted, dependency-free Node entry point');
  const directory = await mkdtemp(path.join(tmpdir(), 'intake-compatibility-test-'));
  const output = path.join(directory, 'output');
  try {
    await writeFile(output, '');
    execFileSync(process.execPath, [command[1]], {
      cwd: root,
      env: { ...process.env, READ_ONLY_RUN: value, GITHUB_OUTPUT: output },
      stdio: 'pipe',
    });
    const result = await readFile(output, 'utf8');
    assert.match(result, /^control_plane_mode=(shadow|active)\n$/);
    return result.trim().split('=')[1];
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

for (const [name, input, expected] of [
  ['direct shadow', { eventName: 'issues', registryParticipantMode: 'shadow' }, 'read'],
  ['invoked shadow', { eventName: 'repository_dispatch', agentInvocation: true, invocationParticipantMode: 'shadow' }, 'read'],
  ['forced read-only active', { eventName: 'workflow_dispatch', registryParticipantMode: 'active', forceReadOnly: true }, 'read'],
  ['ordinary active', { eventName: 'issues', registryParticipantMode: 'active' }, 'write'],
]) {
  test(`legacy token permission respects validated ${name} policy`, async () => {
    const policy = resolveIntakePolicy(input);
    const mode = await translatedMode(String(policy.readOnlyRun));
    const routing = steps.find((step) => step.id === 'intake');
    if (mode !== undefined) {
      assert.equal(routing.env.CONTROL_PLANE_MODE, '${{ steps.intake-compatibility.outputs.control_plane_mode }}');
    }
    const observed = vm.runInNewContext(`${statement}\n(${permissions})`, {
      env: { PARTICIPANT_MODE: policy.participantMode, READ_ONLY_RUN: String(policy.readOnlyRun), CONTROL_PLANE_MODE: mode },
    });
    assert.equal(observed.issues, expected);
    assert.equal(policy.participantMode, input.invocationParticipantMode ?? input.registryParticipantMode);
  });
}

test('malformed read-only output cannot emit a legacy mode', async () => {
  assert.ok(adapter);
  for (const value of [undefined, '', 'TRUE', 'yes', '0', 'false\ncontrol_plane_mode=active']) {
    await assert.rejects(translatedMode(value), /must be true or false/);
  }
  const checkout = steps.find((step) => step.name === 'Check out the validated controller release');
  assert.ok(steps.indexOf(adapter) < steps.indexOf(checkout));
  assert.deepEqual(Object.keys(adapter.env), ['READ_ONLY_RUN']);
});
