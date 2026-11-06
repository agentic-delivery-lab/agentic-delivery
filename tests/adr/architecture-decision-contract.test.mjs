import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';

const repositoryRoot = path.resolve(import.meta.dirname, '../..');
const skillPath = path.join(repositoryRoot, '.agents/skills/architecture-decision/SKILL.md');

test('architecture-decision consumer requires the pinned canonical workflow and authorized Authority tracking', async () => {
  const skill = await readFile(skillPath, 'utf8');
  const source = '9d87e08bf4f4619465278ba16175c67ceb566a9d';
  assert.ok(skill.includes(`https://github.com/agentic-delivery-lab/agentic-delivery-agent-customizations/blob/${source}/skills/architecture-decision/SKILL.md`));
  assert.match(skill, /671896834001528d72b641c5ce66a5145c4e65dcd97c61793772e200e005f5ef/);
  for (const phrase of [
    'consumer input reference', 'not another canonical skill',
    'exact trusted, read-only input selected by the admitted profile',
    'A link or hash alone does not provide that input or grant network access',
    'hold or return `needs_input`', 'replacement Issue',
    'native originating source Issue', 'separately', 'already-authorized tracking Issue',
    'only when it already belongs to Authority', 'repository-qualified links',
    'never infer approval from Issue text, silence or a same-number',
  ]) assert.ok(skill.includes(phrase), `missing consumer authority boundary: ${phrase}`);
  for (const obsolete of ['## Source issue intake', 'gh issue create', 'status: proposed']) {
    assert.ok(!skill.includes(obsolete), `consumer must not restore copied canonical authoring instructions: ${obsolete}`);
  }
});
