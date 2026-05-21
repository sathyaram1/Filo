#!/bin/bash
# Auto-commit in every worktree that has changes, then auto-merge feature branches into main.
# Designed to be idempotent and safe: silently does nothing if there's nothing to commit.

PROJECT_DIR="${CLAUDE_PROJECT_DIR:-$(pwd)}"
cd "$PROJECT_DIR" || exit 0

# Bail if not a git repo
git rev-parse --git-dir >/dev/null 2>&1 || exit 0

MAIN_WT=$(git worktree list --porcelain | awk '/^worktree /{print substr($0,10); exit}')
MAIN_BRANCH=$(cd "$MAIN_WT" && git rev-parse --abbrev-ref HEAD 2>/dev/null)

CONFLICTS=""

git worktree list --porcelain | awk '/^worktree /{print substr($0,10)}' | while IFS= read -r wt; do
  [ -d "$wt" ] || continue
  cd "$wt" || continue

  git add -A 2>/dev/null
  if git diff --cached --quiet 2>/dev/null; then
    continue
  fi

  BRANCH=$(git rev-parse --abbrev-ref HEAD 2>/dev/null)
  TS=$(date +%Y-%m-%dT%H:%M:%S)
  git -c user.email=claude@local -c user.name=claude-local commit -q -m "auto: $TS" 2>/dev/null

  # If this is not the main worktree and not on main branch, merge into main
  if [ "$wt" != "$MAIN_WT" ] && [ "$BRANCH" != "$MAIN_BRANCH" ] && [ -n "$MAIN_BRANCH" ]; then
    cd "$MAIN_WT" || continue
    MERGE_OUT=$(git -c user.email=claude@local -c user.name=claude-local merge --no-edit "$BRANCH" 2>&1)
    MERGE_RC=$?
    if [ $MERGE_RC -ne 0 ]; then
      git merge --abort 2>/dev/null
      echo "[auto-merge] CONFLICT merging '$BRANCH' into '$MAIN_BRANCH' — needs manual resolution" >&2
      echo "$MERGE_OUT" >&2
    fi
  fi
done

exit 0
