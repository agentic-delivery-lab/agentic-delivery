import process from 'node:process';
import { gitmojis } from 'gitmojis';

const mergeSubject = /^Merge(?: pull request| branch)\b/;
const conventionalHeader = /^[a-z]+(?:\([^()\n]+\))?!?: (.+)$/;
const officialEmoji = new Set(gitmojis.map(({ emoji }) => emoji));
const officialCode = new Set(gitmojis.map(({ code }) => code));

function fail(message) {
  process.stderr.write(`Gitmoji check: ${message}\n`);
  process.exitCode = 1;
}

let input = '';
for await (const chunk of process.stdin) {
  input += chunk;
}
input = input.replace(/^\uFEFF/, '');
const firstLine = input.split(/\r?\n/, 1)[0];

if (mergeSubject.test(firstLine)) {
  process.exit(0);
}

const match = firstLine.match(conventionalHeader);
if (!match) {
  fail('the first line must use a Conventional Commit prefix followed by a space');
} else {
  const rest = match[1];
  const tokenMatch = rest.match(/^(\S+)(?:\s+(.+))?$/);
  const token = tokenMatch?.[1];
  const description = tokenMatch?.[2]?.trim();

  if (!token || (!officialEmoji.has(token) && !officialCode.has(token))) {
    fail(`expected an official Gitmoji Unicode character or shortcode immediately after the prefix, got ${token ?? '<missing>'}`);
  } else if (!description) {
    fail('the Gitmoji must be followed by a non-empty description');
  }
}
