#!/usr/bin/env bash
set -euo pipefail

TEST_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
REPO_ROOT=$(cd "$TEST_DIR/../.." && pwd)
SKILL="$REPO_ROOT/.agents/skills/architecture-decision/SKILL.md"

assert_contains() {
  local needle=$1
  if ! grep -Fq -- "$needle" "$SKILL"; then
    echo "expected this text in the architecture-decision skill: $needle" >&2
    exit 1
  fi
}

assert_not_contains() {
  local needle=$1
  if grep -Fq -- "$needle" "$SKILL"; then
    echo "the architecture-decision skill must not contain: $needle" >&2
    exit 1
  fi
}

assert_contains '## Source issue intake'
assert_contains 'read-only search'
assert_contains 'gh issue list'
assert_contains 'Present any likely candidate for confirmation before using it.'
assert_contains 'If the search fails because of missing tooling, authentication or connectivity'
assert_contains 'Do not treat a failed search as no match'
assert_contains 'preview'
assert_contains 'explicit confirmation'
assert_contains 'gh issue create'
assert_contains 'Re-run the read-only search immediately before creation'
assert_contains 'check that the available user context can fill the required issue-form fields'
assert_contains 'do not create a partial issue'
assert_contains 'If a new candidate appears, return to candidate confirmation.'
assert_contains 'inaccessible'
assert_contains 'Do not create a replacement issue'
assert_contains 'duplicate'
assert_contains 'issue form'
assert_contains 'source-issue'
assert_contains 'questions as comments on the source issue'
assert_contains 'only when issue communication is explicitly authorized'
assert_contains 'Otherwise show the questions for confirmation before posting.'
assert_contains 'stop until the answers are available'
assert_contains 'If the user declines to answer or to create/comment, do not continue to the ADR.'
assert_contains 'secrets'
assert_contains 'Do not guess the repository'
assert_contains 'not automatically an ADR'
assert_contains 'sub-issue'
assert_contains 'feature branch'
assert_contains 'canonical context'
assert_contains 'without a status field'
assert_contains 'remove'
assert_contains 'update the source issue'
assert_contains 'Closes #'
assert_contains 'Approval alone does not close'
assert_contains 'broader parent'
assert_not_contains 'status: proposed'
assert_not_contains 'workflow_run'
assert_not_contains 'acceptance helper'
assert_not_contains 'stop and ask for the missing information'

printf 'Architecture-decision issue intake contract passed\n'
