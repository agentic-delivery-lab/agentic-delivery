import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { deterministicReview, formatReviewMarkdown } from './lib/architecture-review.mjs';

function usage() {
  return 'Usage: node scripts/harness-architecture-review.mjs --base <sha> --head <sha> [--event <path>] [--output <path>] [--summary <path>] [--architecture-root <path> --architecture-commit <sha> --architecture-digest <sha256> --architecture-version <version>] [--semantic]';
}

function usageError(message) {
  const error = new Error(message);
  error.code = 'ERR_INVALID_ARG_VALUE';
  return error;
}

function parseArgs(args) {
  const value = { semantic: false };
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === '--semantic') value.semantic = true;
    else if (['--base', '--head', '--event', '--output', '--summary', '--architecture-root', '--architecture-commit', '--architecture-digest', '--architecture-version'].includes(argument)) {
      const next = args[++index];
      if (!next || next.startsWith('--')) throw usageError(`${argument} requires a value`);
      const key = argument.slice(2).replace(/-([a-z])/g, (_match, letter) => letter.toUpperCase());
      value[key] = next;
    } else throw usageError(`Unknown argument: ${argument}`);
  }
  if (!value.base || !value.head) throw usageError('Both --base and --head are required');
  return value;
}

export async function runArchitectureReview(options) {
  const review = await deterministicReview({
    repositoryRoot: options.repositoryRoot ?? process.cwd(),
    base: options.base,
    head: options.head,
    eventPath: options.event,
    architectureRoot: options.architectureRoot,
    architectureCommit: options.architectureCommit,
    architectureDigest: options.architectureDigest,
    architectureVersion: options.architectureVersion,
  });

  if (options.semantic) {
    const { runSemanticReview } = await import('./lib/architecture-review-agent.mjs');
    review.semantic = await runSemanticReview({
      repositoryRoot: options.repositoryRoot ?? process.cwd(),
      review,
      eventPath: options.event,
    });
  }

  const markdown = formatReviewMarkdown(review);
  const output = options.output ?? process.env.ARCHITECTURE_REVIEW_OUTPUT;
  if (output) await writeFile(output, `${JSON.stringify(review, null, 2)}\n`, { mode: 0o600 });
  const summary = options.summary ?? process.env.GITHUB_STEP_SUMMARY;
  if (summary) await writeFile(summary, markdown, { flag: 'a', mode: 0o600 });
  return { ...review, markdown };
}

const isMainModule = process.argv[1]
  && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMainModule) {
  try {
    const options = parseArgs(process.argv.slice(2));
    const result = await runArchitectureReview(options);
    process.stdout.write(result.markdown);
    if (result.status === 'fail') process.exitCode = 1;
  } catch (error) {
    process.stderr.write(`${usage()}\n${error.message}\n`);
    process.exitCode = ['ERR_INVALID_ARG_VALUE', 'ENOENT', 'EACCES', 'EPERM'].includes(error.code) ? 2 : 1;
  }
}
