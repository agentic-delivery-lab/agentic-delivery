import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';

const repositoryRoot = path.resolve(import.meta.dirname, '../..');

test('plain-language communication guidance remains explicit', async () => {
  const skill = await readFile(path.join(repositoryRoot, '.agents/skills/plain-language-communication/SKILL.md'), 'utf8');
  const agents = await readFile(path.join(repositoryRoot, 'AGENTS.md'), 'utf8');
  const config = await readFile(path.join(repositoryRoot, '.agents/skills/plain-language-communication/agents/openai.yaml'), 'utf8');
  for (const phrase of [
    "Follow the user's language", 'Dutch when the language is mixed or unclear', 'plain English',
    'relevant', 'findable', 'understandable', 'usable', 'user, task and context', 'feedback',
    'technical terms', 'Do not claim ISO certification', 'plain-language-communication',
  ]) assert.ok(skill.includes(phrase), `missing plain-language guidance: ${phrase}`);
  for (const phrase of ['plain-language-communication', 'Follow the user', 'plain English']) {
    assert.ok(agents.includes(phrase), `missing AGENTS communication guidance: ${phrase}`);
  }
  for (const phrase of ['plain-language-communication', 'allow_implicit_invocation: true', 'Use $plain-language-communication']) {
    assert.ok(config.includes(phrase), `missing skill configuration: ${phrase}`);
  }
  assert.ok(!agents.includes('ISO certification'));
});
