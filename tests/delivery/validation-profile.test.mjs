import assert from 'node:assert/strict';
import { test } from 'node:test';
import path from 'node:path';
import { resolveValidationProfile } from '../../scripts/lib/validation-profile.mjs';
const origin = { repositoryId: '1368850419', repository: 'agentic-delivery-lab/.github', controllerCommit: 'a'.repeat(40) };
test('public adapter profile has no pnpm installation or factory metadata checks', () => {
  const profile = resolveValidationProfile(origin);
  assert.deepEqual(profile.install, []);
  assert.equal(profile.id, 'public-adapter');
  assert.match(profile.contentSha256, /^[a-f0-9]{64}$/);
  assert.equal(profile.controllerCommit, origin.controllerCommit);
  assert.ok(!JSON.stringify(profile.commands).includes('validate-config-files'));
});
test('unknown repository or renamed identity cannot select a validation profile', () => {
  for (const mutation of [{ repositoryId: '999' }, { repository: 'attacker/.github' }, { controllerCommit: 'main' }]) {
    assert.throws(() => resolveValidationProfile({ ...origin, ...mutation }), /validation profile/i);
  }
});
test('each factory surface has an identity-bound profile with bounded commands', () => {
  for (const [repositoryId, name, id] of [
    ['1358455028','agentic-delivery','control-plane'],
    ['1380894616','agentic-delivery-architecture','architecture'],
    ['1416207421','agentic-delivery-requirements','requirements'],
    ['1380894656','agentic-delivery-agent-customizations','agent-customizations'],
    ['1380894705','agentic-delivery-distribution','distribution'],
    ['1380894756','.github-private','private-adapter'],
  ]) {
    const profile = resolveValidationProfile({ ...origin, repositoryId, repository: `agentic-delivery-lab/${name}` });
    assert.equal(profile.id, id);
    assert.ok(profile.commands.length);
    for (const command of profile.commands) {
      assert.ok(Array.isArray(command.argv));
      assert.ok(command.timeoutMs > 0 && command.timeoutMs <= 600_000);
      assert.ok(['delivery-verify','delivery-deps'].includes(command.sandbox));
      assert.ok(!command.argv.includes('sh') && !command.argv.includes('-c'));
    }
  }
});
test('Issue-provided command data cannot alter the selected profile', () => {
  assert.deepEqual(resolveValidationProfile({ ...origin, commands: [['sh','-c','untrusted']] }), resolveValidationProfile(origin));
  const profile = resolveValidationProfile(origin);
  assert.throws(() => profile.commands.push({ argv: ['sh'] }));
});

test('validation command paths come only from trusted controller inputs', async () => {
  const { materializeValidationCommand } = await import('../../scripts/lib/validation-profile.mjs');
  const privateProfile = resolveValidationProfile({ ...origin, repositoryId:'1380894756', repository:'agentic-delivery-lab/.github-private' });
  const workspace = path.resolve('fixture-workspace');
  const controllerRoot = path.resolve('fixture-controller');
  assert.throws(() => materializeValidationCommand(privateProfile.commands[0], {workspace,controllerRoot}), /trusted absolute/);
  assert.throws(() => materializeValidationCommand({argv:['node','@issue/script']}, {workspace,controllerRoot}), /trusted absolute/);
  assert.deepEqual(materializeValidationCommand({argv:['node','@controller/scripts/check.mjs','@workspace']}, {workspace,controllerRoot}), ['node',path.join(controllerRoot,'scripts/check.mjs'),workspace]);
});
