#!/bin/bash
# Gancio SessionEnd (#1208): chiude il biglietto della sessione se è sporco (scripts/biglietto.mjs fine). Claude Code
# gli lascia poco tempo: node passa il lavoro col server a un processo in sottofondo. Mai un'uscita diversa da 0.
[ -n "$FILO_ROUTINE" ] && exit 0
INPUT=""
[ -t 0 ] || INPUT=$(cat 2>/dev/null)
PROJECT_DIR="${CLAUDE_PROJECT_DIR:-$PWD}"
SCRIPT="$PROJECT_DIR/scripts/biglietto.mjs"
[ -f "$SCRIPT" ] || exit 0
command -v node >/dev/null 2>&1 || exit 0
printf '%s' "$INPUT" | node "$SCRIPT" fine >/dev/null 2>&1
exit 0
