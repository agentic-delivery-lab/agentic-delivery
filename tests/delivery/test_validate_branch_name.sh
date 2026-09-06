#!/usr/bin/env bash
set -euo pipefail

TEST_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
REPO_ROOT=$(cd "$TEST_DIR/../.." && pwd)
VALIDATOR="$REPO_ROOT/scripts/validate-branch-name.sh"

assert_valid() {
  local branch_name=$1
  if ! "$VALIDATOR" "$branch_name" >/dev/null 2>&1; then
    printf 'expected branch name to be valid: %s\n' "$branch_name" >&2
    exit 1
  fi
}

assert_invalid() {
  local branch_name=$1
  if "$VALIDATOR" "$branch_name" >/dev/null 2>&1; then
    printf 'expected branch name to be invalid: %s\n' "$branch_name" >&2
    exit 1
  fi
}

assert_valid 'feat/issue-11-branch-naming'
assert_valid 'fix/issue-42-handle-2fa'
assert_valid 'docs/issue-7-delivery-workflow'
assert_valid 'ci/issue-1234-run-checks'

assert_invalid 'feature/issue-11-branch-naming'
assert_invalid 'feat/11-branch-naming'
assert_invalid 'feat/issue-0-branch-naming'
assert_invalid 'feat/issue-11-'
assert_invalid 'feat/issue-11-Branch-Naming'
assert_invalid 'feat/issue-11-branch--naming'
assert_invalid 'unknown/issue-11-branch-naming'
assert_invalid 'main'

printf 'Branch name validator tests passed.\n'
