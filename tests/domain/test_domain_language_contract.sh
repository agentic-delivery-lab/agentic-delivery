#!/usr/bin/env bash
set -euo pipefail

TEST_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
REPO_ROOT=$(cd "$TEST_DIR/../.." && pwd)
AGENTS_FILE="$REPO_ROOT/AGENTS.md"
DOMAIN_GUIDE="$REPO_ROOT/docs/domain/README.md"
REGISTER="$REPO_ROOT/docs/domain/ubiquitous-language.yml"
SKILL="$REPO_ROOT/.agents/skills/ubiquitous-language/SKILL.md"
OPENAI_CONFIG="$REPO_ROOT/.agents/skills/ubiquitous-language/agents/openai.yaml"
ISSUE_TEMPLATE="$REPO_ROOT/.github/ISSUE_TEMPLATE/architecture-decision.yml"
WORKFLOW="$REPO_ROOT/.github/workflows/adr-quality.yml"
VALIDATOR="$REPO_ROOT/scripts/validate-domain-language.rb"
VALIDATOR_TEST="$REPO_ROOT/tests/domain/test_validate_domain_language.sh"

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

for path in \
  "$AGENTS_FILE" \
  "$DOMAIN_GUIDE" \
  "$REGISTER" \
  "$SKILL" \
  "$OPENAI_CONFIG" \
  "$ISSUE_TEMPLATE" \
  "$WORKFLOW" \
  "$VALIDATOR" \
  "$VALIDATOR_TEST"; do
  assert_file "$path"
done

assert_contains 'docs/domain/README.md' "$AGENTS_FILE"
assert_contains 'docs/domain/ubiquitous-language.yml' "$AGENTS_FILE"
assert_contains '$ubiquitous-language' "$AGENTS_FILE"
assert_contains 'domain-model change' "$AGENTS_FILE"

assert_contains 'canonical register' "$DOMAIN_GUIDE"
assert_contains 'same change set' "$DOMAIN_GUIDE"
assert_contains 'not a repository-wide forbidden-word rule' "$DOMAIN_GUIDE"
assert_contains 'semantic consistency' "$DOMAIN_GUIDE"

assert_contains 'docs/domain/README.md' "$SKILL"
assert_contains 'docs/domain/ubiquitous-language.yml' "$SKILL"
assert_contains 'same change set' "$SKILL"
assert_contains 'exact external' "$SKILL"
assert_contains 'structural checks cannot prove' "$SKILL"
assert_contains 'Use $ubiquitous-language' "$OPENAI_CONFIG"
assert_contains 'allow_implicit_invocation: true' "$OPENAI_CONFIG"

ruby -e '
  require "yaml"
  form = YAML.safe_load_file(ARGV.fetch(0), permitted_classes: [], permitted_symbols: [], aliases: false)
  field = form.fetch("body").find { |item| item["id"] == "domain_language" }
  abort "missing domain_language issue field" unless field
  abort "domain_language issue field is not required" unless field.dig("validations", "required") == true
  text = [field.dig("attributes", "description"), field.dig("attributes", "placeholder")].join(" ")
  abort "domain_language issue field does not allow None" unless text.include?("None")
' "$ISSUE_TEMPLATE"

for path_contract in \
  'docs/domain/**' \
  '.agents/skills/**' \
  'scripts/validate-domain-language.rb' \
  'tests/domain/**'; do
  assert_contains "$path_contract" "$WORKFLOW"
done
assert_contains './scripts/validate-domain-language.rb "$GITHUB_WORKSPACE"' "$WORKFLOW"
assert_contains 'docs/domain/ubiquitous-language.yml' "$WORKFLOW"
assert_contains '.agents/skills/ubiquitous-language/agents/openai.yaml' "$WORKFLOW"
assert_contains './tests/domain/test_validate_domain_language.sh' "$WORKFLOW"
assert_contains './tests/domain/test_domain_language_contract.sh' "$WORKFLOW"

"$VALIDATOR" "$REPO_ROOT" >/dev/null

printf 'Domain-language repository contracts passed\n'
