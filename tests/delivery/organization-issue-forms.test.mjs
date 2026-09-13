import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  EXPECTED_ORGANIZATION_ISSUE_FORMS,
  ORGANIZATION_ISSUE_TEMPLATE_BASE_URL,
  OrganizationIssueFormsError,
  fetchOrganizationIssueForms,
} from '../helpers/organization-issue-forms.mjs';

function response(source, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async text() {
      return source;
    },
  };
}

function fixtureSources() {
  return {
    ...Object.fromEntries(Object.entries(EXPECTED_ORGANIZATION_ISSUE_FORMS).map(([fileName, type]) => [
      fileName,
      `name: ${type}\ndescription: A test form.\ntype: ${type}\nbody:\n  - type: markdown\n    attributes:\n      value: Test form.\n`,
    ])),
    'config.yml': 'blank_issues_enabled: true\n',
  };
}

function fixtureFetch(sources, statusOverrides = {}) {
  return async (url) => {
    const fileName = new URL(url).pathname.split('/').at(-1);
    if (!(fileName in sources)) return response('', statusOverrides[fileName] ?? 404);
    return response(sources[fileName], statusOverrides[fileName] ?? 200);
  };
}

test('fetches and validates the published organization issue forms', async () => {
  const result = await fetchOrganizationIssueForms();

  assert.equal(result.baseUrl, ORGANIZATION_ISSUE_TEMPLATE_BASE_URL);
  assert.deepEqual(Object.keys(result.forms).sort(), Object.keys(EXPECTED_ORGANIZATION_ISSUE_FORMS).sort());
  for (const [fileName, expectedType] of Object.entries(EXPECTED_ORGANIZATION_ISSUE_FORMS)) {
    assert.equal(result.forms[fileName].type, expectedType);
    assert.ok(Array.isArray(result.forms[fileName].body));
    assert.ok(result.forms[fileName].body.length > 0);
  }
  assert.equal(result.config.blank_issues_enabled, true);
});

test('fails closed when the organization source is unreachable', async () => {
  await assert.rejects(
    fetchOrganizationIssueForms({
      baseUrl: 'https://organization-forms.invalid/ISSUE_TEMPLATE/',
      fetchImpl: async () => { throw new Error('network unavailable'); },
    }),
    (error) => error instanceof OrganizationIssueFormsError && /unable to fetch/.test(error.message),
  );
});

test('fails closed when a required form is missing or malformed', async () => {
  const missingSources = fixtureSources();
  delete missingSources['task.yml'];
  await assert.rejects(
    fetchOrganizationIssueForms({ fetchImpl: fixtureFetch(missingSources) }),
    (error) => error instanceof OrganizationIssueFormsError && /task\.yml/.test(error.message),
  );

  const malformedSources = fixtureSources();
  malformedSources['bug.yml'] = 'type: [not valid';
  await assert.rejects(
    fetchOrganizationIssueForms({ fetchImpl: fixtureFetch(malformedSources) }),
    (error) => error instanceof OrganizationIssueFormsError && /bug\.yml/.test(error.message),
  );
});

test('fails closed when a native type, body, or blank-issue setting is invalid', async () => {
  const wrongTypeSources = fixtureSources();
  wrongTypeSources['feature.yml'] = wrongTypeSources['feature.yml'].replace('type: Feature', 'type: Bug');
  await assert.rejects(
    fetchOrganizationIssueForms({ fetchImpl: fixtureFetch(wrongTypeSources) }),
    (error) => error instanceof OrganizationIssueFormsError && /feature\.yml.*native Issue Type/.test(error.message),
  );

  const missingBodySources = fixtureSources();
  missingBodySources['task.yml'] = 'name: Task\ndescription: A test form.\ntype: Task\n';
  await assert.rejects(
    fetchOrganizationIssueForms({ fetchImpl: fixtureFetch(missingBodySources) }),
    (error) => error instanceof OrganizationIssueFormsError && /task\.yml.*body/.test(error.message),
  );

  const disabledBlankIssuesSources = fixtureSources();
  disabledBlankIssuesSources['config.yml'] = 'blank_issues_enabled: false\n';
  await assert.rejects(
    fetchOrganizationIssueForms({ fetchImpl: fixtureFetch(disabledBlankIssuesSources) }),
    (error) => error instanceof OrganizationIssueFormsError && /blank_issues_enabled/.test(error.message),
  );
});
