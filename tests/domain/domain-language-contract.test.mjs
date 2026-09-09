import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';

import { parseRepositoryYaml } from '../../scripts/lib/yaml.mjs';

const repositoryRoot = path.resolve(import.meta.dirname, '../..');

async function text(relativePath) {
  return readFile(path.join(repositoryRoot, relativePath), 'utf8');
}

test('domain-language guidance and workflow contracts use the ESM validator', async () => {
  const agents = await text('AGENTS.md');
  for (const phrase of ['docs/domain/README.md', 'docs/domain/ubiquitous-language.yml', '$ubiquitous-language', 'domain-model change']) {
    assert.ok(agents.includes(phrase), `missing domain guidance: ${phrase}`);
  }
  const guide = await text('docs/domain/README.md');
  for (const phrase of ['canonical register', 'same change set', 'not a repository-wide forbidden-word rule', 'semantic consistency']) {
    assert.ok(guide.includes(phrase), `missing domain guide phrase: ${phrase}`);
  }
  const skill = await text('.agents/skills/ubiquitous-language/SKILL.md');
  for (const phrase of ['docs/domain/README.md', 'docs/domain/ubiquitous-language.yml', 'same change set', 'exact external', 'structural checks cannot prove']) {
    assert.ok(skill.includes(phrase), `missing domain skill phrase: ${phrase}`);
  }
  const config = await text('.agents/skills/ubiquitous-language/agents/openai.yaml');
  for (const phrase of ['Use $ubiquitous-language', 'allow_implicit_invocation: true']) assert.ok(config.includes(phrase));

  const issueTemplate = parseRepositoryYaml(await text('.github/ISSUE_TEMPLATE/architecture-decision.yml'), 'issue template');
  const field = issueTemplate.body.find((item) => item.id === 'domain_language');
  assert.ok(field);
  assert.equal(field.validations.required, true);
  const fieldText = `${field.attributes.description} ${field.attributes.placeholder}`;
  assert.ok(fieldText.includes('None'));

  const workflow = await text('.github/workflows/adr-quality.yml');
  for (const phrase of ['docs/domain/**', '.agents/skills/**', 'scripts/validate-domain-language.mjs', 'node scripts/validate-domain-language.mjs', 'tests/domain/*.test.mjs']) {
    assert.ok(workflow.includes(phrase), `missing workflow domain path: ${phrase}`);
  }
});

test('issue intake artifacts use the registered delivery-governance terms', async () => {
  const register = await text('docs/domain/ubiquitous-language.yml');
  for (const term of ['work type', 'lifecycle state', 'governance metadata', 'classification', 'lifecycle routing', 'readiness gate']) {
    assert.ok(register.includes(`term: "${term}"`), `missing registered intake term: ${term}`);
  }
  const guide = await text('docs/delivery/README.md');
  for (const phrase of ['work type', 'lifecycle state', 'governance metadata', 'readiness gate', 'state:investigating', 'state:parked']) {
    assert.ok(guide.includes(phrase), `missing intake term in delivery guide: ${phrase}`);
  }
});
