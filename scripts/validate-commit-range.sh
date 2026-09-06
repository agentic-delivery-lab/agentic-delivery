#!/usr/bin/env bash
set -euo pipefail

export LC_ALL=C

if [[ $# -ne 2 ]]; then
  printf 'Usage: %s <base commit> <head commit>\n' "$0" >&2
  exit 2
fi

base=$1
head=$2
script_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)
repository_root=$(cd "$script_dir/.." && pwd -P)
commitlint_bin="$repository_root/node_modules/.bin/commitlint"
gitmoji_validator="$repository_root/scripts/validate-gitmoji.mjs"

if [[ ! -x "$commitlint_bin" || ! -f "$repository_root/commitlint.config.mjs" || ! -f "$gitmoji_validator" ]]; then
  printf 'Commit range check: required tooling is not installed or configured\n' >&2
  exit 2
fi

if ! git -C "$repository_root" rev-parse --git-dir >/dev/null 2>&1; then
  printf 'Commit range check: repository root is not a Git repository\n' >&2
  exit 2
fi

resolve_commit() {
  local revision=$1
  git -C "$repository_root" rev-parse --verify "${revision}^{commit}" >/dev/null 2>&1
}

if [[ "$base" =~ ^0{40}$ ]]; then
  if ! resolve_commit "$head"; then
    printf 'Commit range check: invalid head commit: %s\n' "$head" >&2
    exit 2
  fi
  commit_list=$(git -C "$repository_root" rev-list --reverse --no-merges "$head")
else
  if ! resolve_commit "$base" || ! resolve_commit "$head"; then
    printf 'Commit range check: base and head must name existing commits\n' >&2
    exit 2
  fi
  if ! git -C "$repository_root" merge-base --is-ancestor "$base" "$head"; then
    printf 'Commit range check: base must be an ancestor of head\n' >&2
    exit 2
  fi
  commit_list=$(git -C "$repository_root" rev-list --reverse --no-merges "$base..$head")
fi

temporary_message=$(mktemp)
cleanup() {
  rm -f -- "$temporary_message"
}
trap cleanup EXIT

while IFS= read -r commit; do
  [[ -n "$commit" ]] || continue
  git -C "$repository_root" show --quiet --format='%B' "$commit" >"$temporary_message"

  if ! "$commitlint_bin" --config "$repository_root/commitlint.config.mjs" <"$temporary_message"; then
    printf 'Commit range check: Conventional Commit validation failed for %s\n' "$commit" >&2
    exit 1
  fi
  if ! node "$gitmoji_validator" <"$temporary_message"; then
    printf 'Commit range check: Gitmoji validation failed for %s\n' "$commit" >&2
    exit 1
  fi
done <<<"$commit_list"

printf 'Commit range check passed.\n'
