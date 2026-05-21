#!/bin/bash
# Outputs current git worktree + branch state so Claude knows what parallel work exists.
# Claude Code accepts plain stdout from SessionStart hooks as additional context.

PROJECT_DIR="${CLAUDE_PROJECT_DIR:-$(pwd)}"
cd "$PROJECT_DIR" || exit 0
git rev-parse --git-dir >/dev/null 2>&1 || exit 0

echo "## Stato git (auto)"
echo ""
echo "### Worktree attivi"
git worktree list 2>/dev/null
echo ""
echo "### Branch"
git branch -v 2>/dev/null
echo ""
echo "Convenzione: per ogni nuovo task crea un worktree dedicato con 'git worktree add ../filo-<slug> -b <slug>' e lavora lì dentro. Auto-commit e auto-merge su main avvengono via hook a ogni Edit/Write."
