import assert from 'node:assert/strict';
import { test } from 'node:test';

import { collectGithubInventory, GithubInventoryError } from '../../scripts/collect-github-inventory.mjs';

function fakeRunner() {
  const calls = [];
  const run = async (args) => {
    calls.push(args);
    assert.equal(args[0], 'api');
    if (args[1] === 'graphql') {
      return { stdout: JSON.stringify({ data: { organization: { projectsV2: { nodes: [{ number: 4, title: 'Delivery', url: 'https://github.com/orgs/agentic-delivery-lab/projects/4', closed: false, fields: { nodes: [{ __typename: 'ProjectV2SingleSelectField', id: 'field-1', name: 'Lifecycle Stage', options: [{ id: 'intake', name: 'Intake' }] }] }, views: { nodes: [{ number: 1, name: 'Board', layout: 'BOARD' }] } }] } } } }), stderr: '' };
    }
    assert.equal(args[1], '--method');
    assert.equal(args[2], 'GET');
    const endpoint = args.at(-1);
    if (endpoint === 'orgs/agentic-delivery-lab/repos?type=all&per_page=100') {
      return { stdout: JSON.stringify([
        { id: 1, name: '.github', full_name: 'agentic-delivery-lab/.github', visibility: 'public', default_branch: 'main', private: false },
        { id: 2, name: 'agentic-delivery', full_name: 'agentic-delivery-lab/agentic-delivery', visibility: 'public', default_branch: 'main', private: false },
      ]), stderr: '' };
    }
    if (endpoint === 'repos/agentic-delivery-lab/.github') {
      return { stdout: JSON.stringify({ id: 2, name: '.github', full_name: 'agentic-delivery-lab/.github', visibility: 'public', default_branch: 'main', private: false }), stderr: '' };
    }
    if (endpoint === 'repos/agentic-delivery-lab/.github-private') throw new Error('HTTP 404: Not Found');
    if (endpoint === 'orgs/agentic-delivery-lab') return { stdout: JSON.stringify({ id: 99, login: 'agentic-delivery-lab', plan: { name: 'free', private_repos: 0, collaborators: 2 } }), stderr: '' };
    if (endpoint.includes('/issues?')) return { stdout: JSON.stringify([{ number: 52, body: 'See agentic-delivery-lab/agentic-delivery#52', pull_request: undefined }]), stderr: '' };
    if (endpoint.includes('/pulls?')) return { stdout: JSON.stringify([{ number: 8, body: 'Related to https://github.com/agentic-delivery-lab/.github/issues/4', head: { ref: 'docs/issue-52-plan' }, base: { ref: 'main' } }]), stderr: '' };
    if (endpoint.includes('/labels?')) return { stdout: JSON.stringify([{ name: 'adr:needed', color: '000000' }]), stderr: '' };
    if (endpoint.includes('/actions/workflows')) return { stdout: JSON.stringify({ workflows: [{ id: 7, name: 'quality', path: '.github/workflows/quality.yml', state: 'active' }] }), stderr: '' };
    if (endpoint.includes('/rulesets')) return { stdout: JSON.stringify([{ id: 3, name: 'main', enforcement: 'active' }]), stderr: '' };
    if (endpoint.includes('/orgs/agentic-delivery-lab/')) return { stdout: JSON.stringify({}), stderr: '' };
    throw new Error(`unexpected endpoint ${endpoint}`);
  };
  return { calls, run };
}

test('collects a redacted, read-only organization inventory without persisting issue bodies', async () => {
  const { calls, run } = fakeRunner();
  const report = await collectGithubInventory({ organization: 'agentic-delivery-lab', run, now: () => '2026-09-21T12:00:00.000Z' });
  assert.equal(report.schemaVersion, 1);
  assert.equal(report.evidenceClass, 'live-read-only');
  assert.equal(report.readOnly, true);
  assert.equal(report.organization.id, '99');
  assert.deepEqual(report.organization.plan, { name: 'free', privateRepositories: 0, collaborators: 2 });
  assert.deepEqual(report.repositories.map((repository) => repository.fullName), ['agentic-delivery-lab/.github', 'agentic-delivery-lab/agentic-delivery']);
  assert.deepEqual(report.specialSurfaces.map((surface) => ({ repository: surface.repository, status: surface.status })), [
    { repository: 'agentic-delivery-lab/.github', status: 'observed' },
    { repository: 'agentic-delivery-lab/.github-private', status: 'not-found-unverified' },
  ]);
  assert.match(report.specialSurfaces[1].evidence, /cannot distinguish absence from inaccessible private metadata/);
  assert.ok(report.warnings.some((warning) => warning.includes('special surfaces')));
  assert.equal(report.repositories[1].openIssues.items[0].number, 52);
  assert.equal(report.capabilities.projectsV2.items[0].fields[0].name, 'Lifecycle Stage');
  assert.equal(report.capabilities.projectsV2.items[0].views[0].layout, 'BOARD');
  assert.deepEqual(report.repositories[1].crossRepositoryReferences, ['agentic-delivery-lab/agentic-delivery#52', 'https://github.com/agentic-delivery-lab/.github/issues/4']);
  assert.equal(JSON.stringify(report).includes('See agentic-delivery'), false);
  assert.ok(calls.filter((args) => args[1] !== 'graphql').every((args) => args.includes('--method') && args.includes('GET')));
});

test('records capability permission gaps without treating them as absence', async () => {
  const { run } = fakeRunner();
  const wrapped = async (args) => {
    const endpoint = args.at(-1);
    if (endpoint === 'orgs/agentic-delivery-lab/copilot/billing') throw new Error('HTTP 403: Resource not accessible by integration');
    return run(args);
  };
  const report = await collectGithubInventory({ run: wrapped });
  assert.equal(report.capabilities.copilotBilling.status, 'unavailable');
  assert.ok(report.warnings.some((warning) => warning.includes('copilotBilling')));
});

test('records a private special-surface permission error as unavailable', async () => {
  const { run } = fakeRunner();
  const wrapped = async (args) => {
    if (args.at(-1) === 'repos/agentic-delivery-lab/.github-private') throw new Error('HTTP 403: Resource not accessible by integration');
    return run(args);
  };
  const report = await collectGithubInventory({ run: wrapped });
  const surface = report.specialSurfaces.find((item) => item.repository.endsWith('/.github-private'));
  assert.equal(surface.status, 'unavailable');
  assert.match(surface.evidence, /HTTP 403/);
  assert.ok(report.warnings.some((warning) => warning.includes('special surfaces')));
});

test('rejects invalid organization names before invoking gh', async () => {
  await assert.rejects(() => collectGithubInventory({ organization: 'org/with-slash', run: async () => { throw new Error('must not run'); } }), (error) => {
    assert.ok(error instanceof GithubInventoryError);
    assert.equal(error.exitCode, 2);
    return true;
  });
});
