#!/usr/bin/env bash
set -euo pipefail

TEST_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
REPO_ROOT=$(cd "$TEST_DIR/../.." && pwd)
SKILL="$REPO_ROOT/.agents/skills/architecture-decision/SKILL.md"

assert_contains() {
  local needle=$1
  if ! grep -Fq -- "$needle" "$SKILL"; then
    echo "expected architecture-decision skill to contain: $needle" >&2
    exit 1
  fi
}

assert_not_contains() {
  local needle=$1
  if grep -Fq -- "$needle" "$SKILL"; then
    echo "architecture-decision skill must not contain: $needle" >&2
    exit 1
  fi
}

assert_contains '## Source issue intake'
assert_contains 'read-only search'
assert_contains 'gh issue list'
assert_contains 'preview'
assert_contains 'explicit confirmation'
assert_contains 'gh issue create'
assert_contains 'inaccessible'
assert_contains 'Do not create a replacement issue'
assert_contains 'duplicate'
assert_contains 'issue form'
assert_contains 'source-issue'
assert_contains 'questions as comments on the source issue'
assert_contains 'stop until the answers are available'
assert_contains 'secrets'
assert_contains 'Do not guess the repository'
assert_not_contains 'stop and ask for the missing information'

printf 'Architecture-decision source issue intake contract passed\n'
