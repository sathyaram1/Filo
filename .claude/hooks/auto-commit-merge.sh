#!/bin/bash
# Auto-commit + merge + push hook.
#
# Two modes of operation:
#
# 1) MULTI-WORKTREE (local Windows setup): there's a dedicated worktree on the
#    integration branch (TARGET_BRANCH, default "main"). Feature branches in
#    other worktrees get auto-committed and merged into TARGET_BRANCH in that
#    worktree, which is then pushed to origin.
#
# 2) SINGLE-WORKTREE (claude.ai cloud routines): only one worktree exists,
#    checked out on a feature branch. The merge-into-other-worktree path is
#    impossible. Instead we auto-commit, push the feature branch (for
#    traceability) AND push HEAD directly to origin/TARGET_BRANCH (fast-forward
#    only). This lands the routine's work on main without needing a PR.
#
# Designed to be idempotent and safe: silently does nothing if there's nothing
# to commit. Failures are logged to stderr but never fail the hook itself.

PROJECT_DIR="${CLAUDE_PROJECT_DIR:-$(pwd)}"
cd "$PROJECT_DIR" || exit 0

git rev-parse --git-dir >/dev/null 2>&1 || exit 0

# The integration branch. Default "main". Override via FILO_MAIN_BRANCH.
TARGET_BRANCH="${FILO_MAIN_BRANCH:-main}"

# Find a worktree (if any) that has TARGET_BRANCH checked out.
TARGET_WT=$(git worktree list --porcelain | awk -v tb="refs/heads/$TARGET_BRANCH" '
  /^worktree /{wt=substr($0,10)}
  /^branch /{if ($2 == tb) {print wt; exit}}
')

# 1) Commit pending changes in every worktree, and (multi-worktree mode only)
#    merge each feature branch into the TARGET worktree.
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

  # Multi-worktree mode: merge feature branch into TARGET_BRANCH worktree.
  if [ -n "$TARGET_WT" ] && [ "$wt" != "$TARGET_WT" ] && [ "$BRANCH" != "$TARGET_BRANCH" ]; then
    cd "$TARGET_WT" || continue
    MERGE_OUT=$(git -c user.email=claude@local -c user.name=claude-local merge --no-edit "$BRANCH" 2>&1)
    MERGE_RC=$?
    if [ $MERGE_RC -ne 0 ]; then
      git merge --abort 2>/dev/null
      echo "[auto-merge] CONFLICT merging '$BRANCH' into '$TARGET_BRANCH' — needs manual resolution" >&2
      echo "$MERGE_OUT" >&2
    fi
  fi
done

# 2) Push to origin. Logic differs per mode.
git remote get-url origin >/dev/null 2>&1 || exit 0

if [ -n "$TARGET_WT" ]; then
  # MULTI-WORKTREE: push TARGET_BRANCH from the target worktree.
  cd "$TARGET_WT" || exit 0
  AHEAD=$(git rev-list --count "origin/$TARGET_BRANCH..HEAD" 2>/dev/null)
  if [ "${AHEAD:-0}" -gt 0 ]; then
    PUSH_OUT=$(git push origin "$TARGET_BRANCH" 2>&1)
    if [ $? -ne 0 ]; then
      echo "[auto-push] FAILED pushing '$TARGET_BRANCH' to origin — left for manual push" >&2
      echo "$PUSH_OUT" >&2
    fi
  fi
else
  # SINGLE-WORKTREE (cloud): we're in the project dir, on some branch.
  cd "$PROJECT_DIR" || exit 0
  CUR_BRANCH=$(git rev-parse --abbrev-ref HEAD 2>/dev/null)
  if [ -z "$CUR_BRANCH" ] || [ "$CUR_BRANCH" = "HEAD" ]; then
    exit 0  # detached HEAD or weird state — bail
  fi

  # Push the feature branch (best-effort, for traceability/debugging).
  git push origin "$CUR_BRANCH" >/dev/null 2>&1 || true

  # Push HEAD to TARGET_BRANCH on origin. Fast-forward only (no --force).
  # If origin/TARGET_BRANCH has moved ahead concurrently, push is rejected →
  # the feature branch is still on origin so nothing is lost; the next run can
  # try again after a pull/rebase.
  PUSH_OUT=$(git push origin "HEAD:$TARGET_BRANCH" 2>&1)
  if [ $? -ne 0 ]; then
    echo "[auto-push] FAILED pushing HEAD ('$CUR_BRANCH') to origin/$TARGET_BRANCH (single-worktree mode)" >&2
    echo "[auto-push] Feature branch is on origin/$CUR_BRANCH; pull --rebase and retry to land on $TARGET_BRANCH" >&2
    echo "$PUSH_OUT" >&2
  fi
fi

exit 0
