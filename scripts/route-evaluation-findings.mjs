// agentic-primitive: {"id":"evaluation-finding-router-cli","kind":"script","enforcement":"deterministic","adrs":["ADR-0018"],"domains":["agentic-delivery-control-plane"]}
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseRepositoryYaml } from './lib/yaml.mjs';
import { loadPinnedEvaluationReportSchema, routeEvaluationReports } from './lib/evaluation-finding-router.mjs';
import { parseParticipantRegistry } from './lib/participant-registry.mjs';

export class EvaluationFindingCliError extends Error {
  constructor(message) {
    super(message);
    this.name = 'EvaluationFindingCliError';
  }
}

function parseArguments(argv) {
  const options = { reports: [] };
  const single = new Set(['--architecture-root', '--participants', '--source-issue']);

  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === '--') continue;
    if (flag === '--report') {
      const value = argv[++index];
      if (!value || value.startsWith('--')) throw new EvaluationFindingCliError('--report requires a file path.');
      options.reports.push(value);
      continue;
    }
    if (!single.has(flag)) throw new EvaluationFindingCliError(`Unsupported argument: ${flag}`);
    if (options[flag] !== undefined) throw new EvaluationFindingCliError(`${flag} may be supplied only once.`);
    const value = argv[++index];
    if (!value || value.startsWith('--')) throw new EvaluationFindingCliError(`${flag} requires a value.`);
    options[flag] = value;
  }

  if (!options['--architecture-root']) throw new EvaluationFindingCliError('--architecture-root is required and must contain the pinned Architecture commit.');
  if (!options['--source-issue']) throw new EvaluationFindingCliError('--source-issue is required to prevent a proposal from targeting its own source Issue.');
  if (options.reports.length === 0) throw new EvaluationFindingCliError('At least one --report file is required.');
  return options;
}

export async function createEvaluationFindingProposals(argv, { cwd = process.cwd() } = {}) {
  const options = parseArguments(argv);
  const registryPath = path.resolve(cwd, options['--participants'] ?? 'config/participants.yml');
  const registrySource = await readFile(registryPath, 'utf8');
  const participantRegistry = parseParticipantRegistry(parseRepositoryYaml(registrySource, 'participant registry'));
  if (!participantRegistry.valid) {
    throw new EvaluationFindingCliError(`Participant registry is invalid: ${participantRegistry.errors.join('; ')}.`);
  }

  const reports = [];
  for (const reportPath of options.reports) {
    const absolutePath = path.resolve(cwd, reportPath);
    const source = await readFile(absolutePath, 'utf8');
    reports.push(parseRepositoryYaml(source, `evaluation report ${reportPath}`));
  }

  const schemaContract = await loadPinnedEvaluationReportSchema(path.resolve(cwd, options['--architecture-root']));
  return routeEvaluationReports({
    reports,
    schemaContract,
    participantRegistry,
    sourceIssueUrl: options['--source-issue'],
  });
}

const isMainModule = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMainModule) {
  try {
    const result = await createEvaluationFindingProposals(process.argv.slice(2));
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}
