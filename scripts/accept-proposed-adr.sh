#!/usr/bin/env bash
set -euo pipefail

export LC_ALL=C

if [[ $# -ne 2 ]]; then
  printf 'Usage: %s <adr-file> <accepted-date>\n' "$0" >&2
  exit 2
fi

adr_file=$1
accepted_date=$2

if [[ ! -f "$adr_file" ]]; then
  printf 'ADR acceptance: file does not exist: %s\n' "$adr_file" >&2
  exit 2
fi

if ! [[ "$accepted_date" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}$ ]] ||
  [[ "$(date -u -d "$accepted_date" +%F 2>/dev/null || true)" != "$accepted_date" ]]; then
  printf 'ADR acceptance: date must be a valid ISO date: %s\n' "$accepted_date" >&2
  exit 2
fi

if [[ "$(sed -n '1p' "$adr_file")" != '---' ]]; then
  printf 'ADR acceptance: missing opening YAML frontmatter: %s\n' "$adr_file" >&2
  exit 1
fi

frontmatter_end=$(awk 'NR > 1 && $0 == "---" { print NR; exit }' "$adr_file")
if [[ -z "$frontmatter_end" ]]; then
  printf 'ADR acceptance: missing closing YAML frontmatter: %s\n' "$adr_file" >&2
  exit 1
fi

status_lines=$(awk -v end="$frontmatter_end" 'NR > 1 && NR < end && /^status: / { count++ } END { print count + 0 }' "$adr_file")
if [[ "$status_lines" -ne 1 ]]; then
  printf 'ADR acceptance: expected exactly one status field in frontmatter: %s\n' "$adr_file" >&2
  exit 1
fi

status=$(awk -v end="$frontmatter_end" 'NR > 1 && NR < end && /^status: / { sub(/^status: /, ""); print; exit }' "$adr_file")
case "$status" in
  accepted)
    printf 'ADR acceptance: already accepted: %s\n' "$adr_file"
    exit 0
    ;;
  proposed)
    ;;
  *)
    printf 'ADR acceptance: only proposed ADRs can be accepted (current status: %s): %s\n' "$status" "$adr_file" >&2
    exit 1
    ;;
esac

status_line=$(awk -v end="$frontmatter_end" 'NR > 1 && NR < end && /^status: / { print NR; exit }' "$adr_file")
temporary_file=$(mktemp "${adr_file}.tmp.XXXXXX")
cleanup() {
  rm -f -- "$temporary_file"
}
trap cleanup EXIT

awk -v status_line="$status_line" 'NR == status_line { print "status: accepted"; next } { print }' "$adr_file" >"$temporary_file"
mv -- "$temporary_file" "$adr_file"
trap - EXIT

printf 'ADR acceptance: status changed to accepted (%s): %s\n' "$accepted_date" "$adr_file"
