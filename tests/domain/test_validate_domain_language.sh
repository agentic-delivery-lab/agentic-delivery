#!/usr/bin/env bash
set -euo pipefail

TEST_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
REPO_ROOT=$(cd "$TEST_DIR/../.." && pwd)
VALIDATOR="$REPO_ROOT/scripts/validate-domain-language.rb"
FIXTURES_DIR="$TEST_DIR/fixtures"

pass_count=0
reject_count=0

run_status() {
  local status
  set +e
  "$@" >/dev/null 2>&1
  status=$?
  set -e
  printf '%s\n' "$status"
}

assert_status() {
  local expected=$1
  shift
  local actual
  actual=$(run_status "$@")
  if [[ "$actual" != "$expected" ]]; then
    echo "expected exit $expected, got $actual: $*" >&2
    exit 1
  fi
}

new_fixture_root() {
  local fixture_file=$1
  local fixture_root
  fixture_root=$(mktemp -d)
  mkdir -p "$fixture_root/docs/domain"
  cp "$fixture_file" "$fixture_root/docs/domain/ubiquitous-language.yml"
  printf '%s\n' "$fixture_root"
}

cleanup() {
  if [[ -n "${fixture_root:-}" && -d "$fixture_root" ]]; then
    rm -rf -- "$fixture_root"
  fi
}
trap cleanup EXIT

assert_status 0 "$VALIDATOR" "$REPO_ROOT"
pass_count=$((pass_count + 1))

for fixture_file in "$FIXTURES_DIR"/*.yml; do
  fixture_name=$(basename "$fixture_file")
  fixture_root=$(new_fixture_root "$fixture_file")
  if [[ "$fixture_name" == valid.yml ]]; then
    assert_status 0 "$VALIDATOR" "$fixture_root"
    pass_count=$((pass_count + 1))
  else
    assert_status 1 "$VALIDATOR" "$fixture_root"
    reject_count=$((reject_count + 1))
  fi
  cleanup
  unset fixture_root
done

fixture_root=$(mktemp -d)
assert_status 2 "$VALIDATOR" "$fixture_root"
cleanup
unset fixture_root

assert_status 2 "$VALIDATOR" "$REPO_ROOT" unexpected-argument

printf 'Domain-language validator tests passed: %d accepted, %d rejected\n' "$pass_count" "$reject_count"
