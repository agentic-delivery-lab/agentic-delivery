import assert from 'node:assert/strict';
import path from 'node:path';
import { test } from 'node:test';

import { validateGitmojiMessage } from '../../scripts/validate-gitmoji.mjs';

test('accepts valid Conventional Commit Gitmoji messages and merges', () => {
  for (const message of [
    'feat: ✨ add context-aware delivery checks',
    'fix(parser)!: :bug: repair commit parsing',
    'docs: 📝 update the guide\n\nExplain the migration path.',
    'Merge pull request #6 from example/feature',
    "Merge branch 'feature' into main",
  ]) assert.equal(validateGitmojiMessage(message), true);
});

test('rejects malformed Gitmoji messages with exit code 1', () => {
  for (const message of [
    'feat: add a description without a gitmoji',
    '✨ feat: add an emoji before the conventional prefix',
    'feat: :not-an-official-gitmoji: add a description',
    'feat: ✨add a description without a separator',
    'feat: :sparkles: ',
    'Add a description without a conventional prefix',
  ]) assert.throws(() => validateGitmojiMessage(message), (error) => error.exitCode === 1);
});
