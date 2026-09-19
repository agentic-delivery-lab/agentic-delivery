// agentic-primitive: {"id":"issue-field-controller-boundary","kind":"script","enforcement":"deterministic","adrs":["ADR-0012","ADR-0015"],"domains":["agentic-delivery-governance"]}

const GRAPHQL_ENDPOINT = 'https://api.github.com/graphql';
// GitHub's newer issue-type and issue-field schema is only exposed through
// the API version used by the organization metadata control plane. Keep the
// version explicit so a default or older runner image cannot silently fall
// back to a schema that omits those fields.
export const GITHUB_API_VERSION = '2026-03-10';

export const ISSUE_CONTROL_PLANE_QUERY = `
query IssueControlPlane($owner: String!, $name: String!, $number: Int!, $organization: String!) {
  repository(owner: $owner, name: $name) {
    issue(number: $number) {
      id
      number
      state
      title
      body
      issueType { id name }
      issueFieldValues(first: 100) {
        nodes {
          ... on IssueFieldSingleSelectValue {
            id
            name
            value
            optionId
            field {
              ... on Node { id }
              ... on IssueFieldCommon { name dataType }
            }
          }
        }
      }
      parent { id number }
      subIssues(first: 100) { nodes { id number state } }
    }
  }
  organization(login: $organization) {
    issueTypes(first: 100) { nodes { id name isEnabled } }
    issueFields(first: 100) {
      nodes {
        ... on Node { id }
        ... on IssueFieldCommon { name dataType }
        ... on IssueFieldSingleSelect { options { id name description } }
      }
    }
  }
}`;

export const SET_ISSUE_FIELDS_MUTATION = `
mutation SetIssueFields($input: SetIssueFieldValueInput!) {
  setIssueFieldValue(input: $input) {
    issue {
      id
      issueFieldValues(first: 100) {
        nodes {
          ... on IssueFieldSingleSelectValue {
            id
            name
            value
            optionId
            field {
              ... on Node { id }
              ... on IssueFieldCommon { name dataType }
            }
          }
        }
      }
    }
  }
}`;

export const UPDATE_ISSUE_TYPE_MUTATION = `
mutation UpdateIssueType($input: UpdateIssueIssueTypeInput!) {
  updateIssueIssueType(input: $input) {
    issue { id issueType { id name } }
  }
}`;

function splitRepository(repository) {
  const match = /^([^/]+)\/([^/]+)$/.exec(String(repository ?? ''));
  if (!match) throw new Error('Repository must use the owner/name form.');
  return { owner: match[1], name: match[2] };
}

function issueNumber(value) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 1) throw new Error('Issue number must be a positive integer.');
  return number;
}

function apiError(message, errors = []) {
  const error = new Error(`${message}${errors.length ? ` ${errors.map((item) => item.message ?? item).join('; ')}` : ''}`);
  error.graphqlErrors = errors;
  return error;
}

export function githubGraphqlApi({ token, fetchImpl = fetch } = {}) {
  return async (query, variables) => {
    const response = await fetchImpl(GRAPHQL_ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': GITHUB_API_VERSION,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query, variables }),
      signal: AbortSignal.timeout(30_000),
    });
    let payload;
    try { payload = await response.json(); } catch { payload = null; }
    if (!response.ok) throw apiError(`GitHub GraphQL request failed (${response.status}).`, payload?.errors ?? []);
    if (payload?.errors?.length) throw apiError('GitHub GraphQL request returned errors.', payload.errors);
    return payload?.data;
  };
}

export async function readIssueControlPlane({ graphql, repository, issueNumber: number, organization = repository?.split('/')?.[0] } = {}) {
  if (typeof graphql !== 'function') throw new Error('A GraphQL client is required.');
  const { owner, name } = splitRepository(repository);
  const data = await graphql(ISSUE_CONTROL_PLANE_QUERY, {
    owner,
    name,
    number: issueNumber(number),
    organization,
  });
  const issue = data?.repository?.issue;
  if (!issue) throw new Error(`Issue #${number} was not found in ${repository}.`);
  return {
    ...issue,
    // GraphQL exposes the IssueState enum in upper case; the REST-compatible
    // controller contract uses the lower-case value used by existing guards.
    state: typeof issue.state === 'string' ? issue.state.toLocaleLowerCase('en-US') : issue.state,
    issueType: issue.issueType ?? null,
    issueFieldValues: issue.issueFieldValues?.nodes ?? [],
    parent: issue.parent ?? null,
    subIssues: issue.subIssues?.nodes ?? [],
    organizationIssueTypes: data?.organization?.issueTypes?.nodes ?? [],
    organizationIssueFields: data?.organization?.issueFields?.nodes ?? [],
  };
}

function runtimeId(definition) {
  return definition?.runtime_id ?? definition?.github_id ?? definition?.id ?? null;
}

function runtimeOptionId(option) {
  return option?.runtime_id ?? option?.github_id ?? option?.id ?? null;
}

function observedOrganizationField(fields, definition) {
  const ids = [definition?.runtime_id, definition?.github_id, definition?.id]
    .filter((value) => typeof value === 'string' && value.trim());
  return (fields ?? []).find((field) => ids.includes(field?.id) || field?.name === definition?.name) ?? null;
}

/**
 * Verify the live organization field catalog before any controller mutation.
 * The repository contract uses logical IDs; the runtime binding must match
 * the GitHub IDs and option names observed by the trusted GraphQL read.
 */
export function validateOrganizationIssueFields({ config, organizationIssueFields, requireOptions = true, requireRuntimeBindings = false } = {}) {
  const errors = [];
  const observed = {};
  if (!Array.isArray(organizationIssueFields)) {
    return { valid: false, errors: ['The organization issue-field catalog was not returned.'], observed };
  }
  for (const fieldKey of ['lifecycle_stage', 'readiness']) {
    const definition = config?.fields?.[fieldKey];
    if (!definition) {
      errors.push(`The repository field definition ${fieldKey} is missing.`);
      continue;
    }
    const field = observedOrganizationField(organizationIssueFields, definition);
    if (!field) {
      errors.push(`The organization issue field ${definition.name} was not observed.`);
      continue;
    }
    observed[fieldKey] = field;
    if (field.dataType !== 'SINGLE_SELECT') errors.push(`The organization issue field ${definition.name} is not SINGLE_SELECT.`);
    const configuredFieldId = runtimeId(definition);
    if (requireRuntimeBindings && !definition.runtime_id && !definition.github_id) {
      errors.push(`The runtime binding for ${fieldKey} is missing.`);
    }
    if (configuredFieldId && field.id && configuredFieldId !== field.id) {
      errors.push(`The runtime binding for ${fieldKey} does not match the observed organization field ID.`);
    }
    if (!requireOptions) continue;
    if (!Array.isArray(field.options)) {
      errors.push(`The organization issue field ${definition.name} did not return its options.`);
      continue;
    }
    for (const expected of definition.options ?? []) {
      if (requireRuntimeBindings && !expected.runtime_id && !expected.github_id) {
        errors.push(`The runtime binding for ${fieldKey}.${expected.id} is missing.`);
      }
      const actual = field.options.find((candidate) => candidate?.name === expected.name
        || candidate?.id === runtimeOptionId(expected));
      if (!actual) {
        errors.push(`The organization issue field ${definition.name} is missing option ${expected.name}.`);
      } else if (runtimeOptionId(expected) && actual.id && runtimeOptionId(expected) !== actual.id) {
        errors.push(`The runtime binding for ${fieldKey}.${expected.id} does not match the observed option ID.`);
      }
    }
  }
  return { valid: errors.length === 0, errors, observed };
}

/**
 * Bind operator-observed GitHub node IDs to the versioned logical contract.
 * The repository catalog deliberately keeps stable logical IDs so it can be
 * reviewed without organization-specific IDs; Actions may supply this small
 * binding as a repository variable when GitHub has provisioned the fields.
 */
export function bindIssueMetadataConfig(config, bindings = {}) {
  let value = bindings;
  if (typeof value === 'string') {
    try { value = JSON.parse(value); } catch { throw new Error('ISSUE_FIELD_BINDINGS_JSON is not valid JSON.'); }
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Issue-field bindings must be an object.');
  const bound = JSON.parse(JSON.stringify(config));
  for (const [field, binding] of Object.entries(value.fields ?? {})) {
    if (!bound.fields?.[field]) throw new Error(`Issue-field bindings name an unknown field: ${field}.`);
    if (!binding || typeof binding !== 'object' || Array.isArray(binding)) throw new Error(`Bindings for ${field} must be an object.`);
    if (binding.id !== undefined && (typeof binding.id !== 'string' || !binding.id.trim())) throw new Error(`Bindings for ${field} have an invalid field ID.`);
    if (binding.id) bound.fields[field].runtime_id = binding.id;
    for (const [optionId, runtimeId] of Object.entries(binding.options ?? {})) {
      const option = bound.fields[field].options?.find((candidate) => candidate.id === optionId);
      if (!option) throw new Error(`Bindings for ${field} name an unknown option: ${optionId}.`);
      if (typeof runtimeId !== 'string' || !runtimeId.trim()) throw new Error(`Bindings for ${field}.${optionId} have an invalid option ID.`);
      option.runtime_id = runtimeId;
    }
  }
  return bound;
}

export function issueFieldInput({ config, field, value } = {}) {
  const definition = config?.fields?.[field];
  const option = definition?.options?.find((candidate) => candidate.id === value || candidate.name === value);
  if (!definition) throw new Error(`Unknown issue field: ${field}.`);
  if (!option) throw new Error(`Unknown ${field} option: ${value}.`);
  return {
    fieldId: runtimeId(definition),
    singleSelectOptionId: runtimeOptionId(option),
  };
}

export function issueFieldInputs({ config, values = {} } = {}) {
  return Object.entries(values).map(([field, value]) => issueFieldInput({ config, field, value }));
}

export async function setIssueFields({ graphql, issueId, config, values, actor = 'controller' } = {}) {
  if (actor !== 'controller') throw new Error('Only the deterministic controller may mutate issue fields.');
  if (typeof issueId !== 'string' || !issueId.trim()) throw new Error('A GitHub issue node ID is required.');
  const issueFields = issueFieldInputs({ config, values });
  return graphql(SET_ISSUE_FIELDS_MUTATION, { input: { issueId, issueFields } });
}

export async function setIssueType({ graphql, issueId, issueTypeId, actor = 'controller' } = {}) {
  if (actor !== 'controller') throw new Error('Only the deterministic controller may mutate issue types.');
  if (typeof issueId !== 'string' || !issueId.trim() || typeof issueTypeId !== 'string' || !issueTypeId.trim()) {
    throw new Error('A GitHub issue node ID and native issue type ID are required.');
  }
  return graphql(UPDATE_ISSUE_TYPE_MUTATION, { input: { issueId, issueTypeId } });
}

export function observedIssueFieldIds(issue, config) {
  const fields = {};
  for (const fieldKey of ['lifecycle_stage', 'readiness']) {
    const definition = config?.fields?.[fieldKey];
    const entry = (issue?.issueFieldValues ?? []).find((value) => {
      const field = value?.field ?? value?.issueField;
      return field && (field.id === definition?.id || field.name === definition?.name || field.id === definition?.runtime_id);
    });
    if (entry) fields[fieldKey] = {
      fieldId: entry.field?.id ?? entry.fieldId ?? null,
      optionId: entry.optionId ?? null,
      value: entry.value ?? entry.name ?? null,
    };
  }
  return fields;
}
