// agentic-primitive: {"id":"pull-request-body-validator","kind":"validator","enforcement":"deterministic","adrs":["ADR-0016"],"domains":["agentic-delivery-governance"]}
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const DEPENDABOT_LOGIN = 'dependabot[bot]';

export const REQUIRED_PULL_REQUEST_SECTIONS = Object.freeze([
  'Summary',
  'Source and plan',
  'Changes',
  'Verification',
  'Evidence',
  'Risk and delivery',
  'Review guidance',
  'Author checklist',
]);

const REQUIRED_FIELDS = Object.freeze({
  'Source and plan': ['Source issue', 'Implementation plan', 'Plan deviations'],
  'Risk and delivery': [
    'Risk level and impact',
    'Security and privacy',
    'Breaking changes and compatibility',
    'Deployment or migration',
    'Rollback',
    'Dependencies and follow-up work',
  ],
  'Review guidance': ['Review focus', 'Suggested review order', 'Out of scope'],
});

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function withoutComments(value) {
  return String(value ?? '').replace(/<!--[\s\S]*?-->/g, '');
}

function hasMeaningfulContent(value) {
  return withoutComments(value)
    .split(/\r?\n/)
    .some((line) => /[\p{Letter}\p{Number}]/u.test(
      line.replace(/^\s*(?:[-+*]>?|\d+[.)])\s*/, '').replace(/^\s*-\s*\[[ xX]\]\s*/, ''),
    ));
}

function parseSections(body) {
  const matches = [...body.matchAll(/^##[ \t]+(.+?)[ \t]*$/gm)];
  const sections = new Map();
  const duplicates = new Set();
  matches.forEach((match, index) => {
    const title = match[1].trim();
    if (sections.has(title)) duplicates.add(title);
    const start = match.index + match[0].length;
    const end = matches[index + 1]?.index ?? body.length;
    sections.set(title, body.slice(start, end).trim());
  });
  return { sections, duplicates };
}

function fieldAnswer(section, label) {
  const match = withoutComments(section).match(new RegExp(`^\\s*-?\\s*${escapeRegExp(label)}:\\s*(.+?)\\s*$`, 'imu'));
  return match?.[1]?.trim() ?? '';
}

export function validatePullRequestBody({ body, author }) {
  if (author === DEPENDABOT_LOGIN) {
    return Object.freeze({ valid: true, exempt: true, errors: Object.freeze([]) });
  }

  const errors = [];
  const source = typeof body === 'string' ? body : '';
  if (!source.trim()) {
    errors.push('Pull request body is empty. Use the organization pull request template.');
    return Object.freeze({ valid: false, exempt: false, errors: Object.freeze(errors) });
  }

  const { sections, duplicates } = parseSections(source);
  for (const title of REQUIRED_PULL_REQUEST_SECTIONS) {
    if (!sections.has(title)) errors.push(`Missing required section: ## ${title}`);
    else if (duplicates.has(title)) errors.push(`Required section appears more than once: ## ${title}`);
    else if (!hasMeaningfulContent(sections.get(title))) errors.push(`Required section has no answer: ## ${title}`);
  }

  for (const [title, labels] of Object.entries(REQUIRED_FIELDS)) {
    const section = sections.get(title);
    if (!section) continue;
    for (const label of labels) {
      if (!hasMeaningfulContent(fieldAnswer(section, label))) {
        errors.push(`Required field has no answer: ${title} > ${label}`);
      }
    }
  }

  const checklist = withoutComments(sections.get('Author checklist'));
  if (checklist) {
    if (/^\s*-\s*\[\s\]\s+/m.test(checklist)) errors.push('Author checklist contains unchecked items.');
    if (!/^\s*-\s*\[[xX]\]\s+/m.test(checklist)) errors.push('Author checklist has no completed items.');
  }

  return Object.freeze({
    valid: errors.length === 0,
    exempt: false,
    errors: Object.freeze(errors),
  });
}

const isMainModule = process.argv[1]
  && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMainModule) {
  if (!Object.hasOwn(process.env, 'PR_BODY') || !process.env.PR_AUTHOR) {
    process.stderr.write('Usage: set PR_BODY and PR_AUTHOR for the pull request event.\n');
    process.exitCode = 2;
  } else {
    const result = validatePullRequestBody({
      body: process.env.PR_BODY,
      author: process.env.PR_AUTHOR,
    });
    if (result.valid) {
      const message = result.exempt
        ? `${DEPENDABOT_LOGIN} is explicitly exempt from the pull request body contract.`
        : 'Pull request body satisfies the organization template contract.';
      process.stdout.write(`Pull request body check passed: ${message}\n`);
    } else {
      process.stderr.write(`Pull request body check failed:\n${result.errors.map((error) => `- ${error}`).join('\n')}\n`);
      process.exitCode = 1;
    }
  }
}
