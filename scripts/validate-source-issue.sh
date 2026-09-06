#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 1 || ! "$1" =~ ^[1-9][0-9]*$ ]]; then
  printf 'Usage: %s <open-issue-number>\n' "$0" >&2
  exit 2
fi

issue_number=$1
repository=${GITHUB_REPOSITORY:-}

if [[ -z "$repository" ]]; then
  if ! repository=$(gh repo view --json nameWithOwner --jq .nameWithOwner 2>/dev/null); then
    printf 'Source issue check failed: unable to determine the current GitHub repository.\n' >&2
    exit 1
  fi
fi

if [[ ! "$repository" =~ ^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$ ]]; then
  printf 'Source issue check failed: invalid repository identifier.\n' >&2
  exit 1
fi

issue_data=$(gh issue view "$issue_number" \
  --repo "$repository" \
  --json state,url \
  --jq '[.state, .url] | @tsv' 2>/dev/null) || {
  printf 'Source issue check failed: issue #%s could not be read in %s.\n' "$issue_number" "$repository" >&2
  exit 1
}

IFS=$'\t' read -r issue_state issue_url <<<"$issue_data"

if [[ "$issue_state" != OPEN ]]; then
  printf 'Source issue check failed: issue #%s is not open.\n' "$issue_number" >&2
  exit 1
fi

if [[ "$issue_url" != */issues/$issue_number ]]; then
  printf 'Source issue check failed: #%s is not a GitHub Issue in %s.\n' "$issue_number" "$repository" >&2
  exit 1
fi

printf 'Source issue #%s is open in %s.\n' "$issue_number" "$repository"
