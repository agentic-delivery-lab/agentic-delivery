import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { parseRepositoryYaml, YamlParseError } from './lib/yaml.mjs';
import { validateIssueMetadataConfig } from './lib/issue-metadata.mjs';
import { validateOrchestrationPolicy } from './lib/orchestration-policy.mjs';

const execFileAsync = promisify(execFile);

export class ConfigValidationError extends Error {
  constructor(message, exitCode = 1) {
    super(message);
    this.name = 'ConfigValidationError';
    this.exitCode = exitCode;
  }
}

async function gitFiles(repositoryRoot) {
  try {
    const { stdout } = await execFileAsync('git', ['-C', repositoryRoot, 'ls-files'], {
      encoding: 'utf8',
      windowsHide: true,
    });
    const tracked = stdout
      .split(/\r?\n/)
      .filter((file) => /\.(?:json|ya?ml)$/.test(file))
      .filter((file) => file !== 'pnpm-lock.yaml')
      .filter((file) => !/^tests\/.*\/fixtures\//.test(file));
    for (const file of ['.github/issue-metadata.yml', '.github/orchestration-policy.yml']) {
      if (!tracked.includes(file)) tracked.push(file);
    }
    // This repository-local file was replaced by organization issue fields.
    // A deleted-but-not-yet-staged path can still appear in `git ls-files`.
    const obsolete = '.github/issue-lifecycle.yml';
    return tracked.filter((file) => file !== obsolete);
  } catch {
    throw new ConfigValidationError('Configuration check: repository root is not a Git repository.', 2);
  }
}

export async function validateConfigFiles({ repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'), files } = {}) {
  const relativeFiles = files ?? await gitFiles(repositoryRoot);
  const errors = [];
  for (const relativeFile of relativeFiles) {
    const filePath = path.isAbsolute(relativeFile) ? relativeFile : path.join(repositoryRoot, relativeFile);
    let source;
    try {
      source = await readFile(filePath, 'utf8');
    } catch (error) {
      errors.push(`${relativeFile}: cannot read configuration: ${error.message}`);
      continue;
    }
    try {
      if (relativeFile.endsWith('.json')) {
        JSON.parse(source);
      } else {
        parseRepositoryYaml(source, relativeFile);
      }
      if (relativeFile === '.github/issue-metadata.yml') {
        const result = validateIssueMetadataConfig(parseRepositoryYaml(source, relativeFile));
        if (!result.valid) errors.push(`${relativeFile}: ${result.errors.join('; ')}`);
      }
      if (relativeFile === '.github/orchestration-policy.yml') {
        const result = validateOrchestrationPolicy(parseRepositoryYaml(source, relativeFile));
        if (!result.valid) errors.push(`${relativeFile}: ${result.errors.join('; ')}`);
      }
    } catch (error) {
      if (error instanceof YamlParseError) {
        errors.push(`${relativeFile}: ${error.message}`);
      } else {
        errors.push(`${relativeFile}: ${error.message}`);
      }
    }
  }
  if (errors.length > 0) {
    throw new ConfigValidationError(
      `${errors.map((error) => `Configuration check: ${error}`).join('\n')}\nConfiguration check failed with ${errors.length} error(s).`,
      1,
    );
  }
  return relativeFiles.length;
}

const isMainModule = process.argv[1]
  && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMainModule) {
  if (process.argv.length > 3) {
    process.stderr.write(`Usage: ${path.basename(process.argv[1])} [repository root]\n`);
    process.exitCode = 2;
  } else {
    try {
      const count = await validateConfigFiles({ repositoryRoot: process.argv[2] ?? '.' });
      process.stdout.write(`Configuration check passed: ${count} file(s).\n`);
    } catch (error) {
      process.stderr.write(`${error.message}\n`);
      process.exitCode = error.exitCode ?? 1;
    }
  }
}
