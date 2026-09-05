#!/usr/bin/env bash
set -euo pipefail

export LC_ALL=C

: "${GITHUB_REPOSITORY:?GITHUB_REPOSITORY is required}"
: "${WORKFLOW_RUN_ID:?WORKFLOW_RUN_ID is required}"
: "${GH_TOKEN:?GH_TOKEN is required}"

script_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)
repository=$GITHUB_REPOSITORY
acceptance_date=${ACCEPTANCE_DATE:-$(date -u +%F)}

for command in gh jq base64; do
  if ! command -v "$command" >/dev/null 2>&1; then
    printf 'ADR acceptance: required command is missing: %s\n' "$command" >&2
    exit 2
  fi
done

if ! [[ "$repository" =~ ^[^/[:space:]]+/[^/[:space:]]+$ ]]; then
  printf 'ADR acceptance: invalid repository name: %s\n' "$repository" >&2
  exit 2
fi

workflow_run_json=$(gh api "repos/$repository/actions/runs/$WORKFLOW_RUN_ID")
workflow_event=$(jq -r '.event // empty' <<<"$workflow_run_json")
workflow_conclusion=$(jq -r '.conclusion // empty' <<<"$workflow_run_json")
if [[ "$workflow_event" != 'pull_request_review' || "$workflow_conclusion" != 'success' ]]; then
  printf 'ADR acceptance: ignoring workflow run %s (%s/%s)\n' "$WORKFLOW_RUN_ID" "$workflow_event" "$workflow_conclusion"
  exit 0
fi

mapfile -t pull_request_numbers < <(jq -r '.pull_requests[]?.number // empty' <<<"$workflow_run_json")
if [[ ${#pull_request_numbers[@]} -ne 1 ]]; then
  printf 'ADR acceptance: expected one pull request in workflow run %s\n' "$WORKFLOW_RUN_ID" >&2
  exit 1
fi
if ! [[ "${pull_request_numbers[0]}" =~ ^[0-9]+$ ]]; then
  printf 'ADR acceptance: workflow run %s contains an invalid pull request number\n' "$WORKFLOW_RUN_ID" >&2
  exit 1
fi
pull_request_number=${pull_request_numbers[0]}

repository_json=$(gh api "repos/$repository")
default_branch=$(jq -r '.default_branch // empty' <<<"$repository_json")
if [[ -z "$default_branch" ]]; then
  printf 'ADR acceptance: repository has no default branch: %s\n' "$repository" >&2
  exit 1
fi

pull_request_json=$(gh api "repos/$repository/pulls/$pull_request_number")
pull_request_state=$(jq -r '.state // empty' <<<"$pull_request_json")
base_branch=$(jq -r '.base.ref // empty' <<<"$pull_request_json")
head_branch=$(jq -r '.head.ref // empty' <<<"$pull_request_json")
head_sha=$(jq -r '.head.sha // empty' <<<"$pull_request_json")
head_repository=$(jq -r '.head.repo.full_name // empty' <<<"$pull_request_json")
author_login=$(jq -r '.user.login // empty' <<<"$pull_request_json")

if [[ "$pull_request_state" != 'open' || "$base_branch" != "$default_branch" ]]; then
  printf 'ADR acceptance: pull request #%s is not an open pull request targeting %s\n' "$pull_request_number" "$default_branch"
  exit 0
fi
if [[ "$head_repository" != "$repository" || -z "$head_branch" || -z "$head_sha" ]]; then
  printf 'ADR acceptance: pull request #%s is not a same-repository branch; leaving ADR proposed\n' "$pull_request_number"
  exit 0
fi

reviews_json=$(gh api --paginate --slurp "repos/$repository/pulls/$pull_request_number/reviews?per_page=100")
latest_reviews=$(jq -c --arg head_sha "$head_sha" --arg author_login "$author_login" '
  [.[][]?
   | select((.commit_id // "") == $head_sha)
   | select((.user.login // "") != $author_login)]
  | sort_by(.submitted_at // "")
  | group_by(.user.login // "")
  | map(last)
' <<<"$reviews_json")
approved_reviews=$(jq '[.[] | select(.state == "APPROVED")] | length' <<<"$latest_reviews")
blocking_reviews=$(jq '[.[] | select(.state == "CHANGES_REQUESTED")] | length' <<<"$latest_reviews")
if [[ "$approved_reviews" -lt 1 || "$blocking_reviews" -gt 0 ]]; then
  printf 'ADR acceptance: pull request #%s has no current, unblocked approval\n' "$pull_request_number"
  exit 0
fi

files_json=$(gh api --paginate --slurp "repos/$repository/pulls/$pull_request_number/files?per_page=100")
adr_pattern='^docs/decisions/[0-9]{4}-[a-z0-9]+([a-z0-9-]*[a-z0-9])?\.md$'
mapfile -t adr_paths < <(jq -r --arg pattern "$adr_pattern" '.[][]? | .filename? // empty | select(test($pattern))' <<<"$files_json")
if [[ ${#adr_paths[@]} -eq 0 ]]; then
  printf 'ADR acceptance: pull request #%s does not change an ADR; nothing to do\n' "$pull_request_number"
  exit 0
fi
if [[ ${#adr_paths[@]} -ne 1 ]]; then
  printf 'ADR acceptance: pull request #%s changes %d ADR files; refusing an ambiguous update\n' "$pull_request_number" "${#adr_paths[@]}" >&2
  exit 1
fi
adr_path=${adr_paths[0]}

content_json=$(gh api "repos/$repository/contents/$adr_path?ref=$head_sha")
file_sha=$(jq -r '.sha // empty' <<<"$content_json")
encoded_content=$(jq -r '.content // empty' <<<"$content_json" | tr -d '\r\n')
if [[ -z "$file_sha" || -z "$encoded_content" ]]; then
  printf 'ADR acceptance: could not retrieve %s at %s\n' "$adr_path" "$head_sha" >&2
  exit 1
fi

work_dir=$(mktemp -d)
cleanup() {
  rm -rf -- "$work_dir"
}
trap cleanup EXIT

original_file="$work_dir/original.md"
updated_file="$work_dir/updated.md"
printf '%s' "$encoded_content" | base64 --decode >"$original_file"
cp "$original_file" "$updated_file"
"$script_dir/accept-proposed-adr.sh" "$updated_file" "$acceptance_date" >/dev/null
if cmp -s "$original_file" "$updated_file"; then
  printf 'ADR acceptance: %s is already accepted; no commit needed\n' "$adr_path"
  exit 0
fi

# Ensure the reviewed commit is still the branch tip immediately before writing.
current_pull_request_json=$(gh api "repos/$repository/pulls/$pull_request_number")
current_head_sha=$(jq -r '.head.sha // empty' <<<"$current_pull_request_json")
if [[ "$current_head_sha" != "$head_sha" ]]; then
  printf 'ADR acceptance: pull request #%s changed during processing; waiting for a fresh review\n' "$pull_request_number" >&2
  exit 1
fi

updated_content=$(base64 -w0 "$updated_file")
commit_message="docs: accept ADR after approved review"
gh api --method PUT "repos/$repository/contents/$adr_path" \
  -f message="$commit_message" \
  -f content="$updated_content" \
  -f sha="$file_sha" \
  -f branch="$head_branch" >/dev/null

printf 'ADR acceptance: set %s to accepted on pull request #%s\n' "$adr_path" "$pull_request_number"
