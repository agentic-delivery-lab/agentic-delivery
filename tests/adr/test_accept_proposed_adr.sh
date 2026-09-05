#!/usr/bin/env bash
set -euo pipefail

TEST_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
REPO_ROOT=$(cd "$TEST_DIR/../.." && pwd)
ACCEPTOR="$REPO_ROOT/scripts/accept-proposed-adr.sh"
SOURCE_ADR="$REPO_ROOT/docs/decisions/0001-use-madr-for-architecture-decisions.md"

pass_count=0
fail_count=0

new_fixture() {
  local fixture
  fixture=$(mktemp -d)
  cp "$SOURCE_ADR" "$fixture/adr.md"
  printf '%s\n' "$fixture"
}

cleanup() {
  if [[ -n "${fixture:-}" && -d "$fixture" ]]; then
    rm -rf -- "$fixture"
  fi
}
trap cleanup EXIT

assert_accepts() {
  local fixture=$1
  local accepted_date=$2
  if "$ACCEPTOR" "$fixture/adr.md" "$accepted_date" >/dev/null; then
    pass_count=$((pass_count + 1))
  else
    echo "expected ADR acceptance to pass: $fixture/adr.md" >&2
    exit 1
  fi
}

assert_rejects() {
  local fixture=$1
  if "$ACCEPTOR" "$fixture/adr.md" 2026-09-06 >/dev/null 2>&1; then
    echo "expected ADR acceptance to fail: $fixture/adr.md" >&2
    exit 1
  else
    fail_count=$((fail_count + 1))
  fi
}

fixture=$(new_fixture)
assert_accepts "$fixture" 2026-09-06
grep -Fqx 'status: accepted' "$fixture/adr.md"
grep -Fqx 'date: 2026-09-05' <(sed -n '1,12p' "$fixture/adr.md")
cleanup
unset fixture

fixture=$(new_fixture)
sed -i 's/^status: proposed$/status: accepted/' "$fixture/adr.md"
assert_accepts "$fixture" 2026-09-06
grep -Fqx 'status: accepted' "$fixture/adr.md"
cleanup
unset fixture

fixture=$(new_fixture)
sed -i 's/^status: proposed$/status: undecided/' "$fixture/adr.md"
assert_rejects "$fixture"
cleanup
unset fixture

fixture=$(new_fixture)
sed -i '/^status: proposed$/d' "$fixture/adr.md"
assert_rejects "$fixture"
cleanup
unset fixture

fixture=$(new_fixture)
sed -i '/^status: proposed$/a status: proposed' "$fixture/adr.md"
assert_rejects "$fixture"
cleanup
unset fixture

printf 'ADR acceptance tests passed: %d positive, %d negative\n' "$pass_count" "$fail_count"
