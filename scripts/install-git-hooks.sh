#!/usr/bin/env bash
set -euo pipefail

# Why: pre-commit checks only run automatically when Git is configured to use
# this repository's hook directory, so setup should happen on dependency install.
if ! command -v git >/dev/null 2>&1; then
  echo "install-git-hooks: git is not available; skipping hook installation." >&2
  exit 0
fi

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

if ! git -C "$PROJECT_ROOT" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  echo "install-git-hooks: not inside a git worktree; skipping hook installation." >&2
  exit 0
fi

# Why: using a repository-relative hooks path keeps hook behavior consistent
# across machines without requiring developers to copy files manually.
git -C "$PROJECT_ROOT" config core.hooksPath .githooks

echo "install-git-hooks: configured core.hooksPath=.githooks"
