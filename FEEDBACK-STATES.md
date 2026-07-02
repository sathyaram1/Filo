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
  automatica ON → `todo`, OFF → `aligned`).
- `suspicious_file` —owner→ `todo` | `attack_confirmed` | `spam_confirmed` | `archived`.
- `attack` —owner→ `attack_confirmed` | `todo` (falso positivo).
- `spam` —owner→ `spam_confirmed` | `todo`.
- `design` —owner (risponde in chat)→ `todo` | `archived`.
- `aligned` —owner→ `todo` (anche bulk dalla dashboard).
- `todo` —routine (claim §6)→ `working`.
- `working` —routine→ `revision_capability`; —TTL scaduto (riconciliazione)→ `todo`.
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

**Mittenti fidati** (`owner:`/`routine:`/`agent:`): mai `attack`/`spam`; se un livello
identità li flagga è un errore → `unlabeled` per ri-giudizio.

## 4. Tab dashboard (deriva SOLO da `status`)

`tabFor(status)` = lookup pura, senza `pipeline`, senza `isApproved`, senza `autoMode`:
- Ricevuti: `unlabeled | suspicious_file | attack | spam | design | aligned`
- In coda: `todo | working | revision_capability | revision_security | done(non rilasciato)`
- Risolti: `done(rilasciato)` — Archiviati: `archived` (+ filtro ⭐; + filtro "Bloccati
  confermati" per `*_confirmed`, decisione presa: restano ispezionabili come log lì).

La modalità automatica agisce UNA volta, al giudizio (sicuro + ON → `todo`; sicuro + OFF
→ `aligned`). Attivarla dopo NON ri-tocca i vecchi `aligned`: l'owner li approva in blocco
dalla dashboard (azione bulk `aligned→todo`, da aggiungere alla UI).

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
- I **claim file su git restano il lock primario** anti-collisione (push atomico);
  `working` è il riflesso persistito per dashboard e istanze non-routine.
- Se un'istanza trova `working` fresco: NON aspetta, passa al prossimo `todo`; se non
  c'è altro, termina con "niente da fare".
- L'Action apply-triage **riconcilia**: rilascia claim orfani (già lo fa) e resetta i
  `working` scaduti (da estendere).

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

- [ ] **F1 — Vocabolario condiviso**: `src/shared/feedbackStatus.js` (SN_FB_STATUS:
      stati, colori, tabFor, transizioni+canTransition, normalizeStatus legacy) +
      `tests/unit/feedbackStatus.test.mjs`. Caricarlo in `loader.js` e nelle pagine che
      usano manageReview.
- [ ] **F2 — Dashboard su status**: `manageReview.js` (manageTabFor→lookup su
      normalizeStatus; isApproved/autoMode fuori dalla logica tab), `manage.js`
      (bulk aligned→todo, filtro Bloccati confermati, colori/sottotesto da
      status+statusReason), `feedback.js` (STATUS_PUBLIC_MAP esteso). Unit test
      aggiornati + spec mirato manage.
- [ ] **F3 — Routine/scripts**: queue-triage + apply-triage (ALLOWED nuovi,
      canTransition, workingSince, riconciliazione working scaduti), next-feedback
      (skip working freschi), dispatch/ruoli (todo→working→revision_*→done,
      loop→design). Unit test dove possibile.
- [ ] **F4 — firestore.rules**: enum status nuovi + statusReason/workingSince in
      hasOnly + deploy (`firebase deploy --only firestore:rules` dalla root del repo).
- [ ] **F5 — Migrazione**: script `scripts/migrate-status.mjs` (mappa §8, dry-run di
      default, `--apply` per scrivere) + esecuzione + verifica in dashboard.
- [ ] **F6 — filo-security**: pipeline scrive status nativo (§7a.1-2), gate
      deterministico file → `suspicious_file` (§7a.3), stretta `storage.rules`.
      Repo separato: `C:/Users/agenti AI/Desktop/Filo/filo-security`.
- [ ] **F7 — Rifiniture**: patch notes (recap utente), capabilities se cambia qualcosa
      di visibile, PATTERNS.md se emerge un pattern nuovo, pulizia stati legacy dai
      commenti/docs (ROUTINES.md, routines/shared.md).

**Punti [DECIDERE/CONFERMARE] per l'owner:**
1. Mappatura `ignored` → `archived` (con statusReason) vs `spam_confirmed`.
2. Mappatura `review` → `revision_capability`.
3. `*_confirmed` in Archiviati sotto filtro (proposta della spec, adottata qui).
