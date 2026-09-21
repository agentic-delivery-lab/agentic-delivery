import assert from 'node:assert/strict';
import { test } from 'node:test';

import { validateMultiRepositoryAcceptance } from '../../scripts/validate-multi-repository-acceptance.mjs';

test('offline organization acceptance matrix keeps two repositories on one controller', async () => {
  const report = await validateMultiRepositoryAcceptance();
  assert.equal(report.status, 'passed');
  assert.equal(report.evidenceClass, 'offline-fixture');
  assert.equal(report.liveGitHubVerification, 'not-run');
  assert.equal(report.participants.length, 2);
  assert.equal(new Set(report.participants.map((participant) => participant.repositoryId)).size, 2);
  assert.equal(new Set(report.participants.map((participant) => participant.stateNamespace)).size, 2);
  assert.equal(report.checks.sharedController, 'passed');
  assert.equal(report.checks.repositoryIdentity, 'passed');
  assert.equal(report.checks.controllerUpgrade, 'passed');
  assert.equal(report.checks.controllerRollback, 'passed');
  assert.equal(report.checks.centralCredentialBoundary, 'passed');
});
