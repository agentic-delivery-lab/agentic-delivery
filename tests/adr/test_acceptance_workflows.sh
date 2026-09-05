#!/usr/bin/env bash
set -euo pipefail

TEST_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
REPO_ROOT=$(cd "$TEST_DIR/../.." && pwd)
SIGNAL_WORKFLOW="$REPO_ROOT/.github/workflows/adr-approval-signal.yml"
ACCEPT_WORKFLOW="$REPO_ROOT/.github/workflows/adr-accept-on-approval.yml"
QUALITY_WORKFLOW="$REPO_ROOT/.github/workflows/adr-quality.yml"

grep -Fqx '  pull_request_review:' "$SIGNAL_WORKFLOW"
grep -Fq '    types: [submitted]' "$SIGNAL_WORKFLOW"
grep -Fqx 'permissions: {}' "$SIGNAL_WORKFLOW"
grep -Fq 'runs-on: ubuntu-latest' "$SIGNAL_WORKFLOW"

grep -Fqx '  workflow_run:' "$ACCEPT_WORKFLOW"
grep -Fq '    workflows: [adr-approval-signal]' "$ACCEPT_WORKFLOW"
grep -Fq '    types: [completed]' "$ACCEPT_WORKFLOW"
grep -Fq '  actions: read' "$ACCEPT_WORKFLOW"
grep -Fq '  contents: write' "$ACCEPT_WORKFLOW"
grep -Fq '  pull-requests: read' "$ACCEPT_WORKFLOW"
grep -Fq 'runs-on: [self-hosted, linux, x64, omarchy]' "$ACCEPT_WORKFLOW"
grep -Fq 'actions/checkout@fbc6f3992d24b796d5a048ff273f7fcc4a7b6c09' "$ACCEPT_WORKFLOW"
grep -Fq 'persist-credentials: false' "$ACCEPT_WORKFLOW"
grep -Fq './scripts/accept-adr-on-approval.sh' "$ACCEPT_WORKFLOW"

grep -Fq 'runs-on: [self-hosted, linux, x64, omarchy]' "$QUALITY_WORKFLOW"
grep -Fq 'head.repo.full_name == github.repository' "$QUALITY_WORKFLOW"

printf 'ADR acceptance workflow contract tests passed\n'
