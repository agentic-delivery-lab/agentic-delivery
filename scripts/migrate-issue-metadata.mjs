// agentic-primitive: {"id":"issue-metadata-migration-command","kind":"script","enforcement":"deterministic","adrs":["ADR-0012","ADR-0013"],"domains":["agentic-delivery-governance"]}

import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadLifecycleConfig, githubApi } from './issue-intake.mjs';
import { githubGraphqlApi, readIssueControlPlane } from './lib/issue-field-api.mjs';
import { applyIssueMetadataMigration, organizationMetadataManifest, planIssueMetadataMigration } from './lib/issue-metadata-migration.mjs';
import { issueMetadata, issueTypes } from './lib/issue-metadata.mjs';

const repositoryRoot = path.resolve(import.meta.dirname, '..');

function args(argv) {
  const result = { apply: false, issue: null };
  for (let index = 2; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === '--apply') result.apply = true;
    else if (value === '--dry-run') result.apply = false;
    else if (value === '--issue') result.issue = argv[++index];
    else if (value === '--manifest') result.manifest = true;
    else throw new Error(`Unknown option ${value}.`);
  }
  return result;
}

function requireIssue(value) {
  if (!/^[1-9][0-9]*$/.test(String(value ?? ''))) throw new Error('Use --issue with a positive issue number.');
  return String(value);
}

function bindings(env) {
  if (!env.ISSUE_FIELD_BINDINGS_JSON) return {};
  try { return JSON.parse(env.ISSUE_FIELD_BINDINGS_JSON); }
  catch { throw new Error('ISSUE_FIELD_BINDINGS_JSON is not valid JSON.'); }
}

export async function runMigration({ env = process.env, argv = process.argv, root = repositoryRoot, fetchImpl = fetch, graphqlImpl } = {}) {
  const options = args(argv);
  const config = await loadLifecycleConfig(root);
  if (options.manifest || !options.issue) return { mode: 'dry-run', manifest: organizationMetadataManifest(config) };
  const repository = env.GITHUB_REPOSITORY;
  if (!/^[^/\s]+\/[^/\s]+$/.test(repository ?? '') || !env.GH_TOKEN) throw new Error('GITHUB_REPOSITORY and GH_TOKEN are required.');
  const issueNumber = requireIssue(options.issue);
  const runtimeBindings = bindings(env);
  const api = githubApi({ repository, token: env.GH_TOKEN, fetchImpl });
  const restIssue = await api(`/issues/${issueNumber}`);
  const graphql = graphqlImpl ?? githubGraphqlApi({ token: env.GH_TOKEN, fetchImpl });
  const controlPlane = await readIssueControlPlane({ graphql, repository, issueNumber, organization: repository.split('/')[0] });
  const issue = { ...restIssue, ...controlPlane, labels: restIssue.labels ?? [] };
  const plan = planIssueMetadataMigration({
    issue,
    config,
    organizationIssueTypes: controlPlane.organizationIssueTypes,
    organizationIssueFields: controlPlane.organizationIssueFields,
    bindings: runtimeBindings,
  });
  if (!options.apply) return { mode: 'dry-run', plan };
  if (plan.blocked.length) throw new Error(`Migration requires operator configuration: ${plan.blocked.join('; ')}`);
  const result = await applyIssueMetadataMigration({
    plan,
    issue,
    config,
    graphql,
    bindings: runtimeBindings,
    organizationIssueFields: controlPlane.organizationIssueFields,
    actor: 'controller',
    verify: async () => {
      const observed = await readIssueControlPlane({ graphql, repository, issueNumber, organization: repository.split('/')[0] });
      const metadata = issueMetadata(observed, config);
      const targetType = issueTypes(config).find((type) => type.id === plan.target.issueType);
      if (targetType && (metadata.issueType.source !== 'native' || metadata.issueType.id !== targetType.id)) {
        throw new Error(`Native issue type ${targetType.native_name} was not observed after migration.`);
      }
      if (metadata.lifecycleStage !== plan.target.lifecycleStage || metadata.readiness !== plan.target.readiness) {
        throw new Error('Issue fields were not observed after migration.');
      }
    },
    updateLabels: (labels) => api(`/issues/${issueNumber}/labels`, 'PUT', { labels }),
  });
  return { mode: 'apply', result };
}

const isMainModule = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMainModule) {
  try {
    process.stdout.write(`${JSON.stringify(await runMigration())}\n`);
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}
