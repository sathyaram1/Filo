#!/bin/bash
# Gancio PostToolUse delle letture esterne (#1211): decide e sporca scripts/biglietto.mjs gancio. Non blocca e non esce
# mai diverso da 0; qui solo il salto che non costa un processo, perché gira dopo ogni Read.
[ -n "$FILO_ROUTINE" ] && exit 0
INPUT=""
[ -t 0 ] || INPUT=$(cat 2>/dev/null)
PROJECT_DIR="${CLAUDE_PROJECT_DIR:-$PWD}"

# Read di un file dentro il progetto: niente da sporcare. Un «..», un escape JSON o un collegamento lungo il percorso
# li decide node, che risolve il percorso vero. Si guarda solo prima della risposta, e con un solo "tool_name": le
# chiavi scritte da altri (la risposta, i parametri di un mcp__) non devono far saltare node.
RE_READ='"tool_name"[[:space:]]*:[[:space:]]*"Read"'
RE_FILE='"file_path"[[:space:]]*:[[:space:]]*"([^"]*)"'
TESTA=${INPUT%%'"tool_response"'*}
DOPO_NOME=${TESTA#*'"tool_name"'}
if [[ $TESTA =~ $RE_READ ]] && [[ $DOPO_NOME != *'"tool_name"'* ]] && [[ $TESTA =~ $RE_FILE ]]; then
  F=${BASH_REMATCH[1]}
  F=${F//\\\\//}
  D=${PROJECT_DIR//\\//}
  D=${D%/}
  if [[ -n $D && -e "$D/.git" && $F != *\\* && "$F/" != *"/../"* && $F == "$D"/* ]]; then
    DENTRO=1
    C=$D
    RESTO=${F#"$D"/}
    while [[ -n $RESTO ]]; do
      C="$C/${RESTO%%/*}"
      [[ $RESTO == */* ]] && RESTO=${RESTO#*/} || RESTO=""
      if [[ -L $C ]]; then DENTRO=0; break; fi
    done
    [ "$DENTRO" = 1 ] && exit 0
  fi
fi

SCRIPT="$PROJECT_DIR/scripts/biglietto.mjs"
[ -f "$SCRIPT" ] || exit 0
command -v node >/dev/null 2>&1 || exit 0
LIMITE=""
if command -v timeout >/dev/null 2>&1; then LIMITE="timeout 10"; fi
printf '%s' "$INPUT" | $LIMITE node "$SCRIPT" gancio >/dev/null 2>&1
exit 0
