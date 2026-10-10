#!/bin/bash
# Outputs current git worktree + branch state so Claude knows what parallel work exists.
# Claude Code accepts plain stdout from SessionStart hooks as additional context.
# Prende anche il biglietto della sessione locale (#1148, scripts/biglietto.mjs avvio): mai un'uscita diversa da 0.

# Lo stdin dell'hook ({ session_id, source, … }) si legge per primo: serve al biglietto.
INPUT=""
if [ ! -t 0 ]; then INPUT=$(cat 2>/dev/null || true); fi

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
echo "Convenzione: per ogni nuovo task crea un worktree dedicato con 'git worktree add .claude/worktrees/<slug> -b claude/<slug>' e lavora lì dentro. A ogni Edit/Write un hook committa e pusha IL TUO RAMO (solo quello). Su main non arriva piu' niente da solo: si chiude con 'npm run finish', che fa i controlli e CHIEDE la fusione al server."

# Il biglietto: solo fuori dalle routine (che hanno il loro); senza credenziale dell'owner lo script tace.
if [ -z "$FILO_ROUTINE" ] && [ -f "$PROJECT_DIR/scripts/biglietto.mjs" ] && command -v node >/dev/null 2>&1; then
  LIMITE=""
  if command -v timeout >/dev/null 2>&1; then LIMITE="timeout 15"; fi
  RIGA=$(printf '%s' "$INPUT" | $LIMITE node "$PROJECT_DIR/scripts/biglietto.mjs" avvio 2>/dev/null | head -n 1)
  if [ -n "$RIGA" ]; then echo ""; echo "$RIGA"; fi
fi
exit 0
