import process from 'node:process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gitmojis } from 'gitmojis';

const mergeSubject = /^Merge(?: pull request| branch)\b/;
const conventionalHeader = /^[a-z]+(?:\([^()\n]+\))?!?: (.+)$/;
// Some terminals and commit editors omit the optional emoji variation
// selector. Compare the catalogue and input after removing that selector so
// the same visible Gitmoji is accepted in either Unicode representation.
const officialEmoji = new Set(gitmojis.map(({ emoji }) => emoji.replace(/\uFE0F/g, '')));
const officialCode = new Set(gitmojis.map(({ code }) => code));

export class GitmojiValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'GitmojiValidationError';
    this.exitCode = 1;
  }
}

export function validateGitmojiMessage(input) {
  const normalizedInput = input.replace(/^\uFEFF/, '');
  const firstLine = normalizedInput.split(/\r?\n/, 1)[0];

  if (mergeSubject.test(firstLine)) return true;

  const match = firstLine.match(conventionalHeader);
  if (!match) {
    throw new GitmojiValidationError('the first line must use a Conventional Commit prefix followed by a space');
  }

  const rest = match[1];
  const tokenMatch = rest.match(/^(\S+)(?:\s+(.+))?$/);
  const token = tokenMatch?.[1];
  const description = tokenMatch?.[2]?.trim();

  const normalizedToken = token?.replace(/\uFE0F/g, '');
  if (!token || (!officialEmoji.has(normalizedToken) && !officialCode.has(token))) {
    throw new GitmojiValidationError(
      `expected an official Gitmoji Unicode character or shortcode immediately after the prefix, got ${token ?? '<missing>'}`,
    );
  }
  if (!description) throw new GitmojiValidationError('the Gitmoji must be followed by a non-empty description');
  return true;
}

const isMainModule = process.argv[1]
  && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMainModule) {
  let input = '';
  for await (const chunk of process.stdin) input += chunk;
  try {
    validateGitmojiMessage(input);
  } catch (error) {
    process.stderr.write(`Gitmoji check: ${error.message}\n`);
    process.exitCode = error.exitCode ?? 1;
  }
}
