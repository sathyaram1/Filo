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
#   Solo se esiste `.claude/branch-expect.json`, che scrive il dispatcher
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
EXPECT_FILE="$PROJECT_DIR/.claude/branch-expect.json"

[ -f "$EXPECT_FILE" ] || exit 0

# Estrazione senza jq (non garantito nel container delle routine).
read_field() {
  sed -n "s/.*\"$1\"[[:space:]]*:[[:space:]]*\"\([^\"]*\)\".*/\1/p" "$EXPECT_FILE" | head -1
}

EXPECTED=$(read_field branch)
EXPECT_ROOT=$(read_field root)
[ -n "$EXPECTED" ] || exit 0

# L'attesa vale per la directory in cui è stata scritta. Se il dispatcher ha
# lavorato altrove (setup locale multi-worktree), non è affar nostro.
if [ -n "$EXPECT_ROOT" ]; then
  case "$EXPECT_ROOT" in
    "$PROJECT_DIR") ;;
    *) exit 0 ;;
  esac
fi

cd "$PROJECT_DIR" 2>/dev/null || exit 0
git rev-parse --git-dir >/dev/null 2>&1 || exit 0

CURRENT=$(git rev-parse --abbrev-ref HEAD 2>/dev/null)
[ -n "$CURRENT" ] || exit 0
[ "$CURRENT" = "$EXPECTED" ] && exit 0

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
