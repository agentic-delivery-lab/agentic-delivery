import assert from 'node:assert/strict';
import path from 'node:path';
import { test } from 'node:test';

import {
  DEPENDABOT_LOGIN,
  validatePullRequestBody,
} from '../../scripts/validate-pull-request-body.mjs';
import { runNodeScript } from '../helpers/process.mjs';

const repositoryRoot = path.resolve(import.meta.dirname, '../..');
const validatorPath = path.join(repositoryRoot, 'scripts/validate-pull-request-body.mjs');

function completeBody() {
  return `## Summary

Improve pull request governance with a deterministic description check.

## Source and plan

- Source issue: Closes #44
- Implementation plan: Issue #44, implementation plan
- Plan deviations: None

## Changes

- Add the pull request body validator.

## Verification

- Unit tests passed.

## Evidence

Not applicable because this change has no visual output.

## Risk and delivery

- Risk level and impact: Low; invalid descriptions cannot merge after enforcement is enabled.
- Security and privacy: No secrets or write permissions are used.
- Breaking changes and compatibility: No runtime compatibility change.
- Deployment or migration: Merge the organization template first.
- Rollback: Revert the workflow and ruleset requirement.
- Dependencies and follow-up work: GitHub Team or a public repository is required for live ruleset enforcement.

## Review guidance

- Review focus: Validator behavior and workflow trust boundary.
- Suggested review order: Validator, tests, then workflow.
- Out of scope: Automatic merging.

## Author checklist

- [x] I reviewed my own diff.
- [x] I recorded verification evidence.
`;
}

test('accepts a complete organization-template pull request body', () => {
  const result = validatePullRequestBody({ body: completeBody(), author: 'octocat' });

  assert.equal(result.valid, true, result.errors.join('\n'));
  assert.equal(result.exempt, false);
});

test('rejects missing sections, unanswered fields, and unchecked items', () => {
  const body = completeBody()
    .replace('## Summary', '## Overview')
    .replace('- Plan deviations: None', '- Plan deviations: <!-- answer -->')
    .replace('- [x] I reviewed my own diff.', '- [ ] I reviewed my own diff.');
  const result = validatePullRequestBody({ body, author: 'octocat' });

  assert.equal(result.valid, false);
  assert.ok(result.errors.includes('Missing required section: ## Summary'));
  assert.ok(result.errors.includes('Required field has no answer: Source and plan > Plan deviations'));
  assert.ok(result.errors.includes('Author checklist contains unchecked items.'));
});

test('accepts only the explicit Dependabot author without a body', () => {
  const dependabot = validatePullRequestBody({ body: '', author: DEPENDABOT_LOGIN });
  const anotherBot = validatePullRequestBody({ body: '', author: 'release-bot[bot]' });

  assert.equal(dependabot.valid, true);
  assert.equal(dependabot.exempt, true);
  assert.equal(anotherBot.valid, false);
  assert.equal(anotherBot.exempt, false);
});

test('command reports validation and explicit Dependabot exemption', async () => {
  const valid = await runNodeScript(validatorPath, [], {
    cwd: repositoryRoot,
    env: { ...process.env, PR_AUTHOR: 'octocat', PR_BODY: completeBody() },
  });
  assert.equal(valid.status, 0, valid.stderr);
  assert.match(valid.stdout, /satisfies the organization template contract/);

  const exempt = await runNodeScript(validatorPath, [], {
    cwd: repositoryRoot,
    env: { ...process.env, PR_AUTHOR: DEPENDABOT_LOGIN, PR_BODY: '' },
  });
  assert.equal(exempt.status, 0, exempt.stderr);
  assert.match(exempt.stdout, /explicitly exempt/);
});

test('command returns usage and validation exit codes', async () => {
  const usage = await runNodeScript(validatorPath, [], {
    cwd: repositoryRoot,
    env: { ...process.env, PR_AUTHOR: '', PR_BODY: '' },
  });
  assert.equal(usage.status, 2);

  const invalid = await runNodeScript(validatorPath, [], {
    cwd: repositoryRoot,
    env: { ...process.env, PR_AUTHOR: 'octocat', PR_BODY: '' },
  });
  assert.equal(invalid.status, 1);
  assert.match(invalid.stderr, /Use the organization pull request template/);
});
