import { execFile } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const ORGANIZATION = /^[A-Za-z0-9_.-]+$/;
const REPOSITORY = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const API_VERSION = '2022-11-28';

export class GithubInventoryError extends Error {
  constructor(message, exitCode = 1) {
    super(message);
    this.name = 'GithubInventoryError';
    this.exitCode = exitCode;
  }
}

function sanitize(value) {
  return String(value ?? '')
    .replace(/(?:gh[pousr]|github_pat)_[A-Za-z0-9_]+/g, '[redacted-token]')
    .replace(/(authorization\s*:\s*bearer\s+)[^\s]+/ig, '$1[redacted]')
    .replace(/\r?\n/g, ' ')
    .slice(0, 500);
}

function endpointObserved(items) {
  return { status: items.length ? 'observed' : 'empty', count: items.length, items };
}

function endpointUnavailable(error) {
  return { status: 'unavailable', reason: sanitize(error?.message ?? error) };
}

function parseJson(stdout, label) {
  try {
    return JSON.parse(stdout);
  } catch (error) {
    throw new GithubInventoryError(`${label} returned invalid JSON: ${sanitize(error.message)}`, 2);
  }
}

async function defaultRunner(args) {
  try {
    const result = await execFileAsync('gh', args, {
      encoding: 'utf8',
      windowsHide: true,
      maxBuffer: 16 * 1024 * 1024,
    });
    return { stdout: result.stdout, stderr: result.stderr };
  } catch (error) {
    const reason = sanitize(error.stderr || error.message);
    const wrapped = new GithubInventoryError(`gh ${args.join(' ')} failed: ${reason}`, error.code === 'ENOENT' ? 2 : 1);
    wrapped.cause = error;
    throw wrapped;
  }
}

function endpointArgs(endpoint) {
  return ['api', '--method', 'GET', '--hostname', 'github.com', '--header', `X-GitHub-Api-Version: ${API_VERSION}`, endpoint];
}

async function getJson(endpoint, run) {
  const result = await run(endpointArgs(endpoint));
  return parseJson(result.stdout, endpoint);
}

async function getProjectsV2({ organization, run }) {
  const query = `query($login:String!) {
    organization(login:$login) {
      projectsV2(first:100) {
        nodes {
          number
          title
          url
          closed
          fields(first:100) {
            nodes {
              __typename
              ... on ProjectV2FieldCommon { id name }
              ... on ProjectV2SingleSelectField { options { id name } }
            }
          }
          views(first:100) { nodes { number name layout } }
        }
      }
    }
  }`;
  const result = await run(['api', 'graphql', '--hostname', 'github.com', '-F', `login=${organization}`, '-f', `query=${query}`]);
  const value = parseJson(result.stdout, 'GraphQL Projects v2');
  if (Array.isArray(value.errors) && value.errors.length) {
    throw new GithubInventoryError(`GraphQL Projects v2 returned errors: ${sanitize(value.errors.map((error) => error.message).join('; '))}`);
  }
  return value.data?.organization?.projectsV2?.nodes ?? [];
}

async function observe(endpoint, run, map = (value) => value) {
  try {
    const value = await getJson(endpoint, run);
    const values = Array.isArray(value) ? value : (Array.isArray(value?.workflows) ? value.workflows : (Array.isArray(value?.rulesets) ? value.rulesets : []));
    return endpointObserved(values.map(map));
  } catch (error) {
    return endpointUnavailable(error);
  }
}

function repositorySummary(repository) {
  const fullName = String(repository?.full_name ?? '');
  return {
    fullName,
    status: 'observed',
    identity: { id: repository?.id == null ? null : String(repository.id), name: String(repository?.name ?? '') },
    visibility: repository?.visibility ?? (repository?.private ? 'private' : null),
    defaultBranch: repository?.default_branch ?? null,
    rulesets: { status: 'unavailable', reason: 'not queried' },
    workflows: { status: 'unavailable', reason: 'not queried' },
    openIssues: { status: 'unavailable', reason: 'not queried' },
    openPullRequests: { status: 'unavailable', reason: 'not queried' },
    labels: { status: 'unavailable', reason: 'not queried' },
    crossRepositoryReferences: [],
  };
}

function crossReferences(values, organization) {
  const references = new Set();
  const expression = new RegExp(`(?:https?:\\/\\/github\\.com\\/)?${organization}\\/[A-Za-z0-9_.-]+(?:#\\d+|\\/issues\\/\\d+|\\/pull\\/\\d+)?`, 'g');
  for (const value of values) {
    for (const match of String(value?.body ?? '').matchAll(expression)) references.add(match[0]);
  }
  return [...references].sort();
}

async function observeRepository(repository, organization, run) {
  const summary = repositorySummary(repository);
  const fullName = summary.fullName;
  if (!REPOSITORY.test(fullName)) return { ...summary, status: 'unavailable', warnings: ['GitHub returned an invalid repository identity.'] };
  const [rulesets, workflows, issues, pulls, labels] = await Promise.all([
    observe(`repos/${fullName}/rulesets?per_page=100`, run, (value) => ({ id: value.id == null ? null : String(value.id), name: value.name ?? null, enforcement: value.enforcement ?? null })),
    observe(`repos/${fullName}/actions/workflows?per_page=100`, run, (value) => ({ id: value.id == null ? null : String(value.id), name: value.name ?? null, path: value.path ?? null, state: value.state ?? null })),
    observe(`repos/${fullName}/issues?state=open&per_page=100`, run, (value) => ({ number: value.number ?? null, pullRequest: Boolean(value.pull_request), references: crossReferences([value], organization) })),
    observe(`repos/${fullName}/pulls?state=open&per_page=100`, run, (value) => ({ number: value.number ?? null, head: value.head?.ref ?? null, base: value.base?.ref ?? null, references: crossReferences([value], organization) })),
    observe(`repos/${fullName}/labels?per_page=100`, run, (value) => ({ name: value.name ?? null, color: value.color ?? null })),
  ]);
  const issueReferences = issues.items?.flatMap((item) => item.references ?? []) ?? [];
  const pullReferences = pulls.items?.flatMap((item) => item.references ?? []) ?? [];
  const endpointUnavailableCount = [rulesets, workflows, issues, pulls, labels].filter((item) => item.status === 'unavailable').length;
  return {
    ...summary,
    status: endpointUnavailableCount === 5 ? 'unavailable' : endpointUnavailableCount ? 'partial' : 'observed',
    rulesets,
    workflows,
    openIssues: issues,
    openPullRequests: pulls,
    labels,
    crossRepositoryReferences: [...new Set([...issueReferences, ...pullReferences])].sort(),
  };
}

const CAPABILITY_ENDPOINTS = {
  organizationActions: (organization) => `orgs/${organization}/actions/permissions`,
  organizationVariables: (organization) => `orgs/${organization}/actions/variables?per_page=100`,
  organizationSecrets: (organization) => `orgs/${organization}/actions/secrets?per_page=100`,
  appInstallation: (organization) => `orgs/${organization}/installation`,
  copilotBilling: (organization) => `orgs/${organization}/copilot/billing`,
  organizationProperties: (organization) => `orgs/${organization}/properties/schema`,
  issueTypes: (organization) => `orgs/${organization}/issue-types`,
  classicProjects: (organization) => `orgs/${organization}/projects?state=all&per_page=100`,
};

function capabilityMapValue(value) {
  if (Array.isArray(value)) return endpointObserved(value.map((item) => ({ id: item.id ?? null, name: item.name ?? null, state: item.state ?? null })));
  if (!value || typeof value !== 'object') return endpointObserved([]);
  const safe = {};
  for (const [key, item] of Object.entries(value)) {
    if (['private_repositories', 'enabled_repositories', 'selected_repositories', 'members_can_create_repositories'].includes(key)) safe[key] = item;
    else if (typeof item === 'string' || typeof item === 'boolean' || typeof item === 'number' || item === null) safe[key] = item;
  }
  return { status: 'observed', count: 1, items: [safe] };
}

async function observeCapability(endpoint, run) {
  try {
    const value = await getJson(endpoint, run);
    return capabilityMapValue(value);
  } catch (error) {
    return endpointUnavailable(error);
  }
}

async function observeProjectsV2(organization, run) {
  try {
    const projects = await getProjectsV2({ organization, run });
    return endpointObserved(projects.map((project) => ({
      number: project.number ?? null,
      title: project.title ?? null,
      url: project.url ?? null,
      closed: project.closed ?? null,
      fields: (project.fields?.nodes ?? []).map((field) => ({
        type: field.__typename ?? null,
        id: field.id ?? null,
        name: field.name ?? null,
        options: (field.options ?? []).map((option) => ({ id: option.id ?? null, name: option.name ?? null })),
      })),
      views: (project.views?.nodes ?? []).map((view) => ({ number: view.number ?? null, name: view.name ?? null, layout: view.layout ?? null })),
    })));
  } catch (error) {
    return endpointUnavailable(error);
  }
}

export async function collectGithubInventory({ organization = 'agentic-delivery-lab', run = defaultRunner, now = () => new Date().toISOString() } = {}) {
  if (!ORGANIZATION.test(organization)) throw new GithubInventoryError('organization must be a valid GitHub login', 2);
  let repositories;
  try {
    repositories = await getJson(`orgs/${organization}/repos?type=all&per_page=100`, run);
  } catch (error) {
    throw new GithubInventoryError(`Cannot read organization repositories: ${sanitize(error.message)}`, error.exitCode ?? 1);
  }
  if (!Array.isArray(repositories)) throw new GithubInventoryError('GitHub organization repository response must be an array', 2);
  const repositorySummaries = [];
  for (const repository of repositories) repositorySummaries.push(await observeRepository(repository, organization, run));
  const capabilities = {};
  for (const [id, endpoint] of Object.entries(CAPABILITY_ENDPOINTS)) capabilities[id] = await observeCapability(endpoint(organization), run);
  capabilities.projectsV2 = await observeProjectsV2(organization, run);
  const warnings = [];
  let organizationId = null;
  let organizationPlan = null;
  try {
    const organizationRecord = await getJson(`orgs/${organization}`, run);
    organizationId = organizationRecord?.id == null ? null : String(organizationRecord.id);
    organizationPlan = organizationRecord?.plan
      ? {
          name: organizationRecord.plan.name ?? null,
          privateRepositories: Number.isInteger(organizationRecord.plan.private_repos) ? organizationRecord.plan.private_repos : null,
          collaborators: Number.isInteger(organizationRecord.plan.collaborators) ? organizationRecord.plan.collaborators : null,
        }
      : null;
  } catch (error) {
    warnings.push(`The organization identity endpoint was not readable: ${sanitize(error.message)}`);
  }
  if (repositorySummaries.some((repository) => repository.status !== 'observed')) warnings.push('One or more repository sub-inventories were unavailable; absence must not be inferred from a permission error.');
  for (const [id, endpoint] of Object.entries(capabilities)) if (endpoint.status === 'unavailable') warnings.push(`Capability ${id} was not readable; treat it as an evidence gap, not as absence.`);
  return {
    schemaVersion: 1,
    organization: { login: organization, id: organizationId, plan: organizationPlan },
    collectedAt: now(),
    evidenceClass: 'live-read-only',
    readOnly: true,
    repositories: repositorySummaries,
    capabilities,
    warnings,
  };
}

function usage() {
  return 'Usage: node scripts/collect-github-inventory.mjs [--org <login>] [--output <path>]';
}

function parseArgs(args) {
  const options = { organization: 'agentic-delivery-lab' };
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === '--org') options.organization = args[++index];
    else if (argument === '--output') options.output = args[++index];
    else throw new GithubInventoryError(`Unknown argument: ${argument}\n${usage()}`, 2);
    if (!options.organization || (argument === '--output' && !options.output)) throw new GithubInventoryError(`${argument} requires a value\n${usage()}`, 2);
  }
  return options;
}

const isMainModule = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMainModule) {
  try {
    const options = parseArgs(process.argv.slice(2));
    const report = await collectGithubInventory({ organization: options.organization });
    if (options.output) await writeFile(options.output, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = error.exitCode ?? 1;
  }
}
