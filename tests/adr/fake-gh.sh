#!/usr/bin/env bash
set -euo pipefail

if [[ ${1:-} != api ]]; then
  echo 'fake gh only supports gh api' >&2
  exit 2
fi
shift

method=GET
endpoint=
read_method=0
for argument in "$@"; do
  if [[ "$argument" == '--method' ]]; then
    read_method=1
  elif [[ "$read_method" -eq 1 ]]; then
    method=$argument
    read_method=0
  elif [[ "$argument" == repos/* ]]; then
    endpoint=$argument
  fi
done

if [[ -z "$endpoint" ]]; then
  echo 'fake gh received no API endpoint' >&2
  exit 2
fi

endpoint_without_query=${endpoint%%\?*}
scenario=${FAKE_GH_SCENARIO:-success}

case "$method:$endpoint_without_query" in
  GET:repos/owner/repo/actions/runs/42)
    printf '%s\n' '{"event":"pull_request_review","conclusion":"success","pull_requests":[{"number":7}]}'
    ;;
  GET:repos/owner/repo)
    printf '%s\n' '{"default_branch":"main"}'
    ;;
  GET:repos/owner/repo/pulls/7)
    if [[ "$scenario" == fork ]]; then
      printf '%s\n' '{"state":"open","base":{"ref":"main"},"head":{"ref":"feature/adr","sha":"head-sha","repo":{"full_name":"other/repo"}},"user":{"login":"author"}}'
    else
      printf '%s\n' '{"state":"open","base":{"ref":"main"},"head":{"ref":"feature/adr","sha":"head-sha","repo":{"full_name":"owner/repo"}},"user":{"login":"author"}}'
    fi
    ;;
  GET:repos/owner/repo/pulls/7/reviews)
    if [[ "$scenario" == no-approval ]]; then
      printf '%s\n' '[[]]'
    else
      printf '%s\n' '[[{"state":"APPROVED","commit_id":"head-sha","submitted_at":"2026-09-06T00:00:00Z","user":{"login":"reviewer"}}]]'
    fi
    ;;
  GET:repos/owner/repo/pulls/7/files)
    if [[ "$scenario" == multiple ]]; then
      printf '%s\n' '[[{"filename":"docs/decisions/0001-use-madr-for-architecture-decisions.md"},{"filename":"docs/decisions/0002-another-decision.md"}]]'
    else
      printf '%s\n' '[[{"filename":"docs/decisions/0001-use-madr-for-architecture-decisions.md"}]]'
    fi
    ;;
  GET:repos/owner/repo/contents/docs/decisions/0001-use-madr-for-architecture-decisions.md)
    encoded_content=$(base64 -w0 "$FAKE_GH_ADR_FILE")
    printf '{"sha":"file-sha","content":"%s"}\n' "$encoded_content"
    ;;
  PUT:repos/owner/repo/contents/docs/decisions/0001-use-madr-for-architecture-decisions.md)
    printf '%s\n' "$*" >>"$FAKE_GH_CALLS"
    printf '%s\n' '{}'
    ;;
  *)
    echo "fake gh has no response for $method $endpoint_without_query" >&2
    exit 2
    ;;
esac
