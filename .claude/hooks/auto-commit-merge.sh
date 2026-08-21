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
  if [ -n "$BRANCH" ] && [ "$BRANCH" != "HEAD" ] && [ "$BRANCH" != "$TARGET_BRANCH" ]; then
    git push origin "refs/heads/$BRANCH:refs/heads/$BRANCH" >/dev/null 2>&1 || true
  fi

done

# 2) Push to origin. Logic differs per mode.
git remote get-url origin >/dev/null 2>&1 || exit 0

# ─── NESSUNA pubblicazione automatica sul ramo principale ────────────────────
#
# Qualunque sia la forma del repo (una cartella o venti, sul ramo principale o
# su un ramo di lavoro), questo hook NON fa mai atterrare niente sul ramo
# principale. Ci si arriva solo da:
#
#   - `npm run finish`            (locale: controlli, poi fusione e push)
#   - `scripts/merge-gate.mjs`    (routine: dopo verifica e controlli di sicurezza)
#
# La regola non dipende da FILO_ROUTINE: quella marcatura distingue le
# provenienze nella storia, ma appenderci la sicurezza rimetterebbe la
# protezione dietro un'istruzione che qualcuno puo' dimenticare — il guasto del
# 24 luglio 2026 in persona, quando un'istanza che lavorava sul ramo principale
# ha pubblicato senza passare dal cancello.
#
# Il lavoro non si perde: ogni ramo e' gia' stato committato e spedito qui sopra.
cd "$PROJECT_DIR" || exit 0
CUR_BRANCH=$(git rev-parse --abbrev-ref HEAD 2>/dev/null)
if [ "$CUR_BRANCH" = "$TARGET_BRANCH" ]; then
  echo "[auto-commit] Sei sul ramo '$TARGET_BRANCH': il lavoro e' salvato ma NON pubblicato. Lancia 'npm run finish' quando hai finito (esegue i controlli e pubblica)." >&2
fi

exit 0
