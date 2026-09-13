import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  ISSUE_CONTROL_PLANE_QUERY,
  SET_ISSUE_FIELDS_MUTATION,
  issueFieldInput,
  setIssueFields,
} from '../../scripts/lib/issue-field-api.mjs';
import { parseRepositoryYaml } from '../../scripts/lib/yaml.mjs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '../..');
const config = parseRepositoryYaml(await readFile(path.join(root, '.github/issue-metadata.yml'), 'utf8'), 'issue metadata');

test('the control-plane query reads native issue types, pinned field values, and lineage', () => {
  assert.match(ISSUE_CONTROL_PLANE_QUERY, /issueType/);
  assert.match(ISSUE_CONTROL_PLANE_QUERY, /issueFieldValues/);
  assert.match(ISSUE_CONTROL_PLANE_QUERY, /parent/);
  assert.match(ISSUE_CONTROL_PLANE_QUERY, /subIssues/);
});

test('field inputs use approved field and option IDs', () => {
  assert.deepEqual(issueFieldInput({ config, field: 'lifecycle_stage', value: 'execution' }), {
    fieldId: 'lifecycle-stage', singleSelectOptionId: 'execution',
  });
  assert.throws(() => issueFieldInput({ config, field: 'lifecycle_stage', value: 'invented' }), /Unknown/);
});

test('field writes are controller-only and closed around the approved mutation', async () => {
  let request;
  const graphql = async (query, variables) => { request = { query, variables }; return { ok: true }; };
  await setIssueFields({ graphql, issueId: 'I_1', config, values: { lifecycle_stage: 'validation' }, actor: 'controller' });
  assert.match(request.query, /setIssueFieldValue/);
  assert.deepEqual(request.variables.input, { issueId: 'I_1', issueFields: [{ fieldId: 'lifecycle-stage', singleSelectOptionId: 'validation' }] });
  await assert.rejects(() => setIssueFields({ graphql, issueId: 'I_1', config, values: { lifecycle_stage: 'validation' }, actor: 'model' }), /controller/);
  assert.match(SET_ISSUE_FIELDS_MUTATION, /setIssueFieldValue/);
});
