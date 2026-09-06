#!/usr/bin/env bash
set -euo pipefail

TEST_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
REPO_ROOT=$(cd "$TEST_DIR/../.." && pwd)
STARTER="$REPO_ROOT/scripts/start-issue-branch.sh"
FAKE_BIN=$(mktemp -d)

cleanup() {
  rm -rf -- "$FAKE_BIN"
}
trap cleanup EXIT

cat >"$FAKE_BIN/gh" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail

if [[ ${1:-} == repo && ${2:-} == view ]]; then
  printf 'sjefsharp/agentic-delivery\n'
  exit 0
fi

if [[ ${1:-} == issue && ${2:-} == view ]]; then
  case ${3:-} in
    11) printf 'OPEN\thttps://github.com/sjefsharp/agentic-delivery/issues/11\n' ;;
    13) printf 'CLOSED\thttps://github.com/sjefsharp/agentic-delivery/issues/13\n' ;;
    *) printf 'not found\n' >&2; exit 1 ;;
  esac
  exit 0
fi

printf 'unexpected gh invocation\n' >&2
exit 1
EOF
chmod +x "$FAKE_BIN/gh"

new_fixture() {
  local fixture
  fixture=$(mktemp -d)
  mkdir -p "$fixture/scripts"
  cp "$REPO_ROOT/scripts/validate-branch-name.sh" "$fixture/scripts/validate-branch-name.sh"
  cp "$REPO_ROOT/scripts/validate-source-issue.sh" "$fixture/scripts/validate-source-issue.sh"
  cp "$STARTER" "$fixture/scripts/start-issue-branch.sh"
  git -C "$fixture" init --quiet -b main
  git -C "$fixture" config user.name 'Delivery test'
  git -C "$fixture" config user.email 'delivery-test@example.invalid'
  printf 'fixture\n' >"$fixture/README.md"
  git -C "$fixture" add README.md scripts
  git -C "$fixture" commit --quiet -m 'chore: 🧰 initialize branch fixture'
  git -C "$fixture" update-ref refs/remotes/origin/main HEAD
  printf '%s\n' "$fixture"
}

run_status() {
  local status
  set +e
  (cd "$1" && PATH="$FAKE_BIN:$PATH" ./scripts/start-issue-branch.sh "${@:2}") >/dev/null 2>&1
  status=$?
  set -e
  printf '%s\n' "$status"
}

valid_fixture=$(new_fixture)
if [[ "$(run_status "$valid_fixture" feat 11 branch-naming)" != 0 ]]; then
  printf 'expected a valid open issue branch to be created\n' >&2
  exit 1
fi
if [[ "$(git -C "$valid_fixture" branch --show-current)" != 'feat/issue-11-branch-naming' ]]; then
  printf 'expected the issue branch to become current\n' >&2
  exit 1
fi
rm -rf -- "$valid_fixture"

closed_fixture=$(new_fixture)
if [[ "$(run_status "$closed_fixture" feat 13 closed-work)" != 1 ]]; then
  printf 'expected a closed issue to block branch creation\n' >&2
  exit 1
fi
if [[ "$(git -C "$closed_fixture" branch --show-current)" != 'main' ]]; then
  printf 'closed issue changed the current branch\n' >&2
  exit 1
fi
rm -rf -- "$closed_fixture"

invalid_fixture=$(new_fixture)
if [[ "$(run_status "$invalid_fixture" feature 11 invalid-prefix)" != 1 ]]; then
  printf 'expected an invalid branch type to block branch creation\n' >&2
  exit 1
fi
if [[ "$(git -C "$invalid_fixture" branch --show-current)" != 'main' ]]; then
  printf 'invalid branch name changed the current branch\n' >&2
  exit 1
fi
rm -rf -- "$invalid_fixture"

dirty_fixture=$(new_fixture)
printf 'uncommitted\n' >"$dirty_fixture/dirty.txt"
if [[ "$(run_status "$dirty_fixture" feat 11 dirty-work)" != 1 ]]; then
  printf 'expected a dirty main branch to block branch creation\n' >&2
  exit 1
fi
if [[ "$(git -C "$dirty_fixture" branch --show-current)" != 'main' ]]; then
  printf 'dirty main branch changed the current branch\n' >&2
  exit 1
fi
rm -rf -- "$dirty_fixture"

printf 'Issue branch starter tests passed.\n'
