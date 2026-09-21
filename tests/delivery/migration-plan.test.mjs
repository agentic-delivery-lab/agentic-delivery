import assert from 'node:assert/strict';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import { MigrationPlanValidationError, validateMigrationPlan } from '../../scripts/validate-migration-plan.mjs';

const repositoryRoot = path.resolve(import.meta.dirname, '../..');

test('migration plan preserves the issue-safety gate and current release pin', async () => {
  const result = await validateMigrationPlan({ repositoryRoot });
  assert.deepEqual(result, {
    plan: 'tasks/agentic-delivery-repository-split-plan.md',
    sections: 28,
    controllerRelease: '0.2.0-draft.34',
    status: 'passed',
  });
});

test('migration plan validation rejects removal of the Issue #52 boundary', async (t) => {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), 'agentic-migration-plan-'));
  t.after(() => rm(temporaryRoot, { recursive: true, force: true }));
  await cp(path.join(repositoryRoot, 'tasks'), path.join(temporaryRoot, 'tasks'), { recursive: true });
  await cp(path.join(repositoryRoot, 'config'), path.join(temporaryRoot, 'config'), { recursive: true });
  const planPath = path.join(temporaryRoot, 'tasks/agentic-delivery-repository-split-plan.md');
  const plan = await readFile(planPath, 'utf8');
  await writeFile(planPath, plan.replace('Issue boundary: Issue #52 is the plan-persistence source issue.', 'Issue boundary removed.'), 'utf8');
  await assert.rejects(
    validateMigrationPlan({ repositoryRoot: temporaryRoot }),
    (error) => error instanceof MigrationPlanValidationError && /plan-persistence source issue/.test(error.message),
  );
});
