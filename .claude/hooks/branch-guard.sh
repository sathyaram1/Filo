#!/bin/bash
# branch-guard.sh — la guardia sulla DIVERGENZA di ramo (spec
# ROUTINE-BRANCH-INTEGRITY.md §B).
#
# PERCHÉ CONTROLLA IL RISULTATO E NON I COMANDI
#   Enumerare i modi per cambiare ramo è una battaglia persa: `git checkout`,
#   `switch`, `worktree`, `reset --hard`, `rebase`, `git -C <altrove>`, uno
#   script, un alias… ognuno ha una scrittura diversa e la lista sarebbe sempre
#   incompleta. Questa guardia non guarda cosa è stato eseguito: dopo ogni
#   comando confronta DOVE SI TROVA la directory con dove dovrebbe trovarsi. Non
#   le interessa come ci è arrivata, quindi non ha una lista da tenere
#   aggiornata.
#
# QUANDO È ATTIVA
#   Solo se esiste `.claude/branch-expect.json` nella cartella della chiamata, che scrive il dispatcher
#   quando consegna il lavoro a una routine e cancella a consegna avvenuta. Nelle
#   sessioni locali dell'owner quel file non c'è e la guardia è inerte: l'owner
#   cambia ramo quando gli pare.
#
#   Dopo la consegna il file sparisce apposta: da lì in poi il merge-gate DEVE
#   poter cambiare ramo per fondere, ed è legittimo.
#
# COSA NON È
#   Ferma le derive e gli errori, non un'istanza determinata ad aggirarla (può
#   cancellare il file di attesa). È voluto: qui il nemico è la deriva, non il
#   sabotaggio. La garanzia vera sta fuori dalla sessione, nel controllo che
#   rifiuta la transizione (§C) — questa guardia serve a far scoprire il
#   disallineamento in pochi secondi invece che a fine lavoro.
#
# Exit 2 = blocca e riporta il messaggio all'istanza. Ogni altro esito = via
# libera. Non deve MAI fallire per conto suo: un guasto della guardia non può
# bloccare il lavoro.

PROJECT_DIR="${CLAUDE_PROJECT_DIR:-$(pwd)}"

# ─── DI QUALE CARTELLA È QUESTA CHIAMATA (#1157) ─────────────────────────────
#
# Con un clone per worker l'attesa sta nel clone, non in PROJECT_DIR. La
# chiamata si attribuisce dal file toccato (Edit/Write) o dai clone registrati
# (scripts/lib/clone-worker.mjs) che il comando Bash nomina; altrimenti vale
# PROJECT_DIR, come prima. Più clone in un comando solo: non si sa di chi è la
# deriva, quindi una riga di avviso e nessun blocco.
HOOK_INPUT=""
[ -t 0 ] || HOOK_INPUT=$(cat 2>/dev/null)
campo_json() {
  printf '%s' "$HOOK_INPUT" | grep -oE "\"($1)\"[[:space:]]*:[[:space:]]*\"([^\"\\\\]|[\\\\].)*\"" | head -1 \
    | sed 's/^"[^"]*"[[:space:]]*:[[:space:]]*"//; s/"$//'
}
percorso_json() { campo_json "$1" | sed 's#[\\][\\]*#/#g'; }
# Su Windows JSON.stringify raddoppia le barre rovesciate ("C:\\Users\\…"): un
# confronto letterale fallirebbe sempre e la guardia sarebbe inerte proprio dove serve.
norm_path() {
  printf '%s' "$1" | sed 's|\\\\|/|g; s|\\|/|g; s|/*$||' | tr '[:upper:]' '[:lower:]'
}
radice_di() {
  local d="$1" su
  while [ -n "$d" ] && [ ! -d "$d" ]; do
    su=$(dirname "$d"); [ "$su" = "$d" ] && return 1; d="$su"
  done
  [ -n "$d" ] && git -C "$d" rev-parse --show-toplevel 2>/dev/null
}
comune_di() { git -C "$1" rev-parse --path-format=absolute --git-common-dir 2>/dev/null; }
origin_di() { git -C "$1" remote get-url origin 2>/dev/null | tr '[:upper:]' '[:lower:]' | sed 's#\.git$##; s#/*$##'; }
# Una cartella del progetto: un suo worktree (stessa .git) o un clone con lo stesso origin.
del_progetto() {
  local c o
  [ "$(norm_path "$1")" = "$(norm_path "$PROJECT_DIR")" ] && return 0
  c=$(comune_di "$1")
  [ -n "$c" ] && [ "$(norm_path "$c")" = "$(norm_path "$(comune_di "$PROJECT_DIR")")" ] && return 0
  o=$(origin_di "$1")
  [ -n "$o" ] && [ "$o" = "$(origin_di "$PROJECT_DIR")" ]
}
# Un percorso dentro un testo in minuscolo, nelle due scritture di Windows (c:/x e /c/x).
contiene_percorso() {
  local testo="$1" p q
  p=$(norm_path "$2")
  case "$testo" in *"$p"*) return 0 ;; esac
  q=$(printf '%s' "$p" | sed -n 's#^\([a-z]\):/#/\1/#p')
  [ -n "$q" ] && case "$testo" in *"$q"*) return 0 ;; esac
  return 1
}

CARTELLE=""
FILE_TOCCATO=$(percorso_json 'file_path|notebook_path')
if [ -n "$FILE_TOCCATO" ]; then
  r=$(radice_di "$FILE_TOCCATO")
  [ -n "$r" ] && del_progetto "$r" && CARTELLE="$r"
else
  COMUNE=$(comune_di "$PROJECT_DIR")
  REGISTRO="$COMUNE/filo-cloni"
  if [ -n "$COMUNE" ] && [ -d "$REGISTRO" ]; then
    COMANDO=$(norm_path "$(campo_json command | sed 's#[\\][\\]*#/#g')")
    CWD_HOOK=$(norm_path "$(percorso_json cwd)")
    for voce in "$REGISTRO"/*; do
      [ -f "$voce" ] || continue
      clone=$(head -1 "$voce" 2>/dev/null)
      [ -n "$clone" ] && [ -d "$clone" ] || continue
      if { [ -n "$COMANDO" ] && contiene_percorso "$COMANDO" "$clone"; } \
         || { [ -n "$CWD_HOOK" ] && contiene_percorso "$CWD_HOOK/" "$clone/"; }; then
        CARTELLE=$(printf '%s\n%s' "$CARTELLE" "$clone" | sed '/^$/d')
      fi
    done
  fi
fi
[ -z "$CARTELLE" ] && CARTELLE="$PROJECT_DIR"
QUANTE=$(printf '%s\n' "$CARTELLE" | sed '/^$/d' | wc -l | tr -d ' ')

# Estrazione senza jq (non garantito nel container delle routine).
read_field() {
  sed -n "s/.*\"$1\"[[:space:]]*:[[:space:]]*\"\([^\"]*\)\".*/\1/p" "$EXPECT_FILE" | head -1
}

# Un rebase del ramo assegnato stacca la cartella per forza, e il ruolo di chi riallinea lo chiede: non è
# una deriva. Registrare durante il rebase resta rifiutato da dispatch (checkDelivery).
rebase_dir() {
  for d in rebase-merge rebase-apply; do
    p=$(git rev-parse --git-path "$d" 2>/dev/null)
    case "$p" in /*|?:*) ;; *) p="$(pwd)/$p" ;; esac
    [ -n "$p" ] && [ -d "$p" ] || continue
    [ "$d" = rebase-apply ] && [ ! -f "$p/rebasing" ] && continue
    printf '%s' "$p"
    return 0
  done
  return 1
}

# 0 = nessuna deriva (RB_MSG pieno se è il rebase del ramo assegnato); 1 = deriva,
# con EXPECTED e CURRENT impostati.
deriva_di() {
  local dir="$1"
  EXPECT_FILE="$dir/.claude/branch-expect.json"
  [ -f "$EXPECT_FILE" ] || return 0
  EXPECTED=$(read_field branch)
  EXPECT_ROOT=$(read_field root)
  [ -n "$EXPECTED" ] || return 0
  # L'attesa vale per la directory in cui è stata scritta.
  if [ -n "$EXPECT_ROOT" ] && [ "$(norm_path "$EXPECT_ROOT")" != "$(norm_path "$dir")" ]; then
    return 0
  fi
  git -C "$dir" rev-parse --git-dir >/dev/null 2>&1 || return 0
  CURRENT=$(git -C "$dir" rev-parse --abbrev-ref HEAD 2>/dev/null)
  [ -n "$CURRENT" ] || return 0
  [ "$CURRENT" = "$EXPECTED" ] && return 0
  if [ "$CURRENT" = "HEAD" ] && RB=$(cd "$dir" && rebase_dir); then
    RB_BRANCH=$(sed 's|^refs/heads/||' "$RB/head-name" 2>/dev/null | head -1)
    if [ "$RB_BRANCH" = "$EXPECTED" ]; then
      RB_MSG="[branch-guard] Rebase del ramo '$EXPECTED' in corso: finché non finisce la cartella resta staccata, ed è normale. Portalo a termine (risolvi i conflitti, poi git rebase --continue; per rinunciare git rebase --abort) PRIMA di registrare qualunque esito: durante il rebase la registrazione viene rifiutata."
      return 0
    fi
  fi
  return 1
}

if [ "$QUANTE" -gt 1 ]; then
  AVVISI=""
  while IFS= read -r dir; do
    [ -n "$dir" ] || continue
    RB_MSG=""
    deriva_di "$dir" && continue
    if [ "$CURRENT" = "HEAD" ]; then dove="staccata"; else dove="sul ramo '$CURRENT'"; fi
    [ -n "$AVVISI" ] && AVVISI="$AVVISI\\n"
    AVVISI="$AVVISI[branch-guard] il comando nomina più cartelle di lavoro: '$dir' è $dove invece che su '$EXPECTED'. Se è la tua, torna sul ramo assegnato prima di proseguire."
  done <<EOF_CARTELLE
$CARTELLE
EOF_CARTELLE
  [ -n "$AVVISI" ] && printf '{"hookSpecificOutput":{"hookEventName":"PostToolUse","additionalContext":"%s"}}\n' "$(printf '%s' "$AVVISI" | sed 's#\\\([^n]\)#/\1#g; s/"/\\"/g')"
  exit 0
fi

RB_MSG=""
if deriva_di "$CARTELLE"; then
  [ -n "$RB_MSG" ] && printf '{"hookSpecificOutput":{"hookEventName":"PostToolUse","additionalContext":"%s"}}\n' "$RB_MSG"
  exit 0
fi

if [ "$CURRENT" = "HEAD" ]; then
  WHERE="in uno stato staccato (nessun ramo)"
else
  WHERE="sul ramo '$CURRENT'"
fi

cat >&2 <<EOF
[branch-guard] FERMATI: la cartella di lavoro è $WHERE, ma questo compito è
assegnato al ramo '$EXPECTED'.

Qualunque cosa tu faccia da qui — leggere il codice, eseguire i test, emettere
un verdetto — riguarda una versione diversa da quella in lavorazione, quindi il
risultato non sarebbe attendibile. È esattamente l'errore che il 24 luglio ha
prodotto una bocciatura falsa e un'intera implementazione doppia.

Torna sul ramo assegnato:

    git checkout $EXPECTED

Se non ci riesci NON proseguire e NON registrare nessun esito: chiudi il
compito dicendo che la cartella non è allineata al ramo assegnato. Il
feedback resta dov'era e verrà ripescato — un giro perso è molto meno costoso
di un verdetto sbagliato.
EOF
exit 2
