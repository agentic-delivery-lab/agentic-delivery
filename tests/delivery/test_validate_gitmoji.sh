#!/usr/bin/env bash
set -euo pipefail

TEST_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
REPO_ROOT=$(cd "$TEST_DIR/../.." && pwd)
VALIDATOR="$REPO_ROOT/scripts/validate-gitmoji.mjs"

run_status() {
  local status
  set +e
  printf '%s\n' "$1" | node "$VALIDATOR" >/dev/null 2>&1
  status=$?
  set -e
  printf '%s\n' "$status"
}

assert_valid() {
  local message=$1
  local status
  status=$(run_status "$message")
  if [[ "$status" != 0 ]]; then
    printf 'expected valid commit message, got exit %s: %s\n' "$status" "$message" >&2
    exit 1
  fi
}

assert_invalid() {
  local message=$1
  local status
  status=$(run_status "$message")
  if [[ "$status" != 1 ]]; then
    printf 'expected invalid commit message, got exit %s: %s\n' "$status" "$message" >&2
    exit 1
  fi
}

assert_valid 'feat: ✨ add context-aware delivery checks'
assert_valid 'fix(parser)!: :bug: repair commit parsing'
assert_valid $'docs: 📝 update the guide\n\nExplain the migration path.'
assert_valid 'Merge pull request #6 from example/feature'
assert_valid "Merge branch 'feature' into main"

assert_invalid 'feat: add a description without a gitmoji'
assert_invalid '✨ feat: add an emoji before the conventional prefix'
assert_invalid 'feat: :not-an-official-gitmoji: add a description'
assert_invalid 'feat: ✨add a description without a separator'
assert_invalid 'feat: :sparkles: '
assert_invalid 'Add a description without a conventional prefix'

printf 'Gitmoji validator tests passed.\n'
