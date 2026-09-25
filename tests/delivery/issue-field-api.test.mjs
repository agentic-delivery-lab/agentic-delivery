import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  GITHUB_API_VERSION,
  ISSUE_CONTROL_PLANE_QUERY,
  SET_ISSUE_FIELDS_MUTATION,
  githubGraphqlApi,
  issueFieldInput,
  readIssueControlPlane,
  setIssueFields,
  validateOrganizationIssueFields,
} from '../../scripts/lib/issue-field-api.mjs';
import { parseRepositoryYaml } from '../../scripts/lib/yaml.mjs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '../..');
const config = parseRepositoryYaml(await readFile(path.join(root, 'config/issue-metadata.yml'), 'utf8'), 'issue metadata');

function catalogFromConfig() {
  return ['lifecycle_stage', 'readiness'].map((key) => ({
    id: config.fields[key].id,
    name: config.fields[key].name,
    dataType: 'SINGLE_SELECT',
    options: config.fields[key].options.map(({ id, name }) => ({ id, name })),
  }));
}

function issueTypesFromConfig() {
  return config.issue_types.map((type) => ({
    id: `IT_${type.id}`,
    name: type.native_name,
    isEnabled: true,
    pinnedFields: catalogFromConfig(),
  }));
}

function validateLiveCatalog(organizationIssueFields = catalogFromConfig(), overrides = {}) {
  return validateOrganizationIssueFields({
    config,
    organizationIssueFields,
    organizationIssueTypes: issueTypesFromConfig(),
    organizationPinnedIssueFields: catalogFromConfig(),
    ...overrides,
  });
}

test('the control-plane query reads field definitions, type pins, no-type pins, values, and lineage', () => {
  assert.match(ISSUE_CONTROL_PLANE_QUERY, /issueType/);
  assert.match(ISSUE_CONTROL_PLANE_QUERY, /issueFieldValues/);
  assert.match(ISSUE_CONTROL_PLANE_QUERY, /pinnedFields/);
  assert.match(ISSUE_CONTROL_PLANE_QUERY, /pinnedIssueFields/);
  assert.match(ISSUE_CONTROL_PLANE_QUERY, /\.\.\. on Node \{ id \}/);
  assert.match(ISSUE_CONTROL_PLANE_QUERY, /\.\.\. on IssueFieldCommon \{ name dataType visibility \}/);
  assert.match(ISSUE_CONTROL_PLANE_QUERY, /\.\.\. on IssueFieldSingleSelect \{ options \{ id name description \} \}/);
  assert.match(ISSUE_CONTROL_PLANE_QUERY, /parent/);
  assert.match(ISSUE_CONTROL_PLANE_QUERY, /subIssues/);
});

test('GraphQL control-plane requests pin the issue-field API schema version', async () => {
  let request;
  const graphql = githubGraphqlApi({
    token: 'test-token',
    fetchImpl: async (url, options) => {
      request = { url, options };
      return { ok: true, status: 200, json: async () => ({ data: {} }) };
    },
  });

  await graphql('query Test { viewer { login } }', { example: true });

  assert.equal(request.url, 'https://api.github.com/graphql');
  assert.equal(request.options.headers['X-GitHub-Api-Version'], '2026-03-10');
  assert.equal(request.options.headers['X-GitHub-Api-Version'], GITHUB_API_VERSION);
  assert.equal(request.options.headers.Authorization, 'Bearer test-token');
  assert.deepEqual(JSON.parse(request.options.body), {
    query: 'query Test { viewer { login } }',
    variables: { example: true },
  });
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
      organization: { issueTypes: { nodes: [] }, issueFields: { nodes: [] }, pinnedIssueFields: { nodes: [] } },
    }),
    repository: 'owner/repo',
    issueNumber: 1,
  });
  assert.equal(controlPlane.state, 'open');
  assert.deepEqual(controlPlane.organizationPinnedIssueFields, []);
});

test('organization field validation requires the configured fields and complete options', () => {
  assert.equal(validateLiveCatalog().valid, true);
  const invalid = catalogFromConfig().map((field) => ({ ...field, options: field.options.filter((option) => option.id !== 'planning') }));
  const result = validateLiveCatalog(invalid);
  assert.equal(result.valid, false);
  assert.match(result.errors.join(' '), /missing option Planning/);
});

test('organization field validation catches an unbound live field ID', () => {
  const catalog = catalogFromConfig();
  catalog[0].id = 'IFSS_live_lifecycle';
  const result = validateLiveCatalog(catalog);
  assert.equal(result.valid, false);
  assert.match(result.errors.join(' '), /runtime binding/);
});

test('organization field validation can require explicit runtime bindings', () => {
  const result = validateLiveCatalog(catalogFromConfig(), { requireRuntimeBindings: true });
  assert.equal(result.valid, false);
  assert.match(result.errors.join(' '), /runtime binding.*missing/);
});

test('organization field validation checks every enabled type and the no-type pin catalog', () => {
  const missingTypePin = issueTypesFromConfig();
  missingTypePin.find((type) => type.name === 'Task').pinnedFields = missingTypePin
    .find((type) => type.name === 'Task').pinnedFields.filter((field) => field.name !== 'Lifecycle Stage');
  const typeResult = validateLiveCatalog(catalogFromConfig(), { organizationIssueTypes: missingTypePin });
  assert.equal(typeResult.valid, false);
  assert.match(typeResult.errors.join(' '), /Lifecycle Stage is not pinned to enabled issue type Task/);

  const noTypeResult = validateLiveCatalog(catalogFromConfig(), {
    organizationPinnedIssueFields: catalogFromConfig().filter((field) => field.name !== 'Delivery Readiness'),
  });
  assert.equal(noTypeResult.valid, false);
  assert.match(noTypeResult.errors.join(' '), /Delivery Readiness is not pinned to issues without a type/);
});

test('organization field validation requires every configured native type to be present and enabled', () => {
  const missingType = issueTypesFromConfig().filter((type) => type.name !== 'Task');
  const missingResult = validateLiveCatalog(catalogFromConfig(), { organizationIssueTypes: missingType });
  assert.equal(missingResult.valid, false);
  assert.match(missingResult.errors.join(' '), /Configured organization issue type Task was not returned/);

  const disabledType = issueTypesFromConfig();
  disabledType.find((type) => type.name === 'Task').isEnabled = false;
  const disabledResult = validateLiveCatalog(catalogFromConfig(), { organizationIssueTypes: disabledType });
  assert.equal(disabledResult.valid, false);
  assert.match(disabledResult.errors.join(' '), /Configured organization issue type Task is not enabled/);
});

test('organization pin validation requires the configured field identity even when names match', () => {
  const issueTypes = issueTypesFromConfig();
  const task = issueTypes.find((type) => type.name === 'Task');
  task.pinnedFields = task.pinnedFields.map((field) => field.name === 'Lifecycle Stage'
    ? { ...field, id: 'different-field-id' }
    : field);

  const result = validateLiveCatalog(catalogFromConfig(), { organizationIssueTypes: issueTypes });
  assert.equal(result.valid, false);
  assert.match(result.errors.join(' '), /Lifecycle Stage is not pinned to enabled issue type Task/);
});

test('organization field validation fails closed when live pin catalogs are missing', () => {
  const result = validateOrganizationIssueFields({ config, organizationIssueFields: catalogFromConfig() });
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((error) => /issue-type catalog was not returned/.test(error)));
  assert.ok(result.errors.some((error) => /pin catalog for issues without a type was not returned/.test(error)));
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
