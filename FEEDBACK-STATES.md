# FEEDBACK-STATES — Macchina a stati dei feedback (spec + piano di lavoro)

**Origine:** sessione di progettazione owner + Claude, 2026-07-02. Le decisioni della spec
sono già prese dall'owner. Questo file è la copia in-repo della spec (l'originale era solo
in chat, troncato a metà §7a.3) + il **piano a fasi con checklist** per implementarla su
più sessioni. **Chi continua il lavoro riparte da qui**: leggi la checklist in fondo,
prendi la prima fase non spuntata.

---

## 1. Problema

Lo *stato* di un feedback oggi è spalmato su più campi ricalcolati a display-time:
`status` (povero), `pipeline.*` (verdetti giudici), `reviewDecision`, `blockReason`, più
la modalità automatica letta al volo. Conseguenza dimostrata: la dashboard
(`manageReview.js → manageTabFor/isApproved`) mostrava 20 feedback "In coda" (autoMode ON
+ aligned), ma `next-feedback.mjs` seleziona solo `status === 'todo'` → coda vuota per le
routine. Due criteri diversi per "questo è lavorabile?" = bug strutturale.

**Obiettivo:** un unico campo `status` persistito su Firestore è la SOLA fonte di verità.
Ogni evento SCRIVE lo status; dashboard, routine e agente leggono SOLO lo status. Nessun
consumer ricalcola lo stato dai campi grezzi.

## 2. Gli stati (lista chiusa)

| status | colore | tab | significato |
|---|---|---|---|
| `unlabeled` | bianco | Ricevuti | ricevuto, panel giudici non completo |
| `suspicious_file` | **nero** | Ricevuti | gate deterministico file ha flaggato PRIMA dei giudici |
| `attack` | rosso | Ricevuti | un livello di sicurezza ha flaggato come attacco |
| `spam` | giallo | Ricevuti | flaggato come spam |
| `design` | verde | Ricevuti | serve decisione owner (3 origini distinte via chat: verdetto design; domande routine ex-`clarify`; fix fallito 3× ex-`blocked/loop`) |
| `aligned` | blu | Ricevuti | sicuro e sensato ma automatica OFF: aspetta approvazione manuale |
| `todo` | — | In coda | approvato (a mano o auto): aspetta di essere lavorato |
| `working` | — | In coda | un'istanza lo sta lavorando ORA (lock, §6) |
| `revision_capability` | — | In coda | fix su branch, aspetta verifica comportamentale (verifier avversariale) |
| `revision_security` | — | In coda | verifica passata, aspetta audit L4 (secaudit) + merge-gate |
| `done` | — | In coda*/Risolti | fuso su main e deployato; aspetta verifica umana owner |
| `archived` | — | Archiviati | verificato dall'owner; log |
| `attack_confirmed` | rosso | Archiviati (filtro "Bloccati confermati") | attacco confermato: terminale |
| `spam_confirmed` | giallo | Archiviati (filtro "Bloccati confermati") | spam confermato: terminale |

\* `done` resta "In coda" finché `resolvedInVersion ≤ releasedVersion` non è vero (gate
DB3 esistente), poi "Risolti".

**Campi ortogonali (NON stati):** `starred` (bool), `priority` (0–3), `statusReason`
(string breve opzionale per il sottotesto in dashboard, MAI per la logica: `judges`,
`clarify`, `loop`, `l1-identity`, `file-gate`, `legacy-ignored`…), `workingSince`
(ISO, solo con `working`), `branch` (da `revision_*` in poi).

**Stati legacy da RITIRARE:** `new`, `review`, `blocked`, `clarify`, `verified`,
`ignored` (mappatura in §8).

## 3. Transizioni legali (chi scrive cosa)

- ingresso → gate file (filo-security, prima dei giudici): flag → `suspicious_file`;
  pulito → `unlabeled`.
- `unlabeled` —pipeline (panel completo)→ `attack` | `spam` | `design` | (sicuro:
  automatica ON **e mittente ammesso** → `todo`, altrimenti → `aligned`).
- `suspicious_file` —owner→ `todo` | `attack_confirmed` | `spam_confirmed` | `archived`.
- `attack` —owner→ `attack_confirmed` | `todo` (falso positivo).
- `spam` —owner→ `spam_confirmed` | `todo`.
- `design` —owner (risponde in chat)→ `todo` | `archived`.
- `aligned` —owner→ `todo` (anche bulk dalla dashboard).
- `todo` —routine (claim §6)→ `working`.
- `working` —routine→ `revision_capability`; —TTL scaduto (riconciliazione)→ `todo`;
  —TTL scaduto per la 3ª volta consecutiva→ `design` (`statusReason: loop`, nota
  in chat: istanza che muore sempre, es. crediti esauriti — vedi §6).
- `revision_capability` —routine PASS verifier→ `revision_security`; —FAIL×3→ `design`
  (`statusReason: loop`).
- `revision_security` —routine PASS secaudit+merge→ `done`; —FAIL fixer-loop→ `design`
  (`statusReason: loop`).
- `done` —owner verifica→ `archived`; —owner "manca qualcosa"→ `todo` (riapertura).
- `archived` —owner ripristina→ `todo`.
- `attack_confirmed`/`spam_confirmed` —owner "era legittimo"→ `todo`.
- da todo/working/revision_* la routine con domande → `design` (+ domande nella chat,
  `statusReason: clarify`).

**Regole dure:** solo l'owner fa uscire da `suspicious_file`, `attack`, `spam`, `design`,
`aligned`, `done`, `archived`, `*_confirmed`. Solo la pipeline (filo-security) fa uscire
da `unlabeled`. Solo le routine (via coda triage) muovono `todo→working→revision_*→done`
e `revision_*→design(loop)`. Transizioni non elencate = illegali: il writer le rifiuta.

**Mittenti fidati** (`owner:`/`routine:`/`agent:`/`local:`): mai `attack`/`spam`; se un
livello identità li flagga è un errore → `unlabeled` per ri-giudizio. `local:` è la
**sessione locale**: Claude che lavora sulla macchina dell'owner, in chat con lui (lo
strumento che apre un feedback da lì è `npm run feedback:apri`). In dashboard è una
categoria d'autore PROPRIA — né agente esploratore né automazione cloud: il contesto in
cui nasce un ritrovamento è diverso da entrambi, ed è l'unica cosa che il mittente serve
a dire.

**Aggiornamento 2026-08-19 (smontaggio sotto-feedback, SPEC-RIDISEGNO-MAX.md §1).**
L'estensione `todo→done` / `working→done` (attore routine), introdotta in F3 per il
pianificatore che spezzava le spec in sub-feedback, è RITIRATA da entrambe le copie
della macchina a stati: il pianificatore non esiste più. Le chiusure manuali senza
branch (`npm run feedback -- <id> done "…" --come-routine`) restano legali come
CATENA di passi (`canReach` attraversa l'iter todo→working→revision_*→done). I
sub-feedback storici (#N.x) restano visibili e lavorabili; è sparita solo la
possibilità di crearne di nuovi.

## 4. Tab dashboard (deriva SOLO da `status`)

`tabFor(status)` = lookup pura, senza `pipeline`, senza `isApproved`, senza `autoMode`:
- Ricevuti: `unlabeled | suspicious_file | attack | spam | design | aligned`
- In coda: `todo | working | revision_capability | revision_security | done(non rilasciato)`
- Risolti: `done(rilasciato)` — Archiviati: `archived` (+ filtro ⭐; + filtro "Bloccati
  confermati" per `*_confirmed`, decisione presa: restano ispezionabili come log lì).

La modalità automatica agisce UNA volta, al giudizio (sicuro + ON → `todo`; sicuro + OFF
→ `aligned`). Attivarla dopo NON ri-tocca i vecchi `aligned`: l'owner li approva in blocco
dalla dashboard (azione bulk `aligned→todo`, da aggiungere alla UI).

**Per mittente (#446).** "ON" non è più un sì/no per tutti: l'interruttore master
(`config/automation.enabled`) abilita l'auto-approvazione, e la mappa
`config/automation.autoApprove` dice QUALI categorie di mittente ne beneficiano
(`owner` / `filo` / `claude` / `user`, dal prefisso del `clientId`). Master spento ⇒
nessuno, qualunque cosa dica la mappa. Mappa assente ⇒ tutti, come prima che esistesse.
La logica è pura e vive in due copie da tenere allineate: `src/shared/feedbackThread.js`
(dashboard) e `filo-security/functions/src/autoApprove.js` (chi decide davvero).

I gruppi sono QUATTRO e le categorie d'autore sono di più: `claude` raccoglie tutte le
istanze di Claude (esplorazione, sviluppo, verifica, rilievo residuo **e la sessione
locale**). Provenienza e fiducia sono due assi diversi: la dashboard distingue da dove
nasce un ritrovamento, l'auto-approvazione decide di chi ci si fida — e su quel secondo
asse le istanze dell'owner sono la stessa cosa. Conseguenza pratica: l'interruttore
"Claude" spegne insieme le automazioni in cloud e la sessione locale.

## 5. Chat del feedback distingue i sotto-casi di `design`

Un solo stato `design`, tre origini leggibili dalla chat/thread (`notes`): (1) verdetto
giudici; (2) domande della routine (appende le domande alla chat + `statusReason:
clarify`); (3) fix fallito 3× (dispatch appende l'ultima critica del verifier +
`statusReason: loop`). La risposta dell'owner appende alla chat e (se decide) muove a
`todo`.

## 6. Lock di lavorazione (`working`)

- Presa in carico: `todo → working` + `workingSince: <now ISO>`.
- **TTL 60 minuti**: `working` con `workingSince` più vecchio = istanza morta → chiunque
  (dispatch al giro dopo, o l'Action in riconciliazione) lo riporta a `todo`.
- ⚠️ **Superato dal 2026-08-17** (spec `ROUTINE-AUTH-SPEC.md`): il lock non è più
  un file su git. Lo prende il **server** rilasciando il biglietto, dura quanto
  il semaforo e si tiene vivo col battito. `working` resta il riflesso persistito
  che la dashboard mostra. Tutto ciò che qui sotto parla di file di claim, di
  coda e dell'automatismo che la applicava descrive un meccanismo **smontato**:
  resta come storia di come ci si è arrivati, non come istruzione.
- Se un'istanza trova `working` fresco: NON aspetta, passa al prossimo `todo`; se non
  c'è altro, termina con "niente da fare".
- L'Action apply-triage **riconcilia**: rilascia claim orfani e resetta i `working`
  scaduti. Estensioni 2026-07-14 (recupero istanze morte, es. crediti esauriti):
  - il claim **sopravvive** all'applicazione dell'entry `working` (è la presa in
    carico: l'istanza sta ancora lavorando) e viene rilasciato solo alle consegne;
  - ogni reset `working`→`todo` incrementa il contatore `workingResets`; alla **3ª
    interruzione consecutiva** il feedback va in `design` (`statusReason: loop`) con
    nota in chat, invece di fare ping-pong todo↔working all'infinito. Una consegna
    reale (revision_*/done/design) azzera il contatore;
  - la riconciliazione gira anche **a orologio** (cron ogni 30 min del workflow),
    non solo ai push: un'istanza morta non pusha niente, senza cron nessun trigger
    resetterebbe mai il suo `working`.

## 7. Dove si implementa

### 7a. filo-security (repo `C:/Users/agenti AI/Desktop/Filo/filo-security`)
1. La pipeline dei giudici scrive lo status nativamente: al completamento del panel UNO
   di `attack|spam|design|todo|aligned` (per todo/aligned legge la modalità automatica in
   quel momento). Panel incompleto/degradato → `unlabeled` + `statusReason` col motivo.
   I `pipeline.*` grezzi restano per audit, ma nessun consumer li legge più per lo stato.
2. Mittenti fidati: mai attack/spam (come oggi in classifyBlock); flag identità su fidato
   → `unlabeled` per ri-giudizio.
3. Gate deterministico file sospetti (vive QUI, decisione owner): gira PRIMA dei giudici
   su ogni feedback con allegati; flag → `suspicious_file` e NON va al panel finché
   l'owner non decide. Contesto noto: il widget accetta via drag&drop tipi non ammessi
   (es. `.html` con script); da stringere anche `storage.rules` (content-type).
   ⚠️ *La spec originale si troncava qui: i dettagli sotto (7b, 8) sono ricostruiti in
   questa sessione dai principi §1–§6 e dal codice esistente; decisioni marcate.*

### 7b. Repo Filo (consumer) — ricostruito
- **`src/shared/feedbackStatus.js`** (nuovo, IIFE `SN_FB_STATUS`): vocabolario unico —
  lista stati, colori, `tabFor(status)`, tabella transizioni legali +
  `canTransition(from,to,actor)`, normalizzazione legacy (`normalizeStatus(fb)` che
  applica §8 in lettura durante la transizione). Unit test.
- **`src/shared/manageReview.js`**: `manageTabFor` → lookup pura su status normalizzato;
  `classifyBlock`/`isAligned`/`isApproved` restano solo per (a) colore/label da status,
  (b) normalizzazione dello storico. Nessuna lettura di `pipeline` per decidere la tab.
- **`src/shared/feedback.js`**: `STATUS_PUBLIC_MAP` esteso ai nuovi stati (tutti gli
  aperti → `open`; `done|archived|*_confirmed` → `closed`; nota sicurezza: i confermati
  DEVONO collassare su `closed` come i done, mai un valore distinto).
- **`src/pages/manage/*`**: colori per status, azione bulk `aligned→todo`, filtro
  "Bloccati confermati" in Archiviati, sottotesto da `statusReason`.
- **`scripts/queue-triage.mjs` + `apply-triage.mjs`**: ALLOWED = nuovi stati; l'Action
  valida le transizioni con `canTransition` (rifiuta le illegali); riconciliazione
  `working` scaduti; scrittura `workingSince`/`statusReason`.
- **`scripts/next-feedback.mjs`**: seleziona `todo` (invariato) ma ora la pipeline
  scrive `todo` → la coda si riempie davvero; ignora `working` freschi.
  *(Ritirato il 2026-08-19: la selezione vive solo nel server,
  `filo-security/functions/src/routine/select.js`.)*
- **`scripts/dispatch.mjs` + ruoli**: il fixer muove `todo→working→revision_*`;
  loop 3× → `design`+`statusReason: loop`.
- **`firestore.rules`**: enum `status` esteso ai nuovi valori (in create anonimo resta
  bloccato: solo `new`→ ora `unlabeled`), `hasOnly` esteso con `statusReason`,
  `workingSince`. Deploy manuale (`firebase deploy --only firestore:rules`).

### 8. Migrazione legacy → nuovi stati — ricostruito, [CONFERMARE con owner]
Script one-shot (o normalizzazione in lettura + riscrittura al primo write):
- `new` → derivare dal pipeline con la STESSA logica di oggi (classifyBlock/isAligned):
  nessun pipeline o parziale → `unlabeled`; attacco → `attack`; spam → `spam`; design →
  `design`; aligned+`candidate_change` → `todo`; aligned senza → `aligned`.
  `reviewDecision==='accepted'` → `todo` (vince su tutto, come oggi).
- `clarify` → `design` + `statusReason: clarify`.
- `blocked` + `blockReason: 'loop'` → `design` + `statusReason: loop`; altri `blocked` →
  derivare dal pipeline come per `new`.
- `review` → `revision_capability` (era "fix pronto in attesa di review").
- `verified` → `archived` (era "verificato dall'owner").
- `ignored` → `archived` + `statusReason: legacy-ignored`.
- `done`, `todo`, `archived` → invariati.

---

## PIANO A FASI (checklist di continuazione)

Aggiorna QUESTO file spuntando le fasi man mano. Worktree:
`.claude/worktrees/feedback-status-machine` (branch `claude/feedback-status-machine`).

- [x] **F1 — Vocabolario condiviso** (fatto 2026-07-02): `src/shared/feedbackStatus.js`
      (SN_FB_STATUS: stati, colori, tabFor, transizioni+canTransition, LEGACY_SIMPLE,
      isWorkingExpired, PUBLIC_MAP) + `tests/unit/feedbackStatus.test.mjs` (13 test
      verdi). Caricato in `loader.js` e `manage.html` prima di manageReview.
      NB: `normalizeStatus(fb)` (scioglimento di new/blocked dal pipeline) va in
      manageReview.js (F2), perché riusa classifyBlock/isAligned.
- [x] **F2a — Logica dashboard su status** (fatto 2026-07-03): `manageReview.js`
      riscritto — `normalizeStatus(fb)` (canonico→invariato; legacy semplice→mappa;
      new/blocked→scioglimento dai grezzi con classifyLegacyBlock/isAlignedLegacy,
      interni non esportati); `manageTabFor` = lookup pura; `classifyBlock` deriva da
      status (loop=design verde, nero riservato a suspicious_file); `isAligned` = solo
      chi ASPETTA approvazione; `isApproved` = status nell'iter (autoMode IGNORATO —
      era il bug strutturale); board: guard red-team resta sui grezzi APPOSTA.
      `feedback.js`: statusToPublic con lookup pigra su SN_FB_STATUS.PUBLIC_MAP.
      Unit test aggiornati al nuovo contratto: 808/808 verdi.
      ⚠️ Conseguenze semantiche da dire all'owner: (1) legacy `verified`/`ignored` →
      Archiviati (verified esce dalla board utenti); (2) status `todo` = SEMPRE in
      coda (prima un todo "non approvato" stava nei Ricevuti); (3) pipeline "in
      corso" ora bianco `unlabeled` (prima nessun colore).
- [x] **F2b — UI dashboard** (fatto 2026-07-03): `manage.html`+`manage.js` — barra
      "Approva tutti gli allineati (N) → In coda" nei Ricevuti (bulk aligned→todo);
      filtro "Bloccati confermati" negli Archiviati; bottone "Conferma attacco/spam"
      nel dettaglio (attack/spam/suspicious_file → *_confirmed, con
      reviewDecision: rejected); tooltip card con statusReason; il box risposta
      chiarimenti ora scatta su design+statusReason clarify (oltre al legacy).
      Spec manage-page.spec.mjs aggiornato (fixture allineato → status new;
      test automatica riscritto: il toggle NON sposta più le liste).
- [x] **F3 — Routine/scripts** (fatto 2026-07-03): queue-triage e apply-triage con
      ALLOWED canonici + remap legacy in ingresso (clarify→design/clarify,
      review→revision_capability, blocked→design/loop); apply-triage valida le
      transizioni con canReach (catene, perché la coda tiene UN file per feedback
      e i passi collassano) e SCARTA le illegali (log + file rimosso); scrive
      statusReason (+ blockReason specchiato per lo storico) e workingSince
      (set su working, azzerato altrimenti); nota vuota NON cancella più le note;
      riconciliazione: working scaduti (TTL 60min) → todo. dispatch: seleziona
      revision_*/review con branch, accoda working al claim di new-work, i
      --record-* riflettono lo status (pass→revision_security, fix→revision_
      capability), loop 3× → design/loop. Ruoli + ROUTINES.md aggiornati.
      Estensione documentata: todo/working→done (routine) per lavori senza branch
      (es. pianificatore). Attore owner delegato: routine:auto-archive.
- [x] **F4 — firestore.rules** (editate 2026-07-03): enum esteso ai canonici (legacy
      mantenuti per lo storico), statusReason/workingSince in hasOnly (admin e ramo
      routine, con size check); ramo routine: iter completo todo/working/revision_*/
      done/design (+clarify transizione). DEPLOYATE il 2026-07-03 (deploy ok su
      progetto filo-8b9cb).
- [x] **F5 — Migrazione** (ESEGUITA 2026-07-03, owner ha confermato le scelte):
      `scripts/migrate-status.mjs --apply` con token admin in tests/agent/.env
      (gitignorato). 101 migrati / 226 già canonici / 0 errori: 40→aligned,
      2→attack, 1→spam, 3→design(judges), 4 clarify→design(clarify),
      21→unlabeled, 30 ignored→archived. Rilanciata a vuoto: 0 da migrare
      (idempotente). Nota: lo script decifra TUTTO il doc (soprattutto
      `pipeline`) con decrypt-feedback-fields, altrimenti classifica tutto
      unlabeled.
- [x] **F6 — filo-security** (fatto 2026-07-03, commit bd93b47, DEPLOYATO):
      `src/statusMap.js` (decisione→status canonico; fidati mai attack/spam →
      unlabeled; canWriteStatus = la pipeline non regredisce feedback oltre il
      giudizio — vale anche per le ri-valutazioni); `src/l0/fileGate.js` (gate
      deterministico allowlist su `files[]`, PRIMA dei giudici → suspicious_file,
      niente panel); `feedbackState.recordDecision` scrive `status` CIFRATO (come
      il pipeline: anti hill-climbing, la dashboard lo decifra già — status è nei
      TEXT_FIELDS) + `statusPublic` in chiaro; runner: gate L0, owner-accepted →
      todo, trusted, reeval aggiorna lo status. Test 279 verdi. `storage.rules`
      (repo Filo): via i wildcard `text/.*`/`image/.*` (passava text/html!),
      allowlist esplicita — DEPLOYATE.
- [x] **F7 — Rifiniture** (fatto 2026-07-03): patch notes v0.2.104 (bulk approva,
      filtro confermati, coda coerente); CLAUDE.md aggiornato (workflow → macchina
      a stati, punta a questo file); ruoli/ROUTINES.md già in F3. Capabilities:
      nessuna capacità utente cambiata (il gate file è moderazione, non un confine
      promesso) → non toccato.

**Punti [DECIDERE/CONFERMARE] per l'owner:**
1. Mappatura `ignored` → `archived` (con statusReason) vs `spam_confirmed`.
2. Mappatura `review` → `revision_capability`.
3. `*_confirmed` in Archiviati sotto filtro (proposta della spec, adottata qui).
