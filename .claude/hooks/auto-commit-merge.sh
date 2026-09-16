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
# committa e non spedisce, in nessuna forma del repo — vedi is_main_line.
#
# Idempotente e silenzioso: se non c'e' niente da salvare non fa niente. Non
# fallisce mai per contratto (esce sempre 0); quando si astiene lo dice su
# stderr e prosegue.

PROJECT_DIR="${CLAUDE_PROJECT_DIR:-$(pwd)}"
cd "$PROJECT_DIR" || exit 0

git rev-parse --git-dir >/dev/null 2>&1 || exit 0

# ─── QUELLO CHE CLAUDE CODE PASSA ALL'HOOK ──────────────────────────────────
#
# Un JSON su stdin, con il nome dell'evento: serve solo quello, per rispondere
# nella forma che Claude Code ascolta (piu' sotto). Da un terminale, senza un
# tubo, non si legge niente: resterebbe in attesa di una riga che non arriva.
HOOK_INPUT=""
[ -t 0 ] || HOOK_INPUT=$(cat 2>/dev/null)
HOOK_EVENT=$(printf '%s' "$HOOK_INPUT" | sed -n 's/.*"hook_event_name"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -1)
[ -z "$HOOK_EVENT" ] && HOOK_EVENT="PostToolUse"

# ─── LA CARTELLA DELLA SESSIONE ──────────────────────────────────────────────
#
# Questo hook gira su TUTTE le cartelle di lavoro del repo, ma la sessione che
# lo ha svegliato sta in una sola: Claude Code la passa nello stdin (campo
# `cwd`). Un guaio di un'altra cartella — una fusione a meta' altrui, un ramo
# altrui non su origin — fino al giro 5 della verifica (16/09/2026) arrivava
# alla sessione con le parole di un problema SUO, e l'agente andava a
# finire il rebase di qualcun altro. Ora si distingue: i guai della propria
# cartella si dicono come oggi; quelli delle altre in una riga, come altrui,
# mai come ordini. Nella JSON di Claude Code le barre di Windows arrivano
# raddoppiate: si rimettono normali e si chiede a git qual e' la radice.
HOOK_CWD=$(printf '%s' "$HOOK_INPUT" | sed -n 's/.*"cwd"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -1 | sed 's#\\\\#/#g')
[ -z "$HOOK_CWD" ] && HOOK_CWD="$PROJECT_DIR"
MIA_CARTELLA=$(git -C "$HOOK_CWD" rev-parse --show-toplevel 2>/dev/null)
minuscolo() { printf '%s' "$1" | tr '[:upper:]' '[:lower:]' | sed 's#/*$##'; }
# La cartella del ciclo e' quella della sessione? Senza una radice nota (stdin
# senza cwd e PROJECT_DIR fuori da git) ogni cartella e' «mia», com'era prima.
e_mia() {
  [ -z "$MIA_CARTELLA" ] && return 0
  [ "$(minuscolo "$1")" = "$(minuscolo "$MIA_CARTELLA")" ]
}
QUI_MIA=1

# I fallimenti della spedizione e le astensioni, raccolti qui: il ciclo dei
# worktree gira in un sotto-processo (un tubo) e una variabile non ne
# uscirebbe. Tre file perche' alla fine si dicono in modo diverso: a un push
# fallito segue cosa fare per spedire, a un'astensione no, e i guai delle
# altre cartelle si dicono come altrui.
FALLIMENTI_FILE=$(mktemp 2>/dev/null || printf '%s' "${TMPDIR:-/tmp}/auto-commit-fallimenti.$$")
: > "$FALLIMENTI_FILE" 2>/dev/null
AVVISI_FILE=$(mktemp 2>/dev/null || printf '%s' "${TMPDIR:-/tmp}/auto-commit-avvisi.$$")
: > "$AVVISI_FILE" 2>/dev/null
ALTRUI_FILE=$(mktemp 2>/dev/null || printf '%s' "${TMPDIR:-/tmp}/auto-commit-altrui.$$")
: > "$ALTRUI_FILE" 2>/dev/null

# Un guaio di un'altra cartella: una riga, con la cartella, senza ordini.
# $1 = la cartella, $2 = il fatto, in breve.
segnala_altrui() {
  local riga="[auto-commit] un'altra cartella di lavoro, non la tua: '$1' — $2"
  echo "$riga" >&2
  [ -n "$ALTRUI_FILE" ] && printf '%s\n' "$riga" >> "$ALTRUI_FILE" 2>/dev/null
}
# Un fallimento si dice DUE volte: su stderr (il registro di debug) e nel
# file, da cui alla fine diventa il contesto che la sessione vede davvero.
# $1 = la cartella, $2 = il testo (per la propria cartella); $3 = il fatto in
# breve, per quando la cartella e' di un altro.
segnala_fallimento() {
  if [ "$QUI_MIA" = 1 ]; then
    echo "[auto-commit] '$1': $2" >&2
    [ -n "$FALLIMENTI_FILE" ] && printf '%s\n' "[auto-commit] '$1': $2" >> "$FALLIMENTI_FILE" 2>/dev/null
  else
    segnala_altrui "$1" "$3"
  fi
}
# Un'astensione (un rebase o una fusione a meta') vale lo stesso: fino al
# giro 4 della verifica (16/09/2026) stava solo su stderr, e la sessione che
# risolveva i conflitti con Edit non sapeva che quel salvataggio non era
# avvenuto finche' non provava a consegnare. Stessi tre argomenti.
segnala_avviso() {
  if [ "$QUI_MIA" = 1 ]; then
    echo "[auto-commit] '$1': $2" >&2
    [ -n "$AVVISI_FILE" ] && printf '%s\n' "[auto-commit] '$1': $2" >> "$AVVISI_FILE" 2>/dev/null
  else
    segnala_altrui "$1" "$3"
  fi
}

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

# ─── LA SPEDIZIONE NON TACE ──────────────────────────────────────────────────
#
# Fino al 2026-09-16 il push era `… >/dev/null 2>&1 || true`. Dopo un rebase
# la storia locale diverge da quella su origin, git rifiuta il push, e l'hook
# non diceva niente: il ramo su origin restava vecchio e il cancello del server
# rileggeva lo stesso conflitto all'infinito (giro del 14/09).
#
# Ora: un push normale; se git lo rifiuta perche' la storia e' divergente, un
# secondo tentativo con --force-with-lease. Il lease e' contro il ref remoto
# che questa copia conosce (refs/remotes/origin/<ramo>): se nel frattempo
# qualcun altro ha spinto sullo stesso ramo, git rifiuta, ed e' giusto cosi'.
# Qualunque altro esito negativo — o il secondo rifiuto — finisce in UNA riga
# su stderr, col motivo di git, nello stesso posto dove l'hook dice che si
# astiene dal ramo principale.
motivo_git() {
  printf '%s\n' "$1" | grep -vE '^hint:|^To |^[[:space:]]*$' | head -3 | tr '\n' ' ' | sed 's/[[:space:]]*$//'
}
spedisci_ramo() {
  local ramo="$1" dove="$2" esito esito2
  esito=$(git push origin "refs/heads/$ramo:refs/heads/$ramo" 2>&1) && return 0
  case "$esito" in
    # E' il SERVER a dire di no (un pre-receive, una regola del repo, il push
    # protection sui segreti): «! [remote rejected]». Non e' storia divergente
    # e un rebase non lo cura: si dice per quello che e', col motivo del
    # remoto, e non si ritenta col lease (verifica del giro 4).
    *"[remote rejected]"*)
      segnala_fallimento "$dove" "il ramo '$ramo' NON e' arrivato su origin. Il server remoto ha RIFIUTATO il push (una regola del repo, un pre-receive, il push protection?): $(motivo_git "$esito")" \
        "il suo ramo '$ramo' non e' su origin, il remoto ha rifiutato il push: $(motivo_git "$esito")"
      return 1 ;;
    *rejected*|*non-fast-forward*|*"fetch first"*|*"stale info"*)
      # --force-if-includes: il lease da solo si fida del ref remoto che questa
      # copia conosce, e dopo un `git fetch` quel ref e' gia' il commit
      # dell'altro: il lease combacia e il rinvio lo sovrascrive (verifica del
      # giro 2). Con --force-if-includes git rifiuta se quel commit non e' mai
      # passato dalla storia locale di questo ramo.
      esito2=$(git push --force-with-lease="refs/heads/$ramo" --force-if-includes origin "refs/heads/$ramo:refs/heads/$ramo" 2>&1) && return 0
      segnala_fallimento "$dove" "il ramo '$ramo' NON e' arrivato su origin. Storia divergente, e anche il rinvio con --force-with-lease e' stato rifiutato (qualcun altro ha spinto su questo ramo?): $(motivo_git "$esito2")" \
        "il suo ramo '$ramo' non e' su origin, storia divergente e rinvio rifiutato: $(motivo_git "$esito2")"
      return 1 ;;
  esac
  segnala_fallimento "$dove" "il ramo '$ramo' NON e' arrivato su origin: $(motivo_git "$esito")" \
    "il suo ramo '$ramo' non e' su origin: $(motivo_git "$esito")"
  return 1
}

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
  if e_mia "$wt"; then QUI_MIA=1; else QUI_MIA=0; fi

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
  if is_main_line "$BRANCH"; then
    if [ -n "$(git status --porcelain 2>/dev/null)" ]; then
      echo "[auto-commit] '$wt' si trova sul ramo principale ('$BRANCH'): NON committo e NON spedisco. Le modifiche sono ancora li'. Spostale in una cartella dedicata: git worktree add .claude/worktrees/<nome> -b claude/<nome>" >&2
    fi
    continue
  fi

  # ─── NEL MEZZO DI UN CONFLITTO NON SI COMMITTA ─────────────────────────────
  #
  # Un rebase o una fusione fermi su un conflitto: l'agente risolve un file con
  # un Edit, e questo hook riparte. Fino al 2026-09-16 (giro del 14/09, terza
  # verifica) `git add -A` metteva in scena anche i file ANCORA in conflitto,
  # coi segni <<<<<<< dentro, e il commit li portava nella storia: durante un
  # rebase inghiottiva il commit che il rebase stava riportando (il suo
  # messaggio sparito, «auto: a.txt, b.txt» al suo posto, e --continue diceva
  # «Successfully rebased»); durante una fusione la chiudeva col file rotto e la
  # spediva su origin, dove la leggono il server e chi verifica. Qui ci si
  # ferma: le modifiche restano nella cartella, il rebase resta a meta', e chi
  # lo ha iniziato lo finisce (git add, git rebase --continue o git commit).
  # Il salvataggio riparte al primo Edit dopo.
  GIT_DIR_QUI=$(git rev-parse --git-dir 2>/dev/null)
  if [ -d "$GIT_DIR_QUI/rebase-merge" ] || [ -d "$GIT_DIR_QUI/rebase-apply" ] \
     || [ -f "$GIT_DIR_QUI/MERGE_HEAD" ] || [ -f "$GIT_DIR_QUI/CHERRY_PICK_HEAD" ] || [ -f "$GIT_DIR_QUI/REVERT_HEAD" ] \
     || [ -n "$(git ls-files -u 2>/dev/null | head -1)" ]; then
    segnala_avviso "$wt" "un rebase o una fusione e' a meta' (o ci sono file ancora in conflitto): NON committo e NON spedisco, o metterei in commit i segni di conflitto. Finiscilo (risolvi i file, git add, poi git rebase --continue o git commit): al primo salvataggio dopo il ramo parte." \
      "un rebase o una fusione e' a meta' li' (o ci sono file in conflitto): quel salvataggio non e' avvenuto"
    continue
  fi

  # ─── UN COMMIT CHE NON RIESCE NON TACE ─────────────────────────────────────
  #
  # Un index.lock rimasto a terra (un git morto a meta') ferma gia' `git add`;
  # un pre-commit che rifiuta ferma il commit. Fino al giro 5 della verifica
  # (16/09/2026) tutti e due finivano in /dev/null e la sessione lavorava
  # convinta di essere salvata. Ora passano alla sessione dallo stesso canale
  # del push fallito, col motivo di git. Un fallimento qui non e' un push a
  # vuoto: non c'e' niente di committato, e la coda dice questo.
  ESITO_ADD=$(git add -A 2>&1) || {
    segnala_avviso "$wt" "le modifiche NON sono state committate (git add e' fallito): $(motivo_git "$ESITO_ADD"). Il salvataggio non e' avvenuto e le modifiche restano nella cartella: se e' un index.lock a terra e nessun git e' in corso, si toglie; al primo salvataggio dopo si riprova." \
      "il salvataggio li' non e' riuscito (git add): $(motivo_git "$ESITO_ADD")"
    continue
  }
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
  ESITO_COMMIT=$(git -c user.email="$COMMIT_AS_EMAIL" -c user.name="$COMMIT_AS_NAME" commit -q -m "auto: $SUMMARY" 2>&1) || {
    segnala_avviso "$wt" "le modifiche NON sono state committate (git commit e' fallito): $(motivo_git "$ESITO_COMMIT"). Il salvataggio non e' avvenuto e le modifiche restano nella cartella, in scena: un pre-commit che rifiuta dice il perche' qui sopra; al primo salvataggio dopo si riprova." \
      "il salvataggio li' non e' riuscito (git commit): $(motivo_git "$ESITO_COMMIT")"
    continue
  }

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
  # Durabilita': ogni ramo di lavoro viene spedito subito, anche quando la sua
  # storia e' stata riscritta da un rebase (spedisci_ramo, piu' su). E' il
  # pezzo che ha salvato il lavoro dopo le interruzioni improvvise, e vale
  # anche in locale ora che la fusione sul ramo principale e' differita.
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
  # Una HEAD staccata non ha un ramo da spedire: il commit qui sopra resta come
  # paracadute locale e basta. Il ramo principale non arriva nemmeno qui.
  if is_spedibile "$BRANCH"; then
    spedisci_ramo "$BRANCH" "$wt" || true
  fi

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

# ─── Battito del semaforo (scripts/lib/routine-beat.mjs) ─────────────────────
#
# Il processo staccato che dovrebbe battere ogni 10 minuti in cloud non
# sopravvive alla sessione di comando che lo ha avviato: sui feedback il
# battito specchiato si ferma sempre a pochi secondi dal biglietto, il semaforo
# cade a meta' lavorazione e la consegna arriva con un biglietto morto (#507 e
# registro dei rifiuti: dead_ticket su consegne di lavori interi). Questo hook
# gira a ogni salvataggio — cioe' esattamente quando qualcuno sta lavorando — e
# rilancia un battito SINGOLO, non piu' di uno ogni 5 minuti. Senza biglietto
# (macchina dell'owner, giro finito) non fa niente; con un biglietto morto il
# battito esce da solo al primo rifiuto.
TICKET_FILE="$PROJECT_DIR/.claude/routine-ticket.json"
BEAT_STAMP="$PROJECT_DIR/.claude/routine-beat-hook.stamp"
if [ -f "$TICKET_FILE" ] && command -v node >/dev/null 2>&1; then
  now_s=$(date +%s)
  last_s=$(date -r "$BEAT_STAMP" +%s 2>/dev/null || echo 0)
  if [ $((now_s - last_s)) -ge 300 ]; then
    touch "$BEAT_STAMP" 2>/dev/null
    (cd "$PROJECT_DIR" && node scripts/routine-channel.mjs heartbeat >/dev/null 2>&1 &)
  fi
fi

# ─── UN PUSH FALLITO ARRIVA ALLA SESSIONE ────────────────────────────────────
#
# Fino al 2026-09-16 (giro del 14/09, verifica) il fallimento stava solo su
# stderr, con uscita 0. Per Claude Code, stderr di un hook che esce con 0 va
# al solo registro di debug: non alla sessione, non a chi guarda — e in una
# routine non guarda nessuno. Era ancora un push a vuoto in silenzio.
# L'unico canale da un hook PostToolUse alla sessione e' un JSON su stdout con
# `additionalContext` (l'uscita 2 non vale per questo evento; un'uscita
# diversa da zero mostra la prima riga di stderr a chi guarda, e basta).
# Quando tutto e' arrivato, stdout resta vuoto: niente contesto a ogni Edit.
# Le astensioni (rebase o fusione a meta') passano dallo stesso canale, senza
# la coda che dice di spedire: li' non c'e' niente da spedire.
#
# Il testo diventa una stringa JSON: backslash e virgolette si scappano, e
# OGNI carattere di controllo se ne va (ritorno carrello e tab in spazi, gli
# altri via). Fino al giro 4 della verifica si sostituiva il solo tab: un
# ritorno carrello nel messaggio del remoto — git lo lascia passare com'e',
# a seconda di come spezza i pacchetti — rendeva il JSON illeggibile e il
# fallimento tornava muto.
stringa_json() {
  tr '\r\t' '  ' | tr -d '\000-\010\013\014\016-\037' | sed 's/\\/\\\\/g; s/"/\\"/g' | awk 'NR>1{printf "\\n"}{printf "%s",$0}'
}
# I guai delle ALTRE cartelle vanno in coda, una riga ciascuno, e la coda che
# dice di spedire riguarda solo la propria.
if [ -s "$FALLIMENTI_FILE" ] || [ -s "$AVVISI_FILE" ] || [ -s "$ALTRUI_FILE" ]; then
  TESTO=$(cat "$FALLIMENTI_FILE" "$AVVISI_FILE" "$ALTRUI_FILE" 2>/dev/null | stringa_json)
  CODA=""
  [ -s "$FALLIMENTI_FILE" ] && CODA="\\nIl lavoro e' committato in locale ma NON e' su origin: sistemalo prima di consegnare (git push del ramo; se la storia diverge, un rebase su origin e poi il push)."
  printf '{"hookSpecificOutput":{"hookEventName":"%s","additionalContext":"SALVATAGGIO: %s%s"}}\n' "$HOOK_EVENT" "$TESTO" "$CODA"
fi
rm -f "$FALLIMENTI_FILE" "$AVVISI_FILE" "$ALTRUI_FILE" 2>/dev/null

exit 0
