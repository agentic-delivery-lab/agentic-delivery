#!/usr/bin/env bash
set -euo pipefail

TEST_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
REPO_ROOT=$(cd "$TEST_DIR/../.." && pwd)
SKILL="$REPO_ROOT/.agents/skills/plain-language-communication/SKILL.md"
AGENTS_FILE="$REPO_ROOT/AGENTS.md"
OPENAI_CONFIG="$REPO_ROOT/.agents/skills/plain-language-communication/agents/openai.yaml"

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

assert_not_contains() {
  local needle=$1
  local path=$2
  if grep -Fq -- "$needle" "$path"; then
    echo "$path must not contain: $needle" >&2
    exit 1
  fi
}

assert_file "$SKILL"
assert_file "$AGENTS_FILE"
assert_file "$OPENAI_CONFIG"

for phrase in \
  "Follow the user's language" \
  "Dutch when the language is mixed or unclear" \
  "plain English" \
  "relevant" \
  "findable" \
  "understandable" \
  "usable" \
  "user, task and context" \
  "feedback" \
  "technical terms" \
  "Do not claim ISO certification"; do
  assert_contains "$phrase" "$SKILL"
done

assert_contains 'plain-language-communication' "$SKILL"
assert_contains 'plain-language-communication' "$AGENTS_FILE"
assert_contains 'Follow the user' "$AGENTS_FILE"
assert_contains 'plain English' "$AGENTS_FILE"
assert_contains 'plain-language-communication' "$OPENAI_CONFIG"
assert_contains 'allow_implicit_invocation: true' "$OPENAI_CONFIG"
assert_contains 'Use $plain-language-communication' "$OPENAI_CONFIG"

assert_not_contains 'ISO certification' "$AGENTS_FILE"

printf 'Plain-language communication contracts passed\n'
