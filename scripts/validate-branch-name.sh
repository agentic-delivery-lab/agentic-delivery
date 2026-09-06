#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 1 ]]; then
  printf 'Usage: %s <branch-name>\n' "$0" >&2
  exit 2
fi

branch_name=$1
branch_pattern='^(build|chore|ci|docs|feat|fix|perf|refactor|revert|style|test)/issue-[1-9][0-9]*-[a-z0-9]+(-[a-z0-9]+)*$'

if [[ $branch_name =~ $branch_pattern ]]; then
  exit 0
fi

printf 'Invalid branch name: %s\n' "$branch_name" >&2
printf 'Expected <type>/issue-<number>-<lowercase-kebab-case-summary>.\n' >&2
exit 1
