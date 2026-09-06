#!/usr/bin/env bash
set -euo pipefail

TEST_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
REPO_ROOT=$(cd "$TEST_DIR/../.." && pwd)
VALIDATOR="$REPO_ROOT/scripts/validate-source-issue.sh"
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
    11|12) printf 'OPEN\thttps://github.com/sjefsharp/agentic-delivery/issues/%s\n' "$3" ;;
    13) printf 'CLOSED\thttps://github.com/sjefsharp/agentic-delivery/issues/13\n' ;;
    14) printf 'OPEN\thttps://github.com/sjefsharp/agentic-delivery/pull/14\n' ;;
    99) printf 'not found\n' >&2; exit 1 ;;
    100) printf 'authentication failed\n' >&2; exit 1 ;;
    *) printf 'unexpected issue number\n' >&2; exit 1 ;;
  esac
  exit 0
fi

printf 'unexpected gh invocation\n' >&2
exit 1
EOF
chmod +x "$FAKE_BIN/gh"

cat >"$FAKE_BIN/curl" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail

case "$*" in
  *'/issues/15') printf '{"state":"open","html_url":"https://github.com/sjefsharp/agentic-delivery/issues/15"}\n' ;;
  *'/issues/16') printf '{"state":"closed","html_url":"https://github.com/sjefsharp/agentic-delivery/issues/16"}\n' ;;
  *'/issues/17') printf '{"state":"open","html_url":"https://github.com/sjefsharp/agentic-delivery/pull/17"}\n' ;;
  *'/issues/99') printf 'service unavailable\n' >&2; exit 1 ;;
  *) printf 'unexpected curl invocation\n' >&2; exit 1 ;;
esac
EOF
chmod +x "$FAKE_BIN/curl"

run_status() {
  local status
  set +e
  env -u GITHUB_ACTIONS -u GH_TOKEN -u GITHUB_REPOSITORY \
    PATH="$FAKE_BIN:$PATH" "$VALIDATOR" "$@" >/dev/null 2>&1
  status=$?
  set -e
  printf '%s\n' "$status"
}

run_api_status() {
  local status
  set +e
  GITHUB_ACTIONS=true GH_TOKEN=test-token GITHUB_REPOSITORY=sjefsharp/agentic-delivery \
    PATH="$FAKE_BIN:$PATH" "$VALIDATOR" "$@" >/dev/null 2>&1
  status=$?
  set -e
  printf '%s\n' "$status"
}

if [[ "$(run_status 11)" != 0 || "$(run_status 12)" != 0 ]]; then
  printf 'expected open issue and sub-issue to pass\n' >&2
  exit 1
fi

for issue_number in 13 14 99 100; do
  if [[ "$(run_status "$issue_number")" != 1 ]]; then
    printf 'expected issue %s to fail closed\n' "$issue_number" >&2
    exit 1
  fi
done

if [[ "$(run_api_status 15)" != 0 ]]; then
  printf 'expected the CI REST API path to accept an open issue\n' >&2
  exit 1
fi

for issue_number in 16 17 99; do
  if [[ "$(run_api_status "$issue_number")" != 1 ]]; then
    printf 'expected the CI REST API path to reject issue %s\n' "$issue_number" >&2
    exit 1
  fi
done

if [[ "$(GITHUB_ACTIONS=true GITHUB_REPOSITORY=sjefsharp/agentic-delivery run_status 15)" != 1 ]]; then
  printf 'expected CI validation without a token to fail closed\n' >&2
  exit 1
fi

if [[ "$(run_status 0)" != 2 || "$(run_status 11 extra)" != 2 ]]; then
  printf 'expected invalid usage to return exit 2\n' >&2
  exit 1
fi

printf 'Source issue validator tests passed.\n'
