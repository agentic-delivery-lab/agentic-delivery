#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 3 ]]; then
  printf 'Usage: %s <type> <issue-number> <summary>\n' "$0" >&2
  exit 2
fi

branch_type=$1
issue_number=$2
summary=$3
script_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)
repository_root=$(cd "$script_dir/.." && pwd -P)
branch_name="$branch_type/issue-$issue_number-$summary"

if ! git -C "$repository_root" rev-parse --git-dir >/dev/null 2>&1; then
  printf 'Branch start failed: repository root is not a Git repository.\n' >&2
  exit 2
fi

current_branch=$(git -C "$repository_root" branch --show-current)
if [[ "$current_branch" != main ]]; then
  printf 'Branch start failed: start from the main branch, currently on %s.\n' "${current_branch:-detached HEAD}" >&2
  exit 1
fi

if [[ -n $(git -C "$repository_root" status --porcelain) ]]; then
  printf 'Branch start failed: main has uncommitted changes.\n' >&2
  exit 1
fi

if git -C "$repository_root" show-ref --verify --quiet refs/remotes/origin/main; then
  local_head=$(git -C "$repository_root" rev-parse HEAD)
  remote_head=$(git -C "$repository_root" rev-parse refs/remotes/origin/main)
  if [[ "$local_head" != "$remote_head" ]]; then
    printf 'Branch start failed: local main is not synchronized with origin/main.\n' >&2
    exit 1
  fi
fi

if ! "$script_dir/validate-branch-name.sh" "$branch_name" >/dev/null; then
  exit 1
fi

if ! "$script_dir/validate-source-issue.sh" "$issue_number" >/dev/null; then
  exit 1
fi

git -C "$repository_root" switch -c "$branch_name"
printf 'Created and switched to %s.\n' "$branch_name"
