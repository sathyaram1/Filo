#!/bin/bash
# Hook di SALVATAGGIO: committa e spedisce il ramo di lavoro, a ogni modifica.
#
# Cosa fa, e basta: per ogni cartella di lavoro del repo, se ci sono modifiche
# le committa sul ramo che quella cartella ha sotto i piedi e spedisce QUEL ramo
# su origin. E' il trasporto del lavoro (lo rende visibile a verifica e server)
# e il paracadute se la sessione muore di colpo.
#
# Cosa NON fa (e non deve tornare a fare): fondere, e toccare il ramo
# principale. La fusione automatica c'era fino al 2026-08-07 ed e' stata tolta
# (il perche' e' scritto piu' sotto); sul ramo principale questo hook non
# committa e non spedisce, in nessuna forma del repo — vedi is_protected_branch.
#
# Idempotente e silenzioso: se non c'e' niente da salvare non fa niente. Non
# fallisce mai per contratto (esce sempre 0); quando si astiene lo dice su
# stderr e prosegue.

PROJECT_DIR="${CLAUDE_PROJECT_DIR:-$(pwd)}"
cd "$PROJECT_DIR" || exit 0

git rev-parse --git-dir >/dev/null 2>&1 || exit 0

# ─── I RAMI CHE QUESTO AUTOMATISMO NON TOCCA MAI ─────────────────────────────
#
# Fino al 2026-08-21 qui c'era `TARGET_BRANCH="${FILO_MAIN_BRANCH:-main}"`: il
# nome del ramo principale preso dall'AMBIENTE, e usato come guardia. Una
# guardia che si sposta con una variabile non e' una guardia — bastava
# esportarne una perche' "sei sul ramo principale" diventasse falso e la riga
# che spedisce il ramo spedisse il ramo principale, a ogni singola modifica.
# E' la stessa forma tolta da scripts/finish-local.mjs, rimasta nel file accanto.
#
# Adesso i nomi sono INCHIODATI: `main` e `master` (il repo potrebbe cambiare
# convenzione senza che questo file lo sappia — la guardia sbaglia in direzione
# sicura). Il default DICHIARATO da origin si AGGIUNGE ai due, non li
# sostituisce: se qualcuno riuscisse a raccontare un default diverso, main e
# master resterebbero comunque protetti.
#
RAMO_DEFAULT=$(git symbolic-ref --quiet --short refs/remotes/origin/HEAD 2>/dev/null | sed 's#^origin/##')

# La linea principale, comunque sia scritto il nome. Una HEAD staccata NON e' la
# linea principale: e' "nessun ramo", e si tratta a parte (is_spedibile) — li' il
# salvataggio locale resta, e' il paracadute, e non c'e' niente da spedire.
is_main_line() {
  local b="${1#refs/heads/}"; b="${b#origin/}"
  b=$(printf '%s' "$b" | tr '[:upper:]' '[:lower:]')
  [ -z "$b" ] && return 1
  case "$b" in main|master) return 0 ;; esac
  [ -n "$RAMO_DEFAULT" ] && [ "$b" = "$(printf '%s' "$RAMO_DEFAULT" | tr '[:upper:]' '[:lower:]')" ] && return 0
  return 1
}

# Un ramo che questo automatismo puo' spedire: deve essere un ramo (non una HEAD
# staccata) e non essere la linea principale. Nel dubbio: no.
is_spedibile() {
  [ -n "$1" ] && [ "$1" != "HEAD" ] && ! is_main_line "$1"
}

# ─── Chi sta lavorando? (spec ROUTINE-BRANCH-INTEGRITY.md §Via 1) ────────────
#
# Fino al 2026-08-07 questo hook distingueva "lavoro di una routine, da
# trattenere" da "lavoro dell'owner, da pubblicare" GUARDANDO IL NOME DEL RAMO:
# un elenco di prefissi vietati (worker/*, feature/*), e tutto il resto veniva
# pubblicato sul ramo principale a ogni modifica. Il nome è un indizio, non un
# fatto: il 24 luglio un'istanza di routine che non era passata su un ramo di
# lavoro ha pubblicato il proprio codice direttamente, saltando il cancello di
# sicurezza — che nel frattempo esaminava un gemello abbandonato.
#
# Ora la sessione si DICHIARA. `FILO_ROUTINE=1` (lo esporta l'orchestratore, e
# lo eredita ogni worker) significa: nessuna pubblicazione automatica, mai,
# qualunque sia il nome del ramo. Si arriva al ramo principale solo attraverso
# scripts/merge-gate.mjs.
#
# È anche la risposta alla domanda "questo commit da dove è arrivato?": senza
# marcatura, nella storia il lavoro di una routine e quello di una sessione
# locale sono indistinguibili (stesso autore, stesso ramo, stesso aspetto).
is_routine_session() {
  [ -n "$FILO_ROUTINE" ] && [ "$FILO_ROUTINE" != "0" ]
}

# I prefissi restano come RETE, non più come regola primaria: proteggono anche
# le sessioni locali che stanno lavorando a qualcosa che non deve ancora uscire
# (è così che è protetto questo stesso lavoro).
is_gated_branch() {
  case "$1" in
    worker/*|feature/*) return 0 ;;
    *) return 1 ;;
  esac
}
export -f is_gated_branch 2>/dev/null || true

# Identità di chi committa: distingue nella storia le due provenienze.
if is_routine_session; then
  COMMIT_AS_NAME="claude-routine"
  COMMIT_AS_EMAIL="claude@routine"
else
  COMMIT_AS_NAME="claude-local"
  COMMIT_AS_EMAIL="claude@local"
fi

# (Qui si cercava la cartella che aveva il ramo principale, per fonderci dentro
# i rami di lavoro. La fusione automatica non esiste piu' dal 2026-08-07 e quella
# ricerca non serviva piu' a nessuno.)

# 1) Commit pending changes in every worktree.
git worktree list --porcelain | awk '/^worktree /{print substr($0,10)}' | while IFS= read -r wt; do
  [ -d "$wt" ] || continue
  cd "$wt" || continue

  BRANCH=$(git rev-parse --abbrev-ref HEAD 2>/dev/null)

  # ─── SUL RAMO PRINCIPALE NON SI COMMITTA ───────────────────────────────────
  #
  # Se una sessione modifica file mentre la cartella si trova sul ramo
  # principale, questo hook ci committava sopra. Quel lavoro non ha nessun modo
  # di arrivare agli utenti — al ramo principale ci si arriva solo dal cancello,
  # che fonde un RAMO — e intanto sporca la copia locale del ramo principale,
  # che al prossimo `git pull` diverge o si trascina dietro commit che nessuno
  # ha esaminato.
  #
  # Astenersi non e' un errore: le modifiche restano nella cartella (niente e'
  # perso), lo si dice a voce chiara e si prosegue.
  if is_protected_branch "$BRANCH"; then
    if [ -n "$(git status --porcelain 2>/dev/null)" ]; then
      echo "[auto-commit] '$wt' si trova sul ramo principale ('${BRANCH:-HEAD staccata}'): NON committo e NON spedisco. Le modifiche sono ancora li'. Spostale in una cartella dedicata: git worktree add .claude/worktrees/<nome> -b claude/<nome>" >&2
    fi
    continue
  fi

  git add -A 2>/dev/null
  if git diff --cached --quiet 2>/dev/null; then
    continue
  fi

  # Commit message: list the changed files (first 3 + count) instead of a bare
  # timestamp, so `git log` stays useful for archaeology. Git already records
  # the date; the file list is the only signal the hook can cheaply provide.
  CHANGED=$(git diff --cached --name-only 2>/dev/null | sed '/^$/d')
  N=$(printf '%s\n' "$CHANGED" | sed '/^$/d' | wc -l | tr -d ' ')
  SUMMARY=$(printf '%s\n' "$CHANGED" | head -3 | awk 'NR>1{printf ", "}{printf "%s",$0}')
  [ "${N:-0}" -gt 3 ] && SUMMARY="$SUMMARY (+$((N-3)) file)"
  [ -z "$SUMMARY" ] && SUMMARY=$(date +%Y-%m-%dT%H:%M:%S)
  git -c user.email="$COMMIT_AS_EMAIL" -c user.name="$COMMIT_AS_NAME" commit -q -m "auto: $SUMMARY" 2>/dev/null

  # NESSUNA fusione automatica sul ramo principale (cambiato il 2026-08-07).
  # Il salvataggio continuo resta — e' cio' che salva il lavoro quando una
  # sessione viene interrotta di colpo — ma al ramo principale ci si arriva UNA
  # VOLTA, a lavoro finito: `npm run finish` in locale (controlli + fusione),
  # scripts/merge-gate.mjs per le routine.
  #
  # Perche': una versione viene costruita e distribuita agli utenti ogni 6 ore
  # prendendo il ramo principale COSI' COM'E'. Pubblicando a ogni modifica, quella
  # fotografia poteva cogliere un lavoro a meta'. In piu' ogni pubblicazione
  # spostava il ramo principale sotto i piedi delle routine in corso, e faceva
  # giudicare al cancello di sicurezza una versione diversa da quella poi fusa.
  # Durabilita': ogni ramo di lavoro viene spedito subito. E' il pezzo che ha
  # salvato il lavoro dopo le interruzioni improvvise, e vale anche in locale
  # ora che la fusione sul ramo principale e' differita.
  #
  # LA DESTINAZIONE SI DICHIARA. `git push origin "$BRANCH"` dice a git COSA
  # spedire ma non DOVE: la destinazione la sceglie la configurazione locale.
  # Con `push.default=upstream` (o `tracking`) e
  # `branch.<ramo>.merge=refs/heads/main` — che git imposta DA SE' quando un
  # ramo nasce da origin/main, cioe' gia' cosi' su ogni ramo di lavoro — questa
  # riga scriverebbe su refs/heads/main. A OGNI Edit. Sono `git config`: un file
  # non versionato, nessuna credenziale, invisibile a chi guarda il diff.
  # Il refspec sorgente:destinazione pienamente qualificato toglie la scelta
  # alla configurazione.
  #
  # Quale ramo si spedisce l'ha gia' deciso is_protected_branch qui sopra: se
  # fossimo sul ramo principale non saremmo arrivati fin qui.
  git push origin "refs/heads/$BRANCH:refs/heads/$BRANCH" >/dev/null 2>&1 || true

done

# ─── NESSUNA pubblicazione automatica sul ramo principale ────────────────────
#
# Qualunque sia la forma del repo (una cartella o venti, sul ramo principale o
# su un ramo di lavoro), questo hook NON fa mai atterrare niente sul ramo
# principale. Ci si arriva solo da:
#
#   - `npm run finish`            (locale: controlli, poi si chiede la fusione)
#   - `scripts/merge-gate.mjs`    (routine: dopo verifica e controlli di sicurezza)
#
# La regola non dipende da FILO_ROUTINE: quella marcatura distingue le
# provenienze nella storia, ma appenderci la sicurezza rimetterebbe la
# protezione dietro un'istruzione che qualcuno puo' dimenticare — il guasto del
# 24 luglio 2026 in persona, quando un'istanza che lavorava sul ramo principale
# ha pubblicato senza passare dal cancello.
#
# Il lavoro non si perde: ogni ramo di lavoro e' gia' stato committato e spedito
# qui sopra. Una cartella che si trova sul ramo principale non viene toccata, e
# l'hook lo dice riga per riga nel ciclo — qui non serve ripeterlo.

exit 0
