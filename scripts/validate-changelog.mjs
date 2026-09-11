// agentic-primitive: {"id":"changelog-structure-validator","kind":"validator","enforcement":"deterministic","adrs":["ADR-0006"],"domains":["agentic-delivery-governance"]}
import { access, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const allowedCategories = new Set(['Added', 'Changed', 'Deprecated', 'Removed', 'Fixed', 'Security']);
const semverPattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|[0-9A-Za-z-]*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|[0-9A-Za-z-]*[A-Za-z-][0-9A-Za-z-]*))*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;

export class ChangelogValidationError extends Error {
  constructor(message, exitCode = 1) {
    super(message);
    this.name = 'ChangelogValidationError';
    this.exitCode = exitCode;
  }
}

async function isDirectory(filePath) {
  try {
    return (await stat(filePath)).isDirectory();
  } catch {
    return false;
  }
}

async function isFile(filePath) {
  try {
    return (await stat(filePath)).isFile();
  } catch {
    return false;
  }
}

function parseIsoDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) return null;
  if (date.getUTCFullYear() !== year || date.getUTCMonth() + 1 !== month || date.getUTCDate() !== day) {
    return null;
  }
  return value;
}

function compareVersions(left, right) {
  const leftMatch = left.match(/^(\d+)\.(\d+)\.(\d+)(?:-([^+]+))?/);
  const rightMatch = right.match(/^(\d+)\.(\d+)\.(\d+)(?:-([^+]+))?/);
  const leftCore = leftMatch.slice(1, 4).map(Number);
  const rightCore = rightMatch.slice(1, 4).map(Number);
  for (let index = 0; index < leftCore.length; index += 1) {
    if (leftCore[index] !== rightCore[index]) return leftCore[index] - rightCore[index];
  }

  const leftPre = leftMatch[4]?.split('.');
  const rightPre = rightMatch[4]?.split('.');
  if (!leftPre && !rightPre) return 0;
  if (!leftPre) return 1;
  if (!rightPre) return -1;
  for (let index = 0; index < Math.max(leftPre.length, rightPre.length); index += 1) {
    const leftId = leftPre[index];
    const rightId = rightPre[index];
    if (leftId === undefined) return -1;
    if (rightId === undefined) return 1;
    const leftNumeric = /^\d+$/.test(leftId);
    const rightNumeric = /^\d+$/.test(rightId);
    if (leftNumeric && rightNumeric) {
      if (Number(leftId) !== Number(rightId)) return Number(leftId) - Number(rightId);
    } else if (leftNumeric !== rightNumeric) {
      return leftNumeric ? -1 : 1;
    } else if (leftId !== rightId) {
      return leftId < rightId ? -1 : 1;
    }
  }
  return 0;
}

export async function validateChangelog(repositoryRoot = process.cwd()) {
  const root = path.resolve(repositoryRoot);
  if (!(await isDirectory(root))) {
    throw new ChangelogValidationError(`Changelog check: repository root does not exist: ${repositoryRoot}`, 2);
  }
  const changelogPath = path.join(root, 'CHANGELOG.md');
  if (!(await isFile(changelogPath))) {
    throw new ChangelogValidationError('Changelog check: missing CHANGELOG.md', 2);
  }

  const lines = (await readFile(changelogPath, 'utf8')).split(/\r?\n/);
  if (lines.at(-1) === '') lines.pop();
  const errors = [];
  if (lines[0] !== '# Changelog') errors.push("the first heading must be '# Changelog'");

  const sections = [];
  let currentSection = null;
  let currentCategory = null;
  let categoryHasEntry = false;

  const recordCategory = () => {
    if (currentCategory && !categoryHasEntry) {
      const sectionLabel = currentSection?.label ?? 'an invalid section';
      errors.push(`category ${JSON.stringify(currentCategory)} in ${sectionLabel} has no entry`);
    }
  };

  lines.forEach((line, index) => {
    const lineNumber = index + 1;
    if (/^## /.test(line)) {
      recordCategory();
      currentCategory = null;
      categoryHasEntry = false;
      const match = line.match(/^## \[([^\]]+)\](?: - (\d{4}-\d{2}-\d{2}))?$/);
      if (!match) {
        errors.push(`line ${lineNumber} has an invalid section heading`);
        currentSection = null;
        return;
      }
      const label = match[1];
      const dateText = match[2];
      if (label === 'Unreleased') {
        if (dateText) errors.push('Unreleased must not have a date');
      } else if (!dateText || !semverPattern.test(label)) {
        errors.push(`release section ${JSON.stringify(label)} must use SemVer and an ISO date`);
      }
      const releaseDate = dateText ? parseIsoDate(dateText) : null;
      if (dateText && !releaseDate) errors.push(`release section ${JSON.stringify(label)} has an invalid ISO date`);
      currentSection = { label, date: releaseDate, version: label === 'Unreleased' ? null : label };
      sections.push(currentSection);
      return;
    }
    if (/^### /.test(line)) {
      recordCategory();
      const category = line.slice(4);
      if (!currentSection) {
        errors.push(`line ${lineNumber} has a category outside a changelog section`);
      } else if (!allowedCategories.has(category)) {
        errors.push(`line ${lineNumber} uses unsupported category ${JSON.stringify(category)}`);
      }
      currentCategory = category;
      categoryHasEntry = false;
      return;
    }
    if (line.startsWith('- ') && currentSection && currentCategory && line.slice(2).trim()) {
      categoryHasEntry = true;
    }
  });
  recordCategory();

  const unreleasedSections = sections.filter(({ label }) => label === 'Unreleased');
  if (unreleasedSections.length !== 1) errors.push('the changelog must contain exactly one [Unreleased] section');
  if (sections.length > 0 && sections[0].label !== 'Unreleased') errors.push('[Unreleased] must be the first changelog section');

  const releaseSections = sections.filter(({ label }) => label !== 'Unreleased');
  if (releaseSections.some(({ date, version }) => !date || !version)) {
    errors.push('every release section must have a valid date and version');
  }
  if (new Set(releaseSections.map(({ version }) => version)).size !== releaseSections.length) {
    errors.push('release versions must be unique');
  }

  const validReleaseSections = releaseSections.filter(({ date, version }) => date && version && semverPattern.test(version));
  for (let index = 0; index < validReleaseSections.length - 1; index += 1) {
    const newer = validReleaseSections[index];
    const older = validReleaseSections[index + 1];
    if (compareVersions(newer.version, older.version) <= 0) errors.push('release sections must be ordered by descending SemVer');
    if (newer.date < older.date) errors.push('release sections must be ordered by descending date');
  }

  if (errors.length > 0) {
    throw new ChangelogValidationError(
      `${errors.map((error) => `Changelog check: ${error}`).join('\n')}\nChangelog check failed with ${errors.length} error(s).`,
      1,
    );
  }
}

const isMainModule = process.argv[1]
  && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMainModule) {
  if (process.argv.length > 3) {
    process.stderr.write(`Usage: ${path.basename(process.argv[1])} [repository root]\n`);
    process.exitCode = 2;
  } else {
    try {
      await validateChangelog(process.argv[2] ?? '.');
      process.stdout.write('Changelog check passed.\n');
    } catch (error) {
      process.stderr.write(`${error.message}\n`);
      process.exitCode = error.exitCode ?? 1;
    }
  }
}
