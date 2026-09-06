#!/usr/bin/env bash
set -euo pipefail

export LC_ALL=C

if [[ $# -gt 1 ]]; then
  printf 'Usage: %s [repository root]\n' "$0" >&2
  exit 2
fi

repository_root=${1:-.}
if ! repository_root=$(cd "$repository_root" && pwd -P); then
  printf 'ADR check: repository root does not exist: %s\n' "$repository_root" >&2
  exit 2
fi

decisions_dir="$repository_root/docs/decisions"
errors=0

error() {
  printf 'ADR check: %s\n' "$1" >&2
  errors=$((errors + 1))
}

if [[ ! -d "$decisions_dir" ]]; then
  error "missing docs/decisions directory"
  exit 1
fi

for required_file in README.md adr-template.md; do
  if [[ ! -f "$decisions_dir/$required_file" ]]; then
    error "missing docs/decisions/$required_file"
  fi
done

records=()
while IFS= read -r record; do
  records+=("$record")
done < <(find "$decisions_dir" -maxdepth 1 -type f -name '[0-9][0-9][0-9][0-9]-*.md' -print | sort)

if [[ ${#records[@]} -eq 0 ]]; then
  error "no numbered ADR records found"
fi

expected_number=1
for record in "${records[@]}"; do
  filename=$(basename "$record")
  number=${filename:0:4}
  expected_filename=$(printf '%04d' "$expected_number")

  if [[ "$number" != "$expected_filename" ]]; then
    error "$filename breaks the record sequence; expected a record starting with $expected_filename"
  fi
  expected_number=$((expected_number + 1))

  if [[ ! "$filename" =~ ^[0-9]{4}-[a-z0-9]+([a-z0-9-]*[a-z0-9])?\.md$ ]]; then
    error "$filename does not use the NNNN-title-with-dashes.md format"
  fi

  if [[ $(sed -n '1p' "$record") != '---' ]]; then
    error "$filename has no opening YAML frontmatter"
    continue
  fi

  frontmatter_end=$(awk 'NR > 1 && $0 == "---" { print NR; exit }' "$record")
  if [[ -z "$frontmatter_end" ]]; then
    error "$filename has no closing YAML frontmatter"
    continue
  fi

  frontmatter=$(sed -n "2,$((frontmatter_end - 1))p" "$record")
  if grep -Eq '^status:' <<<"$frontmatter"; then
    error "$filename must not define status in frontmatter; the main branch defines official ADR state"
  fi
  if ! grep -Eq '^date: [0-9]{4}-[0-9]{2}-[0-9]{2}$' <<<"$frontmatter"; then
    error "$filename has no ISO date in its frontmatter"
  fi
  if ! grep -Eq '^source-issue: https://github\.com/[^/[:space:]]+/[^/[:space:]]+/issues/[0-9]+$' <<<"$frontmatter"; then
    error "$filename has no valid GitHub source-issue URL in its frontmatter"
  fi

  required_headings=(
    '## Context and Problem Statement'
    '## Decision Drivers'
    '## Considered Options'
    '## Decision Outcome'
    '### Consequences'
    '### Confirmation'
    '## More Information'
  )
  for heading in "${required_headings[@]}"; do
    if ! grep -Fqx "$heading" "$record"; then
      error "$filename is missing required heading: $heading"
    fi
  done

  if ! grep -Eq 'https://github\.com/[^/[:space:]]+/[^/[:space:]]+/issues/[0-9]+' "$record"; then
    error "$filename does not link its source issue"
  fi

  if [[ -f "$decisions_dir/README.md" ]] && ! grep -Fq "($filename)" "$decisions_dir/README.md"; then
    error "$filename is not linked from docs/decisions/README.md"
  fi
done

if [[ "$errors" -gt 0 ]]; then
  printf 'ADR check failed with %d error(s).\n' "$errors" >&2
  exit 1
fi

printf 'ADR check passed: %d record(s).\n' "${#records[@]}"
