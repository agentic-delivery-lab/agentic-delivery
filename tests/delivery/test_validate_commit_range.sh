#!/usr/bin/env bash
set -euo pipefail

TEST_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
REPO_ROOT=$(cd "$TEST_DIR/../.." && pwd)
RANGE_VALIDATOR="$REPO_ROOT/scripts/validate-commit-range.sh"

fixture_repo=$(mktemp -d)
cleanup() {
  if [[ -d "$fixture_repo" ]]; then
    rm -rf -- "$fixture_repo"
  fi
}
trap cleanup EXIT

mkdir -p "$fixture_repo/scripts"
cp "$RANGE_VALIDATOR" "$fixture_repo/scripts/validate-commit-range.sh"
cp "$REPO_ROOT/scripts/validate-gitmoji.mjs" "$fixture_repo/scripts/validate-gitmoji.mjs"
cp "$REPO_ROOT/commitlint.config.mjs" "$fixture_repo/commitlint.config.mjs"
cp "$REPO_ROOT/package.json" "$fixture_repo/package.json"
ln -s "$REPO_ROOT/node_modules" "$fixture_repo/node_modules"

git -C "$fixture_repo" init --quiet -b main
git -C "$fixture_repo" config user.name 'Delivery test'
git -C "$fixture_repo" config user.email 'delivery-test@example.invalid'

commit_file() {
  local file=$1
  local message=$2
  local message_file="$fixture_repo/.commit-message"

  printf '%s\n' "$message" > "$fixture_repo/$file"
  printf '%s\n' "$message" > "$message_file"
  git -C "$fixture_repo" add "$file"
  git -C "$fixture_repo" -c commit.gpgsign=false commit --quiet -F "$message_file"
  rm -f -- "$message_file"
}

run_range_status() {
  local status
  set +e
  "$fixture_repo/scripts/validate-commit-range.sh" "$@" >/dev/null 2>&1
  status=$?
  set -e
  printf '%s\n' "$status"
}

assert_status() {
  local expected=$1
  shift
  local actual
  actual=$(run_range_status "$@")
  if [[ "$actual" != "$expected" ]]; then
    printf 'expected range validator exit %s, got %s\n' "$expected" "$actual" >&2
    exit 1
  fi
}

commit_file initial.txt 'chore: 🧰 initialize delivery fixture'
base=$(git -C "$fixture_repo" rev-parse HEAD)
commit_file valid.txt 'feat(core): ✨ add a valid change'
valid_head=$(git -C "$fixture_repo" rev-parse HEAD)
assert_status 0 "$base" "$valid_head"

commit_file invalid.txt 'fix: repair a change without a gitmoji'
invalid_head=$(git -C "$fixture_repo" rev-parse HEAD)
assert_status 1 "$base" "$invalid_head"

git -C "$fixture_repo" checkout --quiet -b merge-test "$valid_head"
git -C "$fixture_repo" checkout --quiet -b side-branch
commit_file side.txt 'docs: 📝 document the side branch'
git -C "$fixture_repo" checkout --quiet merge-test
git -C "$fixture_repo" merge --quiet --no-ff side-branch -m "Merge branch 'side-branch' into merge-test"
merge_head=$(git -C "$fixture_repo" rev-parse HEAD)
assert_status 0 "$valid_head" "$merge_head"

assert_status 2 "$base" not-a-commit
assert_status 2 "$merge_head" "$base"
assert_status 2 "$base"

printf 'Commit-range validator tests passed.\n'
