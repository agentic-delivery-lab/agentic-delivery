import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PLAN_PATH = 'tasks/agentic-delivery-repository-split-plan.md';

export class MigrationPlanValidationError extends Error {
  constructor(message, exitCode = 1) {
    super(message);
    this.name = 'MigrationPlanValidationError';
    this.exitCode = exitCode;
  }
}

async function readJson(file) {
  try {
    return JSON.parse(await readFile(file, 'utf8'));
  } catch (error) {
    throw new MigrationPlanValidationError(`Migration-plan check: cannot read ${file}: ${error.message}`);
  }
}

export async function validateMigrationPlan({ repositoryRoot: root = repositoryRoot } = {}) {
  let plan;
  try {
    plan = await readFile(path.join(root, PLAN_PATH), 'utf8');
  } catch (error) {
    throw new MigrationPlanValidationError(`Migration-plan check: cannot read ${PLAN_PATH}: ${error.message}`);
  }
  const release = await readJson(path.join(root, 'config/controller-release.json'));
  const errors = [];
  const requiredPhrases = [
    'Issue boundary: Issue #52 is the plan-persistence source issue.',
    '### Successor-issue handoff contract',
    'Refs #52',
    'not `Closes #52`',
    '## Issue-creation safety gate',
    'https://chatgpt.com/s/m_6ab02b51ffbc8191bed2d20b522e4673',
    '## Hard implementation gate',
    'organization-wide Control Plane ownership, participation, distribution, and',
    'versioning strategy',
    'liveGitHubVerification',
    'not-found-unverified',
    '67d328b46d84ae599ebfe65ef550d156f689e112',
    '8b9bd77e1cb6008ce9dab3bbe8652ab7979b4c99',
    'No filtered history is fabricated by changing the manifest alone.',
    'Delivery State',
    'Delivery Readiness',
    '.github-private',
    'Organization-wide Agentic Delivery control-plane distribution and versioning',
  ];
  for (const phrase of requiredPhrases) if (!plan.includes(phrase)) errors.push(`plan is missing required safety or architecture text: ${phrase}`);

  if (/^\s*Closes #52\b/m.test(plan)) errors.push('plan must not instruct a pull request to close Issue #52');

  const headings = [...plan.matchAll(/^## (\d+)\./gm)].map((match) => Number(match[1]));
  const expectedHeadings = Array.from({ length: 28 }, (_, index) => index + 1);
  if (headings.length !== expectedHeadings.length || headings.some((number, index) => number !== expectedHeadings[index])) {
    errors.push(`plan must contain ordered sections 1 through 28; found ${headings.join(', ')}`);
  }

  const normalizedPlan = plan.toLowerCase();
  if (typeof release.version !== 'string' || !normalizedPlan.includes(`current draft controller \`${release.version.toLowerCase()}\``)) {
    errors.push('plan must record the current controller release version');
  }
  if (typeof release.commit !== 'string' || !plan.includes(`\`${release.commit}\``)) {
    errors.push('plan must record the current controller release commit');
  }

  if (errors.length > 0) {
    throw new MigrationPlanValidationError(
      `${errors.map((error) => `Migration-plan check: ${error}`).join('\n')}\nMigration-plan check failed with ${errors.length} error(s).`,
    );
  }
  return { plan: PLAN_PATH, sections: expectedHeadings.length, controllerRelease: release.version, status: 'passed' };
}

const isMainModule = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMainModule) {
  try {
    const result = await validateMigrationPlan({ repositoryRoot: process.argv[2] ?? undefined });
    process.stdout.write(`Migration-plan check passed: ${result.sections} sections, ${result.controllerRelease}.\n`);
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = error.exitCode ?? 1;
  }
}
