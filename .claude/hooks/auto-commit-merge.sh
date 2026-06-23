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

# Merge gate (R2): branches matching these prefixes are the routines' worker /
# feature branches. They get committed and pushed for traceability, but are
# NEVER auto-merged onto TARGET_BRANCH by this hook. They reach TARGET_BRANCH
# only through scripts/merge-gate.mjs, invoked by the orchestrator after the
# adversarial verification PASS (and, per R6, after the L4/L5 security checks).
# Everything else (the user's local branches, the routines' own driver branch
# claude/*) keeps the existing auto-merge / auto-push behaviour unchanged.
is_gated_branch() {
  case "$1" in
    worker/*|feature/*) return 0 ;;
    *) return 1 ;;
  esac
}
export -f is_gated_branch 2>/dev/null || true

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
  # Commit message: list the changed files (first 3 + count) instead of a bare
  # timestamp, so `git log` stays useful for archaeology. Git already records
  # the date; the file list is the only signal the hook can cheaply provide.
  CHANGED=$(git diff --cached --name-only 2>/dev/null | sed '/^$/d')
  N=$(printf '%s\n' "$CHANGED" | sed '/^$/d' | wc -l | tr -d ' ')
  SUMMARY=$(printf '%s\n' "$CHANGED" | head -3 | awk 'NR>1{printf ", "}{printf "%s",$0}')
  [ "${N:-0}" -gt 3 ] && SUMMARY="$SUMMARY (+$((N-3)) file)"
  [ -z "$SUMMARY" ] && SUMMARY=$(date +%Y-%m-%dT%H:%M:%S)
  git -c user.email=claude@local -c user.name=claude-local commit -q -m "auto: $SUMMARY" 2>/dev/null

  # Multi-worktree mode: merge feature branch into TARGET_BRANCH worktree.
  # Gated branches (worker/*, feature/*) are committed above but NOT merged
  # here — they go through scripts/merge-gate.mjs (R2).
  if [ -n "$TARGET_WT" ] && [ "$wt" != "$TARGET_WT" ] && [ "$BRANCH" != "$TARGET_BRANCH" ] && ! is_gated_branch "$BRANCH"; then
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

  # Gated branches (worker/*, feature/*) stop here: they are pushed for
  # traceability but must NOT land on TARGET_BRANCH automatically. The
  # orchestrator merges them via scripts/merge-gate.mjs after PASS (R2).
  if is_gated_branch "$CUR_BRANCH"; then
    exit 0
  fi

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
