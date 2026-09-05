#!/usr/bin/env bash
set -euo pipefail

TEST_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
REPO_ROOT=$(cd "$TEST_DIR/../.." && pwd)
VALIDATOR="$REPO_ROOT/scripts/validate-adrs.sh"
SOURCE_ADR="$REPO_ROOT/docs/decisions/0001-use-madr-for-architecture-decisions.md"

pass_count=0
fail_count=0

assert_passes() {
  local fixture=$1
  if "$VALIDATOR" "$fixture" >/dev/null 2>&1; then
    pass_count=$((pass_count + 1))
  else
    echo "expected validator to pass: $fixture" >&2
    exit 1
  fi
}

assert_fails() {
  local fixture=$1
  if "$VALIDATOR" "$fixture" >/dev/null 2>&1; then
    echo "expected validator to fail: $fixture" >&2
    exit 1
  else
    fail_count=$((fail_count + 1))
  fi
}

new_fixture() {
  local fixture
  fixture=$(mktemp -d)
  mkdir -p "$fixture/docs"
  cp -R "$REPO_ROOT/docs/decisions" "$fixture/docs/decisions"
  printf '%s\n' "$fixture"
}

cleanup() {
  if [[ -n "${fixture:-}" && -d "$fixture" ]]; then
    rm -rf -- "$fixture"
  fi
}
trap cleanup EXIT

fixture=$(new_fixture)
assert_passes "$fixture"
cleanup
unset fixture

fixture=$(new_fixture)
sed -i 's/^status: proposed$/status: undecided/' "$fixture/docs/decisions/0001-use-madr-for-architecture-decisions.md"
assert_fails "$fixture"
cleanup
unset fixture

fixture=$(new_fixture)
sed -i '/^### Confirmation$/d' "$fixture/docs/decisions/0001-use-madr-for-architecture-decisions.md"
assert_fails "$fixture"
cleanup
unset fixture

fixture=$(new_fixture)
cp "$SOURCE_ADR" "$fixture/docs/decisions/0001-duplicate.md"
assert_fails "$fixture"
cleanup
unset fixture

fixture=$(new_fixture)
mv "$fixture/docs/decisions/0001-use-madr-for-architecture-decisions.md" "$fixture/docs/decisions/0002-use-madr-for-architecture-decisions.md"
assert_fails "$fixture"
cleanup
unset fixture

fixture=$(new_fixture)
sed -i 's#^source-issue:.*#source-issue: not-a-github-issue#' "$fixture/docs/decisions/0001-use-madr-for-architecture-decisions.md"
assert_fails "$fixture"
cleanup
unset fixture

printf 'ADR validator tests passed: %d positive, %d negative\n' "$pass_count" "$fail_count"
