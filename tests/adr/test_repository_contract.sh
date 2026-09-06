#!/usr/bin/env bash
set -euo pipefail

TEST_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
REPO_ROOT=$(cd "$TEST_DIR/../.." && pwd)
DECISIONS_DIR="$REPO_ROOT/docs/decisions"
SMOKE_WORKFLOW="$REPO_ROOT/.github/workflows/self-hosted-runner-smoke.yml"
ISSUE_TEMPLATE="$REPO_ROOT/.github/ISSUE_TEMPLATE/architecture-decision.yml"

assert_file() {
  local path=$1
  if [[ ! -f "$path" ]]; then
    echo "expected file to exist: $path" >&2
    exit 1
  fi
}

assert_contains() {
  local needle=$1
  local path=$2
  if ! grep -Fq -- "$needle" "$path"; then
    echo "expected $path to contain: $needle" >&2
    exit 1
  fi
}

assert_file "$DECISIONS_DIR/README.md"
assert_file "$DECISIONS_DIR/adr-template.md"
assert_file "$ISSUE_TEMPLATE"
assert_contains 'The template intentionally lives beside README.md and the numbered records' "$DECISIONS_DIR/README.md"
assert_contains 'main' "$DECISIONS_DIR/README.md"
assert_contains 'sub-issue' "$DECISIONS_DIR/README.md"
for label in adr:needed adr:proposed adr:removal adr:rejected; do
  assert_contains "$label" "$DECISIONS_DIR/README.md"
done
assert_contains 'Do not add an `adr:accepted` label' "$DECISIONS_DIR/README.md"
assert_contains 'ADR operation' "$ISSUE_TEMPLATE"
assert_contains 'Create or update an ADR' "$ISSUE_TEMPLATE"
assert_contains 'Remove an existing ADR' "$ISSUE_TEMPLATE"
assert_contains 'adr:needed' "$ISSUE_TEMPLATE"

if grep -Eq '^status:' "$DECISIONS_DIR/adr-template.md"; then
  echo "ADR template must not define a status field" >&2
  exit 1
fi

for obsolete_file in \
  "$REPO_ROOT/.github/workflows/adr-approval-signal.yml" \
  "$REPO_ROOT/.github/workflows/adr-accept-on-approval.yml" \
  "$REPO_ROOT/scripts/accept-adr-on-approval.sh" \
  "$REPO_ROOT/scripts/accept-proposed-adr.sh"; do
  if [[ -e "$obsolete_file" ]]; then
    echo "obsolete ADR acceptance artifact still exists: $obsolete_file" >&2
    exit 1
  fi
done

assert_file "$SMOKE_WORKFLOW"
assert_contains 'workflow_dispatch:' "$SMOKE_WORKFLOW"
assert_contains 'runs-on: [self-hosted, linux, x64, omarchy]' "$SMOKE_WORKFLOW"
assert_contains 'uses: actions/checkout@fbc6f3992d24b796d5a048ff273f7fcc4a7b6c09' "$SMOKE_WORKFLOW"
assert_contains 'Verify dedicated runner' "$SMOKE_WORKFLOW"

printf 'Repository template and runner smoke contracts passed\n'
