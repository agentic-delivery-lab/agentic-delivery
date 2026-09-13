import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  ISSUE_CONTROL_PLANE_QUERY,
  SET_ISSUE_FIELDS_MUTATION,
  issueFieldInput,
  readIssueControlPlane,
  setIssueFields,
  validateOrganizationIssueFields,
} from '../../scripts/lib/issue-field-api.mjs';
import { parseRepositoryYaml } from '../../scripts/lib/yaml.mjs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '../..');
const config = parseRepositoryYaml(await readFile(path.join(root, '.github/issue-metadata.yml'), 'utf8'), 'issue metadata');

function catalogFromConfig() {
  return ['lifecycle_stage', 'readiness'].map((key) => ({
    id: config.fields[key].id,
    name: config.fields[key].name,
    dataType: 'SINGLE_SELECT',
    options: config.fields[key].options.map(({ id, name }) => ({ id, name })),
  }));
}

test('the control-plane query reads native issue types, pinned field values, and lineage', () => {
  assert.match(ISSUE_CONTROL_PLANE_QUERY, /issueType/);
  assert.match(ISSUE_CONTROL_PLANE_QUERY, /issueFieldValues/);
  assert.match(ISSUE_CONTROL_PLANE_QUERY, /\.\.\. on Node \{ id \}/);
  assert.match(ISSUE_CONTROL_PLANE_QUERY, /\.\.\. on IssueFieldCommon \{ name dataType \}/);
  assert.match(ISSUE_CONTROL_PLANE_QUERY, /\.\.\. on IssueFieldSingleSelect \{ options \{ id name description \} \}/);
  assert.match(ISSUE_CONTROL_PLANE_QUERY, /parent/);
  assert.match(ISSUE_CONTROL_PLANE_QUERY, /subIssues/);
});

test('field inputs use approved field and option IDs', () => {
  assert.deepEqual(issueFieldInput({ config, field: 'lifecycle_stage', value: 'execution' }), {
    fieldId: 'lifecycle-stage', singleSelectOptionId: 'execution',
  });
  assert.throws(() => issueFieldInput({ config, field: 'lifecycle_stage', value: 'invented' }), /Unknown/);
});

test('GraphQL control-plane reads normalize the REST-compatible issue state', async () => {
  const controlPlane = await readIssueControlPlane({
    graphql: async () => ({
      repository: { issue: { id: 'I_1', number: 1, state: 'OPEN', issueType: null, issueFieldValues: { nodes: [] }, parent: null, subIssues: { nodes: [] } } },
      organization: { issueTypes: { nodes: [] }, issueFields: { nodes: [] } },
    }),
    repository: 'owner/repo',
    issueNumber: 1,
  });
  assert.equal(controlPlane.state, 'open');
});

test('organization field validation requires the configured fields and complete options', () => {
  assert.equal(validateOrganizationIssueFields({ config, organizationIssueFields: catalogFromConfig() }).valid, true);
  const invalid = catalogFromConfig().map((field) => ({ ...field, options: field.options.filter((option) => option.id !== 'planning') }));
  const result = validateOrganizationIssueFields({ config, organizationIssueFields: invalid });
  assert.equal(result.valid, false);
  assert.match(result.errors.join(' '), /missing option Planning/);
});

test('organization field validation catches an unbound live field ID', () => {
  const catalog = catalogFromConfig();
  catalog[0].id = 'IFSS_live_lifecycle';
  const result = validateOrganizationIssueFields({ config, organizationIssueFields: catalog });
  assert.equal(result.valid, false);
  assert.match(result.errors.join(' '), /runtime binding/);
});

test('organization field validation can require explicit runtime bindings', () => {
  const result = validateOrganizationIssueFields({ config, organizationIssueFields: catalogFromConfig(), requireRuntimeBindings: true });
  assert.equal(result.valid, false);
  assert.match(result.errors.join(' '), /runtime binding.*missing/);
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
