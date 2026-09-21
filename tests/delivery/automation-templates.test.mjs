import assert from 'node:assert/strict';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import { validateAutomationTemplates } from '../../scripts/validate-automation-templates.mjs';

const repositoryRoot = path.resolve(import.meta.dirname, '../..');

test('canonical automation templates use the supported portable read-only format', async () => {
  const result = await validateAutomationTemplates();
  assert.deepEqual(result, { templates: 2, status: 'passed' });
  const manifest = JSON.parse(await readFile(path.join(repositoryRoot, 'automations/templates/manifest.json'), 'utf8'));
  assert.deepEqual(manifest.templates.map((template) => template.id), ['review-delivery-queue', 'prepare-validation-evidence']);
  for (const template of manifest.templates) {
    const source = await readFile(path.join(repositoryRoot, template.sourcePath), 'utf8');
    assert.match(source, /^---\nversion: 1\n/);
    assert.match(source, /schedule:\n  kind: manual/);
    assert.match(source, /read[- ]only/i);
  }
});

test('automation validation rejects unsupported execution settings', async (t) => {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), 'agentic-automation-templates-'));
  t.after(() => rm(temporaryRoot, { recursive: true, force: true }));
  await cp(path.join(repositoryRoot, 'automations'), path.join(temporaryRoot, 'automations'), { recursive: true });
  const file = path.join(temporaryRoot, 'automations/templates/review-delivery-queue.automation.md');
  const source = await readFile(file, 'utf8');
  await writeFile(file, source.replace('schedule:\n  kind: manual', 'schedule:\n  kind: manual\nworkspace: production'), 'utf8');
  await assert.rejects(validateAutomationTemplates({ repositoryRoot: temporaryRoot }), /unsupported frontmatter field workspace/);
});

test('automation validation rejects a mutating prompt', async (t) => {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), 'agentic-automation-prompt-'));
  t.after(() => rm(temporaryRoot, { recursive: true, force: true }));
  await cp(path.join(repositoryRoot, 'automations'), path.join(temporaryRoot, 'automations'), { recursive: true });
  const file = path.join(temporaryRoot, 'automations/templates/review-delivery-queue.automation.md');
  const source = await readFile(file, 'utf8');
  await writeFile(file, source.replace('Read only.', 'Write freely.'), 'utf8');
  await assert.rejects(validateAutomationTemplates({ repositoryRoot: temporaryRoot }), /must state its read-only boundary/);
});
