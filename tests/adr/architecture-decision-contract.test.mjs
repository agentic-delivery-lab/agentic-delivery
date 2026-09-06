import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';

const repositoryRoot = path.resolve(import.meta.dirname, '../..');
const skillPath = path.join(repositoryRoot, '.agents/skills/architecture-decision/SKILL.md');

test('architecture-decision skill keeps the guarded issue intake contract', async () => {
  const skill = await readFile(skillPath, 'utf8');
  for (const phrase of [
    '## Source issue intake',
    'read-only search',
    'gh issue list',
    'Present any likely candidate for confirmation before using it.',
    'If the search fails because of missing tooling, authentication or connectivity',
    'Do not treat a failed search as no match',
    'preview',
    'explicit confirmation',
    'gh issue create',
    'Re-run the read-only search immediately before creation',
    'check that the available user context can fill the required issue-form fields',
    'do not create a partial issue',
    'If a new candidate appears, return to candidate confirmation.',
    'inaccessible',
    'Do not create a replacement issue',
    'duplicate',
    'issue form',
    'source-issue',
    'questions as comments on the source issue',
    'only when issue communication is explicitly authorized',
    'Otherwise show the questions for confirmation before posting.',
    'stop until the answers are available',
    'If the user declines to answer or to create/comment, do not continue to the ADR.',
    'secrets',
    'Do not guess the repository',
    'not automatically an ADR',
    'ADR tracking issue',
    'sub-issue',
    'feature branch',
    'never create a pull request from `main`',
    'is only the protected base',
    'canonical context',
    'without a status field',
    'remove',
    'update the source issue',
    'Closes #',
    'Approval alone does not close',
    'broader source issue',
  ]) {
    assert.ok(skill.includes(phrase), `expected architecture-decision skill to contain: ${phrase}`);
  }
  for (const obsolete of ['status: proposed', 'workflow_run', 'acceptance helper', 'stop and ask for the missing information']) {
    assert.ok(!skill.includes(obsolete), `architecture-decision skill must not contain: ${obsolete}`);
  }
});
