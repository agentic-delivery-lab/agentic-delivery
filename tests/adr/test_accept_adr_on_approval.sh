#!/usr/bin/env bash
set -euo pipefail

TEST_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
REPO_ROOT=$(cd "$TEST_DIR/../.." && pwd)
ORCHESTRATOR="$REPO_ROOT/scripts/accept-adr-on-approval.sh"
SOURCE_ADR="$REPO_ROOT/docs/decisions/0001-use-madr-for-architecture-decisions.md"
FAKE_GH="$TEST_DIR/fake-gh.sh"

pass_count=0
fail_count=0

run_case() {
  local scenario=$1
  local expected_exit=$2
  local fixture
  local result=0

  fixture=$(mktemp -d)
  mkdir "$fixture/bin"
  cp "$SOURCE_ADR" "$fixture/adr.md"
  if [[ "$scenario" == 'already-accepted' ]]; then
    sed -i 's/^status: proposed$/status: accepted/' "$fixture/adr.md"
  fi
  : >"$fixture/calls"
  ln -s "$FAKE_GH" "$fixture/bin/gh"

  set +e
  PATH="$fixture/bin:$PATH" \
    GH_TOKEN=test-token \
    GITHUB_REPOSITORY=owner/repo \
    WORKFLOW_RUN_ID=42 \
    ACCEPTANCE_DATE=2026-09-06 \
    FAKE_GH_SCENARIO="$scenario" \
    FAKE_GH_ADR_FILE="$fixture/adr.md" \
    FAKE_GH_CALLS="$fixture/calls" \
    "$ORCHESTRATOR" >/dev/null 2>&1
  result=$?
  set -e

  if [[ "$result" -ne "$expected_exit" ]]; then
    echo "expected $scenario to exit $expected_exit, got $result" >&2
    exit 1
  fi
  printf '%s\n' "$scenario" >>"$fixture/result"
  printf '%s\n' "$fixture"
}

fixture=$(run_case success 0)
grep -Fq -- '--method PUT' "$fixture/calls"
grep -Fq -- 'sha=file-sha' "$fixture/calls"
grep -Fq -- 'branch=feature/adr' "$fixture/calls"
pass_count=$((pass_count + 1))
rm -rf -- "$fixture"

fixture=$(run_case no-approval 0)
if grep -Fq -- '--method PUT' "$fixture/calls"; then
  echo 'no-approval case must not update an ADR' >&2
  exit 1
fi
pass_count=$((pass_count + 1))
rm -rf -- "$fixture"

fixture=$(run_case fork 0)
if grep -Fq -- '--method PUT' "$fixture/calls"; then
  echo 'fork case must not update an ADR' >&2
  exit 1
fi
pass_count=$((pass_count + 1))
rm -rf -- "$fixture"

fixture=$(run_case already-accepted 0)
if grep -Fq -- '--method PUT' "$fixture/calls"; then
  echo 'already-accepted case must be idempotent' >&2
  exit 1
fi
pass_count=$((pass_count + 1))
rm -rf -- "$fixture"

fixture=$(run_case multiple 1)
if grep -Fq -- '--method PUT' "$fixture/calls"; then
  echo 'multiple ADR case must not update an ambiguous record' >&2
  exit 1
fi
fail_count=$((fail_count + 1))
rm -rf -- "$fixture"

printf 'ADR approval orchestration tests passed: %d positive, %d guarded failures\n' "$pass_count" "$fail_count"
