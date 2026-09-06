#!/usr/bin/env bash
set -euo pipefail

TEST_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
REPO_ROOT=$(cd "$TEST_DIR/../.." && pwd)

assert_file() {
  local path=$1
  if [[ ! -f "$path" ]]; then
    printf 'expected file to exist: %s\n' "$path" >&2
    exit 1
  fi
}

assert_contains() {
  local needle=$1
  local path=$2
  if ! grep -Fq -- "$needle" "$path"; then
    printf 'expected %s to contain: %s\n' "$path" "$needle" >&2
    exit 1
  fi
}

for path in \
  "$REPO_ROOT/CHANGELOG.md" \
  "$REPO_ROOT/package.json" \
  "$REPO_ROOT/package-lock.json" \
  "$REPO_ROOT/.node-version" \
  "$REPO_ROOT/commitlint.config.mjs" \
  "$REPO_ROOT/scripts/start-issue-branch.sh" \
  "$REPO_ROOT/scripts/validate-branch-name.sh" \
  "$REPO_ROOT/scripts/validate-commit-range.sh" \
  "$REPO_ROOT/scripts/validate-gitmoji.mjs" \
  "$REPO_ROOT/scripts/validate-source-issue.sh" \
  "$REPO_ROOT/scripts/validate-changelog.rb" \
  "$REPO_ROOT/.agents/skills/delivery-workflow/SKILL.md" \
  "$REPO_ROOT/.agents/skills/delivery-workflow/agents/openai.yaml" \
  "$REPO_ROOT/.github/pull_request_template.md" \
  "$REPO_ROOT/.github/workflows/delivery-quality.yml"; do
  assert_file "$path"
done

for test_file in \
  test_start_issue_branch.sh \
  test_validate_branch_name.sh \
  test_validate_source_issue.sh; do
  assert_file "$REPO_ROOT/tests/delivery/$test_file"
done

assert_contains '$delivery-workflow' "$REPO_ROOT/AGENTS.md"
assert_contains 'never create a pull request from `main`' "$REPO_ROOT/AGENTS.md"
assert_contains 'npm run branch:start' "$REPO_ROOT/AGENTS.md"
assert_contains 'issue-linked branch name' "$REPO_ROOT/AGENTS.md"
assert_contains 'Do not use squash, rebase or auto-merge' "$REPO_ROOT/AGENTS.md"
assert_contains 'CHANGELOG.md' "$REPO_ROOT/AGENTS.md"
assert_contains 'allow_implicit_invocation: true' "$REPO_ROOT/.agents/skills/delivery-workflow/agents/openai.yaml"
assert_contains 'npm run branch:start' "$REPO_ROOT/.agents/skills/delivery-workflow/SKILL.md"
assert_contains 'issue-linked branch' "$REPO_ROOT/docs/delivery/README.md"
assert_contains 'Closes #123' "$REPO_ROOT/.github/pull_request_template.md"
assert_contains 'source issue is open' "$REPO_ROOT/.github/pull_request_template.md"
assert_contains 'issues/7' "$REPO_ROOT/docs/decisions/0004-use-trunk-based-delivery.md"
assert_contains '0007-use-issue-linked-conventional-branch-names.md' "$REPO_ROOT/docs/decisions/README.md"

for record in 0004-use-trunk-based-delivery.md 0005-use-conventional-commits-with-gitmoji.md 0006-curate-a-changelog.md; do
  assert_contains "($record)" "$REPO_ROOT/docs/decisions/README.md"
done

for term in trunk "short-lived feature branch" "issue-linked branch name" "conventional commit" gitmoji changelog "unreleased section" "merge commit" release; do
  assert_contains "term: \"$term\"" "$REPO_ROOT/docs/domain/ubiquitous-language.yml"
done

node -e '
  const fs = require("node:fs");
  const packageJson = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
  for (const script of ["branch:start", "lint:branch"]) {
    if (!packageJson.scripts[script]) throw new Error(`missing ${script} script`);
  }
  for (const dependency of ["@commitlint/cli", "@commitlint/config-conventional", "gitmojis"]) {
    if (!packageJson.devDependencies[dependency]) throw new Error(`missing ${dependency}`);
  }
  if (packageJson.devDependencies["@commitlint/cli"] !== "21.2.2") throw new Error("unexpected commitlint version");
  if (packageJson.devDependencies["@commitlint/config-conventional"] !== "21.2.2") throw new Error("unexpected config version");
  if (packageJson.devDependencies.gitmojis !== "3.15.0") throw new Error("unexpected gitmojis version");
' "$REPO_ROOT/package.json"

workflow="$REPO_ROOT/.github/workflows/delivery-quality.yml"
for needle in \
  'pull_request:' \
  'push:' \
  'branches: [main]' \
  'fetch-depth: 0' \
  'issues: read' \
  'actions/checkout@fbc6f3992d24b796d5a048ff273f7fcc4a7b6c09' \
  'actions/setup-node@820762786026740c76f36085b0efc47a31fe5020' \
  'npm ci --ignore-scripts' \
  'github.event.pull_request.head.ref' \
  'GH_TOKEN: ${{ github.token }}' \
  'validate-branch-name.sh' \
  'validate-source-issue.sh' \
  'npm run lint:commits' \
  'validate-changelog.rb' \
  'npm audit --audit-level=high'; do
  assert_contains "$needle" "$workflow"
done

branch_check_line=$(grep -n 'validate-branch-name.sh' "$workflow" | head -n1 | cut -d: -f1)
dependency_install_line=$(grep -n 'npm ci --ignore-scripts' "$workflow" | head -n1 | cut -d: -f1)
if [[ -z "$branch_check_line" || -z "$dependency_install_line" || "$branch_check_line" -ge "$dependency_install_line" ]]; then
  printf 'expected branch validation before dependency installation\n' >&2
  exit 1
fi

printf 'Delivery workflow repository contracts passed\n'
