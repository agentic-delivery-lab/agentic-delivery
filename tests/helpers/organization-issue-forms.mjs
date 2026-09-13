import { parseRepositoryYaml } from '../../scripts/lib/yaml.mjs';

// The organization defaults repository stores its files under its own
// `.github/ISSUE_TEMPLATE/` directory.
export const ORGANIZATION_ISSUE_TEMPLATE_BASE_URL =
  'https://raw.githubusercontent.com/agentic-delivery-lab/.github/main/.github/ISSUE_TEMPLATE/';

export const EXPECTED_ORGANIZATION_ISSUE_FORMS = Object.freeze({
  'bug.yml': 'Bug',
  'feature.yml': 'Feature',
  'idea.yml': 'Idea',
  'task.yml': 'Task',
  'research.yml': 'Research',
  'requirements.yml': 'Requirements',
  'architecture-decision.yml': 'Architecture Decision',
  'implementation.yml': 'Implementation',
  'validation.yml': 'Validation',
});

const FETCH_TIMEOUT_MS = 10_000;

export class OrganizationIssueFormsError extends Error {
  constructor(message) {
    super(message);
    this.name = 'OrganizationIssueFormsError';
  }
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function parseYaml(source, fileName) {
  try {
    return parseRepositoryYaml(source, `organization issue form ${fileName}`);
  } catch (error) {
    throw new OrganizationIssueFormsError(`${fileName}: ${error.message}`);
  }
}

function validateForm(form, fileName, expectedType) {
  if (!isObject(form)) {
    throw new OrganizationIssueFormsError(`${fileName}: form must be a YAML object.`);
  }
  if (typeof form.name !== 'string' || !form.name.trim()) {
    throw new OrganizationIssueFormsError(`${fileName}: form name is required.`);
  }
  if (typeof form.description !== 'string' || !form.description.trim()) {
    throw new OrganizationIssueFormsError(`${fileName}: form description is required.`);
  }
  if (form.type !== expectedType) {
    throw new OrganizationIssueFormsError(
      `${fileName}: expected native Issue Type ${JSON.stringify(expectedType)}, received ${JSON.stringify(form.type)}.`,
    );
  }
  if (!Array.isArray(form.body) || form.body.length === 0) {
    throw new OrganizationIssueFormsError(`${fileName}: form body must contain at least one item.`);
  }
  if (form.body.some((item) => !isObject(item) || typeof item.type !== 'string' || !item.type.trim() || !isObject(item.attributes))) {
    throw new OrganizationIssueFormsError(`${fileName}: form body contains an invalid item.`);
  }
  return form;
}

function validateConfig(config) {
  if (!isObject(config)) {
    throw new OrganizationIssueFormsError('config.yml: configuration must be a YAML object.');
  }
  if (config.blank_issues_enabled !== true) {
    throw new OrganizationIssueFormsError('config.yml: blank_issues_enabled must be true.');
  }
  return config;
}

async function fetchText(fileName, { fetchImpl, baseUrl, timeoutMs }) {
  const url = new URL(fileName, baseUrl).href;
  let response;
  try {
    const signal = typeof AbortSignal?.timeout === 'function' ? AbortSignal.timeout(timeoutMs) : undefined;
    response = await fetchImpl(url, {
      headers: { accept: 'text/plain' },
      ...(signal ? { signal } : {}),
    });
  } catch (error) {
    throw new OrganizationIssueFormsError(`${fileName}: unable to fetch ${url}: ${error.message}`);
  }
  if (!response || response.ok !== true) {
    const status = typeof response?.status === 'number' ? `HTTP ${response.status}` : 'a non-success response';
    throw new OrganizationIssueFormsError(`${fileName}: unable to fetch ${url}: ${status}.`);
  }
  if (typeof response.text !== 'function') {
    throw new OrganizationIssueFormsError(`${fileName}: response did not provide text.`);
  }
  let source;
  try {
    source = await response.text();
  } catch (error) {
    throw new OrganizationIssueFormsError(`${fileName}: unable to read ${url}: ${error.message}`);
  }
  if (typeof source !== 'string' || !source.trim()) {
    throw new OrganizationIssueFormsError(`${fileName}: source is empty.`);
  }
  return source;
}

export async function fetchOrganizationIssueForms({
  fetchImpl = globalThis.fetch,
  baseUrl = ORGANIZATION_ISSUE_TEMPLATE_BASE_URL,
  timeoutMs = FETCH_TIMEOUT_MS,
} = {}) {
  if (typeof fetchImpl !== 'function') {
    throw new OrganizationIssueFormsError('organization issue forms: fetch is unavailable.');
  }
  if (typeof baseUrl !== 'string' || !baseUrl.trim()) {
    throw new OrganizationIssueFormsError('organization issue forms: base URL is required.');
  }
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new OrganizationIssueFormsError('organization issue forms: timeout must be positive.');
  }

  let normalizedBaseUrl;
  try {
    normalizedBaseUrl = new URL(baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`).href;
  } catch (error) {
    throw new OrganizationIssueFormsError(`organization issue forms: invalid base URL: ${error.message}`);
  }

  const formEntries = await Promise.all(Object.entries(EXPECTED_ORGANIZATION_ISSUE_FORMS).map(async ([fileName, expectedType]) => {
    const form = parseYaml(
      await fetchText(fileName, { fetchImpl, baseUrl: normalizedBaseUrl, timeoutMs }),
      fileName,
    );
    return [fileName, validateForm(form, fileName, expectedType)];
  }));
  const config = validateConfig(parseYaml(
    await fetchText('config.yml', { fetchImpl, baseUrl: normalizedBaseUrl, timeoutMs }),
    'config.yml',
  ));

  return Object.freeze({
    baseUrl: normalizedBaseUrl,
    forms: Object.freeze(Object.fromEntries(formEntries)),
    config,
  });
}

let cachedOrganizationIssueForms;

export function loadOrganizationIssueForms(options = {}) {
  if (Object.keys(options).length > 0) return fetchOrganizationIssueForms(options);
  cachedOrganizationIssueForms ??= fetchOrganizationIssueForms();
  return cachedOrganizationIssueForms.catch((error) => {
    cachedOrganizationIssueForms = undefined;
    throw error;
  });
}
