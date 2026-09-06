#!/usr/bin/env bash
set -euo pipefail

TEST_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
REPO_ROOT=$(cd "$TEST_DIR/../.." && pwd)
VALIDATOR="$REPO_ROOT/scripts/validate-changelog.rb"
FIXTURES_DIR="$TEST_DIR/fixtures/changelogs"

run_status() {
  local status
  set +e
  "$@" >/dev/null 2>&1
  status=$?
  set -e
  printf '%s\n' "$status"
}

assert_fixture_status() {
  local expected=$1
  local fixture_name=$2
  local root
  local actual

  root=$(mktemp -d)
  cp "$FIXTURES_DIR/$fixture_name" "$root/CHANGELOG.md"
  actual=$(run_status "$VALIDATOR" "$root")
  rm -rf -- "$root"

  if [[ "$actual" != "$expected" ]]; then
    printf 'expected %s to return exit %s, got %s\n' "$fixture_name" "$expected" "$actual" >&2
    exit 1
  fi
}

assert_fixture_status 0 valid.md
assert_fixture_status 0 unreleased-only.md

for fixture_name in \
  missing-unreleased.md \
  duplicate-unreleased.md \
  duplicate-release.md \
  invalid-category.md \
  invalid-semver.md \
  invalid-date.md \
  invalid-order.md \
  invalid-date-order.md \
  category-before-release.md; do
  assert_fixture_status 1 "$fixture_name"
done

missing_root=$(mktemp -d)
if [[ "$(run_status "$VALIDATOR" "$missing_root")" != 2 ]]; then
  printf 'expected a missing CHANGELOG.md to return exit 2\n' >&2
  exit 1
fi
rm -rf -- "$missing_root"

if [[ "$(run_status "$VALIDATOR" "$REPO_ROOT" unexpected-argument)" != 2 ]]; then
  printf 'expected incorrect validator usage to return exit 2\n' >&2
  exit 1
fi

printf 'Changelog validator tests passed.\n'
