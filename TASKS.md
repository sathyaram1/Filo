# TASKS — coda di lavoro persistente tra sessioni

Questo file è il ponte tra sessioni Claude. Quando una sessione finisce (per
contesto, per tempo, o perché l'utente chiude), la prossima riparte da qui.

## Come si usa (istruzioni per Claude)

- **L'utente dice "continua" (o simili)** → leggi questo file, prendi il primo
  task `[ ]` dall'alto, marcalo `[~]` (in corso), lavoralo, e a fine sessione
  marcalo `[x]` con una riga di esito. Se resta a metà, lascia `[~]` e scrivi
  nelle note **dove sei arrivato e qual è il prossimo passo concreto**.
- **L'utente consegna una spec grossa** → NON iniziare a implementare subito.
  Prima spezzala in task da una sessione l'uno (~sotto i 100k token di lavoro
  stimato), scrivili qui sotto con questo formato, fatti confermare l'ordine
  dall'utente, poi parti dal primo.
- **Ogni task deve essere self-contained**: chi lo legge non ha memoria delle
  conversazioni precedenti. Percorsi file, criterio di "fatto", e vincoli vanno
  scritti nel task stesso.
- **Budget contesto**: chiudi la sessione PRIMA di superare ~150k token di
  contesto (oltre i 200k il costo sale del 50%). Quando ti avvicini, finisci il
  pezzo atomico in corso, aggiorna questo file, e di' all'utente: "ok, fatto X —
  apri un'altra istanza e dimmi *continua*".
- Aggiorna questo file con Edit normale (l'hook committa e pusha da solo).

## Formato task

```
- [ ] **Titolo breve** — descrizione self-contained: file coinvolti, cosa fare,
  criterio di fatto, come verificare. (stima: S/M/L)
```

`[ ]` = da fare · `[~]` = in corso (vedi note) · `[x]` = fatto

---

## Coda

### Dashboard unificata + board utente + modelli di supporto (spec 2026-06-23)

Spec utente (chat 2026-06-23). Obiettivo: far convergere TUTTA la gestione
feedback nella nuova dashboard `filo://manage/` (la vecchia `filo://feedback/`
**resta in piedi finché non è tutto pronto** — coesistono, la elimineremo alla
fine), sistemare i bug UI della tab Revisione, e creare una **board utente
separata a permessi ridotti** dove gli utenti verificano i fix già rilasciati.

**Decisioni di design confermate dall'utente:**
- **Tutta `manage` è owner-only.** L'unica superficie a permessi ridotti è la
  board utente (gruppo DC).
- Tab di `manage`: **Ricevuti** (new + ritrovamenti agente/routine + chiarimenti,
  insieme) · **In coda** (todo + review/blocked uniti) · **Risolti** (in
  produzione) · **Archiviati** (con filtro ⭐) · **Statistiche Red Team** ·
  **Modelli di supporto**. **Bozze rimosso** → sostituito da un **⭐ preferiti**
  (parcheggio idee per il futuro) usabile in Archivio.
- **"In produzione" = il fix è in una versione RILASCIATA** (non basta `done`).
- **Archiviazione**: dopo 24h, se il **punteggio** dei voti supera una soglia →
  `archived`. Punteggio = Σ credibilità(voti "funziona") − Σ credibilità(voti
  "non funziona"); credibilità = 1 per ora. **Override owner** sempre possibile.
- **Board utente = solo verifica** (funziona/non-funziona) sui fix rilasciati.
  Superficie **positiva**: mostra solo descrizioni non tecniche, **ZERO info di
  sicurezza** (niente stati blocked/review, classi, verdetti giudici, priorità).
  Login per votare/scrivere; anonimi leggono. **10 crediti** a voto (per
  l'animazione/ricompensa, non il valore), una volta per feedback. **Niente
  timeout/penalità ora** (si tara solo con dati veri), ma il **substrato della
  credibilità** si registra subito.
- **Sanitizzazione**: rimuovere SEMPRE i metadati (identità, orario); **non**
  riscrivere il testo, salvo che un **LLM** giudichi necessaria una redazione
  (info personali) e la faccia. Il modello è configurabile.
- **Modelli di supporto**: una sezione della dashboard che centralizza la scelta
  di TUTTI i modelli di supporto (sanitizer, giudice L2, giudice red-team,
  giudice priorità), con UX **analoga a Impostazioni/Modelli e Modelli
  predefiniti** (riuso del componente esistente `src/shared/modelChainEditor.js`).

**Note di dipendenza / intreccio:**
- I gruppi **DA** (fix UI) sono indipendenti e mandabili subito.
- I giudici **L2 e red-team girano nel backend privato `filo-security`** (Cloud
  Functions), non in questo repo → centralizzare la loro scelta richiede
  coordinamento cross-repo (config su Firestore letta dalle Functions), vedi DD3.
- La board (DC) intreccia **S1 (cifratura)**: mostra SOLO la versione
  sanitizzata, mai il testo grezzo altrui.
- Più task richiedono `firebase deploy --only firestore:rules` (AZIONE OWNER) per
  i nuovi stati/campi — vedi memoria [[feedback-schema-rules-deploy]].

#### Gruppo DA — fix UI su `manage` / Revisione (indipendenti, mandabili subito)

- [x] **DA1 — Verdetti dei giudici nel pannello destro** _(fatto: sessione locale
  2026-06-23)_ — **Esito**: rimosso `renderVerdicts` + l'elemento `#mgVerdicts` (e
  la CSS `.mg-verdict*` ormai morta) dal pannello centrale. Il click su un pallino
  giudice con verdetto (`renderJudgesRow`, `.mg-dot--clickable`) ora chiama il nuovo
  `openSidebarJudge(fb, i)` che apre QUEL giudice nel pannello destro via
  `openSidebar(name, html)`: titolo = nome giudice (`judgeName`, modello reale per
  l'owner / "Giudice A/B…" per gli altri), badge classe, reasoning completo. Il
  centro resta head + riga pallini + chat + azioni. **Verificato**:
  `tests/manage-page.spec.mjs` 10/10 (riscritti i 2 spec che asserivano i verdetti
  inline → ora asseriscono pannello destro + assenza reasoning nel centro) +
  controllo a vista `test:shoot` (screenshot `da1-detail`/`da1-sidebar`).

- [x] **DA2 — Sfruttare la larghezza + righe feedback su una riga** _(fatto:
  sessione locale 2026-06-23)_ — **Esito**: aggiunto override locale `.sn-page {
  max-width: none }` in cima al `<style>` di `manage.html` (globale `pages.css`
  intatto) → la dashboard usa tutta la larghezza. `.mg-item` ora è `display:flex`
  row su UNA riga (`#N` + titolo con `white-space:nowrap` + ellissi), rimossa la
  label `.mg-item-reason` (sia dal CSS sia da `renderList`): il motivo resta
  implicito nel colore del `border-left`. Aggiunto `item.title` col testo completo
  per il tooltip. **Verificato**: `tests/manage-page.spec.mjs` 10/10 (riscritto il
  test "con dati finti" per usare il vero `renderList` via `__mgTest.setData`,
  assert: 1 item, num+titolo presenti, `.mg-item-reason` count 0, titolo
  `white-space:nowrap`, border-left non trasparente) + `test:shoot` (screenshot
  `da2-list`: larghezza piena, righe singole #236 rosso/#237 arancio col titolo
  troncato).

- [x] **DA3 — Fix grafica switch "Modalità automatica"** _(fatto: sessione locale
  2026-06-23)_ — **Esito**: `.mg-switch-track` a riposo passa da `var(--sn-border)`
  (quasi bianco sul tema chiaro → invisibile) a `var(--sn-muted)`, grigio marcato e
  theme-aware (chiaro #6e6b63 / scuro #8a8780); acceso resta `var(--sn-accent)`.
  **Verificato**: `test:shoot` off/on (screenshot `da3-off`/`da3-on`: pillola
  grigia con pallino che scorre a destra + "On") + assert nello spec esistente
  "lo switch attiva/disattiva…" che la pista a riposo è `--sn-muted` e NON
  `--sn-border` (theme-independent, 10/10 verde). Misurato che lo switch NON è
  tagliato dal bordo (35px di margine reale a innerWidth 1280: l'apparenza tagliata
  negli screenshot è scaling DPI del composite, non un bug → nessuna regressione da
  DA2).

#### Gruppo DB — dashboard unificata (modello dati + tab + migrazione)

- [x] **DB1 — Tab unificate in `manage` + merge Ricevuti/Agente/Chiarimenti**
  _(fatto: routine intelligent-brown-fnbznf, 2026-06-23)_ — **Esito**: la
  dashboard `manage` ha ora 6 tab — **Ricevuti** (`new` + ritrovamenti
  agente/routine + `clarify`), **In coda** (`todo` + `review` + i blocchi del
  pipeline, uniti), **Risolti** (`done`/`verified`), **Archiviati** (`archived`),
  **Statistiche Red Team** (segnaposto), **Modelli di supporto** (segnaposto DD1).
  Le 4 tab-lista condividono il layout a 3 colonne (`panel-list`): la lista a
  sinistra è filtrata per tab, il dettaglio al centro mostra azioni contestuali
  (sblocco per i bloccati, **box risposta owner per i `clarify`** → appende alle
  note e rimette in `todo`). Logica di mappatura feedback→tab estratta come pura
  in `manageReview.js` (`manageTabFor`/`listForManageTab`). La vecchia
  `src/pages/feedback` resta intatta (coesistenza). **Verificato**:
  `tests/manage-page.spec.mjs` 11/11 (riscritti per la nuova struttura + nuovo
  test del box chiarimenti sotto Ricevuti), `tests/unit/manageReview.test.mjs`
  26/26, e `npm test` completo — gli unici rossi (11, tutti in `feedback-*`) sono
  **pre-esistenti** (riprodotti al commit base 953e7a8, indipendenti da `manage`).
  (stima: L)

- [x] **DB2 — Stato `archived` + flag `starred` (⭐) + rimozione Bozze** — File:
  `firestore.rules` (enum `status` + campo `starred` in `affectedKeys().hasOnly`),
  `scripts/queue-triage.mjs` + `scripts/apply-triage.mjs` (nuovo status
  `archived`), `src/shared/feedback.js`, `src/pages/manage/*`. `archived` = nuovo
  stato, mostrato in **Archiviati**. **Bozze (`draft`) rimosso come tab**; al suo
  posto un **⭐ `starred`** che l'owner mette su qualsiasi feedback ("parcheggiato
  per il futuro"), visibile in Archivio con filtro ⭐ (i `draft` esistenti li
  gestisce la migrazione DB5). **AZIONE OWNER**: `firebase deploy --only
  firestore:rules`. **Done**: spec — archiviare sposta in Archiviati; ⭐ fa
  comparire nel filtro preferiti; `node --check` sugli script. (stima: M)
  _(in corso: routine affectionate-faraday-lq7r83, 2026-06-23 — **SUBSTRATO
  FATTO E VERIFICATO**; manca la **UI owner-app**, lasciata a una sessione con
  Electron)._
  - **FATTO (verificato senza Electron):**
    - `firestore.rules`: aggiunto `archived` all'enum `status` del ramo update
      admin + chiave `starred` in `affectedKeys().hasOnly` con validazione
      `is bool`. (NON toccato il ramo `isRoutine`: archiviare/stellare resta
      owner-only — blast radius stretto.) ⚠️ **AZIONE OWNER residua**: `firebase
      deploy --only firestore:rules` perché l'owner-app possa scrivere i due campi.
    - `scripts/queue-triage.mjs`: `archived` in `ALLOWED`; flag CLI
      `--starred`/`--unstar` + 6° param `starred` in `queueTriage()` (serializza
      `starred` nello spool). Per DC3 (auto-archivio a punteggio).
    - `scripts/apply-triage.mjs`: `archived` in `ALLOWED`; scrive il campo
      `starred` (bool) nel PATCH quando la coda lo porta.
    - `src/shared/manageReview.js`: `manageTabFor` già instradava `archived`→tab
      Archiviati (DB1); aggiunti i puri `isStarred(fb)` e
      `listArchiveTab(feedbacks, {starredOnly})` — filtro OFF = solo `archived`,
      filtro ⭐ ON = TUTTI i preferiti di qualunque status (recenti prima).
    - Verifica: `tests/unit/queueTriageArchive.test.mjs` (nuovo, 5 test) +
      `tests/unit/manageReview.test.mjs` (4 test ⭐ aggiunti) → 9/9 verdi; suite
      `npm run test:unit` 426/427 (l'unico rosso, `defaultsSecretsMerge`, è un
      artefatto del sandbox: `require('electron')` non installabile in cloud,
      non un bug). `node --check` ok su entrambi gli script + smoke CLI.
  - **COMPLETATO (UI owner-app, routine peaceful-allen-fyv98e, 2026-06-24):**
    - `src/pages/manage/manage.{html,js}`: nel pannello dettaglio owner un footer
      di gestione (`#mgManage`, owner-only, visibile su QUALUNQUE feedback) con un
      toggle **⭐ Preferito** (☆/★, `aria-pressed`) e un pulsante **Archivia**;
      su un feedback già `archived` il pulsante diventa **Ripristina** (→ `todo`,
      invariante UX "se puoi archiviare puoi togliere dall'archivio"). Header della
      lista Archiviati: filtro **⭐ Solo preferiti** (`#mgArchiveFilter`, visibile
      solo in quella tab) che chiama `MR.listArchiveTab(allFeedbacks,{starredOnly})`
      — OFF mostra gli `archived`, ON tutti i preferiti di ogni stato.
    - Passaggio `starred` nel percorso owner-app: `auth.js` (destructure `starred`
      in `FEEDBACK_UPDATE`) + `src/shared/feedback.js` `updateStatus` (`starred`
      come `booleanValue` in fields/mask). Le rules lo accettano già.
    - `tests/manage-page.spec.mjs`: 4 spec nuovi (archivia→lascia la coda + patch
      `status:archived`; ⭐ toggle→patch `starred:true` + bottone riflette; filtro
      ⭐ OFF=archived/ON=preferiti; Ripristina→patch `status:todo`).
    - **Verifica**: `npm run test:unit` 428/428; `tests/manage-page.spec.mjs`
      15/15 (Electron headless via Playwright, binario installato a mano: il
      download `got` di Electron abortisce nel cloud → scaricato lo zip con curl
      ed estratto in `node_modules/electron/dist`, `path.txt` SENZA newline finale).
    - Niente changelog/capabilities: `manage` è owner-only, non user-visible.
  - ⚠️ **AZIONE OWNER residua** (invariata): `firebase deploy --only
    firestore:rules` perché l'owner-app possa scrivere `archived`/`starred`.

- [x] **DB3 — "In produzione" = versione rilasciata + `resolvedInVersion`**
  _(fatto: routine blissful-hamilton-1sgrnd, 2026-06-24)_ — La tab **Risolti**
  ora contiene solo i fix **davvero in produzione**, non ogni `done`.
  - **Sorgente di "in quale versione è uscito il fix"**: al passaggio a `done`,
    `scripts/apply-triage.mjs` stampa `resolvedInVersion` = versione corrente di
    `package.json` (la release in costruzione in cui il fix confluisce).
  - **Sorgente di "ultima versione rilasciata"**: la versione dell'**app in
    esecuzione** (`app.getVersion()`), letta da `manage.js` via il recap
    aggiornamento (`get_update_recap` → `current`). L'owner gira sempre una build
    pubblicata, quindi la sua versione è per definizione l'ultima rilasciata.
  - **Logica pura** in `src/shared/manageReview.js`: `cmpVersion`, `isShipped(fb,
    releasedVersion)` e `manageTabFor(fb, {releasedVersion})`/`listForManageTab(...,
    opts)`. Un `done`/`verified` va in **Risolti** solo se `resolvedInVersion` ≤
    rilasciata; altrimenti resta in **In coda**. Casi limite: senza
    `releasedVersion` il gate è OFF (comportamento storico done→Risolti, nessuna
    regressione); un `done` storico **senza** `resolvedInVersion` è considerato
    già spedito.
  - **Verifica**: `tests/unit/manageReviewShipped.test.mjs` (11 test, asseriscono
    il successo: rilasciato→Risolti, futuro→In coda, storico→Risolti, gate-off
    invariato) → verdi; suite `npm run test:unit` 437/438 (l'unico rosso,
    `defaultsSecretsMerge`, è l'artefatto noto del sandbox: `require('electron')`
    non installabile in cloud). Aggiunto anche `tests/manage-page.spec.mjs`
    (spec DB3 che esercita il VERO renderList via `__mgTest.setReleasedVersion`)
    — **non eseguito qui** perché Electron non è installato in questo sandbox;
    girerà con la suite Playwright in un ambiente provvisto del binario.
  - Niente changelog/capabilities: `manage` è owner-only, non user-visible.

- [x] **DB4 — Struttura dati dei voti di verifica sul feedback** _(fatto:
  routine affectionate-bell-vb8kaf, 2026-06-24)_ — Substrato dei voti
  "funziona/non funziona" pronto per board (DC*) e archiviazione a punteggio
  (DC3). I voti vivono in un campo **`votes` (map) SUL documento feedback**:
  chiave = `uid` del votante, valore = `{ vote: 'works'|'broken', at: <ISO>,
  credibilitySnapshot: <num> }`. Un voto per utente, **cambiabile** (ri-PATCH
  della propria chiave) e **ritirabile** (cancellazione della chiave).
  - **`src/shared/feedback.js`** (in `SN_FEEDBACK`):
    - puri (testabili senza rete): `normalizeVotes(raw)` (scarta entry
      malformate, default credibilità=1), `tallyVotes(raw)` → `{ works, broken,
      total, score }` con **score = Σ cred("works") − Σ cred("broken")** (DC3),
      `userVote(raw, uid)`, costante `VOTE_VALUES`.
    - rete: `castVote(id, { uid, vote, credibilitySnapshot }, { idToken })` e
      `clearVote(id, uid, { idToken })` — PATCH con **updateMask mirato su
      `votes.<uid>`** (non toccano i voti altrui né altri campi).
  - **`firestore.rules`**: nuovo ramo `allow update` per `feedback/{doc}` —
    utente **loggato** che cambia **SOLO la propria chiave** del map `votes`
    (`request.resource.data.get('votes',{}).diff(...).affectedKeys().hasOnly([request.auth.uid])`),
    con validazione di forma dell'entry (vote in works/broken, at string≤40,
    credibilitySnapshot num≥0) e cancellazione consentita (ritiro voto). Il
    vincolo chiave==uid impedisce di toccare i voti altrui o qualunque altro
    campo. (Rami admin/routine invariati — blast radius stretto.)
  - **Verifica**: `tests/unit/feedbackVotes.test.mjs` (9 test: normalizeVotes
    scarta malformati + default cred, tallyVotes pesato, userVote, round-trip
    encoding Firestore `toFsValue→fromFsValue` del map voti) → 9/9 verdi; suite
    `npm run test:unit` 446/447 (l'unico rosso, `defaultsSecretsMerge`, è il noto
    artefatto del sandbox: `require('electron')` non installabile in cloud).
    Rules: bilanciamento sintattico ok; **non** compilabili qui (manca firebase CLI).
  - ⚠️ **AZIONE OWNER**: `firebase deploy --only firestore:rules` perché la board
    utente possa scrivere i voti.
  - Niente changelog/capabilities: la board utente (UI dei voti) arriva con DC*;
    qui è solo substrato dati, non ancora user-visible.

- [x] **DB5 — Migrazione dei feedback esistenti nella dashboard unificata**
  _(fatto: routine affectionate-bell-vb8kaf, 2026-06-24)_ — La migrazione era già
  **strutturalmente cablata** da DB1/DB2/DB3: `manage.js` carica TUTTI i feedback
  (`FB.list({ pageSize: 500 })`) e instrada ogni tab con la sola logica pura
  `manageTabFor`/`listForManageTab` (+ filtro ⭐ Archiviati). I `draft` (Bozze
  rimossa) cadono nel `default → inbox`, quindi restano sotto **Ricevuti** nel
  loro stato; ⭐ li può tenere per il futuro (visibili nel filtro Archiviati). La
  vecchia `feedback` resta in piedi come rete (coesistenza, DB1) → nessuna perdita.
  - **Deliverable (verifica)**: `tests/unit/manageMigration.test.mjs` (5 test):
    inietta un corpus con OGNI stato (new utente/routine/agente, clarify, draft,
    todo, review, blocked, blocco-pipeline, done, verified, archived, ignored) e
    asserisce (1) la tab attesa per ciascuno, (2) **NESSUNA PERDITA**: ogni
    feedback non-`ignored` compare in **esattamente una** tab-lista (gli `ignored`
    restano nascosti come nella vecchia dashboard — non è perdita), (3) gli
    `archived` solo in Archiviati senza doppioni, (4) il filtro ⭐ raccoglie i
    preferiti di ogni stato, (5) il gate DB3 `releasedVersion` tiene In coda un
    `done` non ancora rilasciato.
  - **Verifica**: `npm run test:unit` 451/452 (l'unico rosso, `defaultsSecretsMerge`,
    è il noto artefatto del sandbox: `require('electron')` non installabile in
    cloud). Il rendering UI delle tab è già coperto dallo spec Electron esistente
    `tests/manage-page.spec.mjs` (DB1), che gira in ambienti col binario Electron.
  - Niente changelog/capabilities: `manage` è owner-only, non user-visible.

#### Gruppo DC — board utente (verifica), permessi ridotti

- [ ] **DC1 — Pagina board utente a permessi ridotti** — Nuova pagina (es.
  `filo://board/board.html`, servita come le altre da `filo://<page>/` →
  `src/pages/<page>/`). **NON owner-gated**: login per votare/scrivere, anonimi
  leggono. Mostra SOLO contenuto sicuro: descrizioni non tecniche, **ZERO info di
  sicurezza** (niente status blocked/review, classi, verdetti giudici, priorità).
  Superficie **positiva** (novità / conferma / segnala); il red-team resta
  invisibile. Mostra il testo **sanitizzato** (metadati rimossi sempre; redazione
  LLM se serve — DD2; finché DD2 non c'è, almeno identità/orario rimossi). **Done**:
  spec — un non-owner apre la board, vede i risolti votabili, e NON vede
  status/priorità/verdetti. (stima: M)

- [ ] **DC2 — Voto funziona/non-funziona + ricompensa 10 crediti** (dipende da
  DB3, DB4) — File: board page + handler IPC + `src/main/services/creditStore.js`.
  Sui feedback **deployati** (DB3): voto ✅ funziona / ❌ non-funziona, un voto per
  utente (uid) cambiabile, scritto in DB4. **Ricompensa 10 crediti** a voto, **una
  volta per feedback per utente** (anti-doppio-premio come `rewardedFeedback` nel
  credit store), con **animazione** (riusa `flyCredits` di
  `src/content/feedback.js` / variante home). **NIENTE timeout/penalità.** **Done**:
  spec — il voto registra + accredita 10 crediti una sola volta; un secondo voto
  sullo stesso feedback non ripaga. (stima: M)

- [ ] **DC3 — Archiviazione automatica a punteggio dopo 24h** (dipende da DB2,
  DB4) — Logica pura in `src/shared/*` + unit test (no Electron) + il punto che la
  applica. Punteggio = Σ credibilità(voti "works") − Σ credibilità(voti "broken"),
  credibilità = 1 per ora. Dopo **24h** dalla messa in produzione (definire se da
  produzione o dal primo voto), se punteggio ≥ **soglia configurabile** (default
  basso alpha, es. 2) → `archived`. **Override owner** sempre. Punteggio
  fortemente negativo senza riapertura → **emerge all'owner** (sezione/badge "gli
  utenti dicono che non va"), NON auto-riapre. **Done**: unit — soglia dopo 24h
  archivia; sotto soglia no; negativo emerge; override owner archivia subito.
  (stima: M)

- [ ] **DC4 — Riapertura a pagamento** — Dalla board un utente può inviare un
  feedback che **riapre** un fix verificato (lo toglie da Risolti, torna nell'iter
  normale), **collegato all'originale**. **Costa pochi crediti** (anti-spam),
  **ricompensa a risoluzione** come gli altri feedback. **Done**: spec — la
  riapertura crea un feedback collegato, scala i crediti, e l'originale esce da
  Risolti. (stima: M)

- [ ] **DC5 — Fondamenta credibilità per utente (substrato, NO policy)** — Campo
  `credibilità` per utente (=1) in un doc dedicato (es. `users/<uid>` o dentro
  `credits`). Registrare TUTTO ciò che servirà a calcolarla un domani: storico
  voti (già DB4), esito (il voto coincideva con la decisione finale?), età
  account, frequenza — almeno i campi grezzi. Il punto dove il guadagno-da-voto
  sarà **gated dalla credibilità** esiste ma è **flag spento** (soglia che lascia
  passare tutti). **NON** implementare timeout/penalità/calcolo dinamico (senza
  dati si tara alla cieca — deciso). **Done**: unit — i record si salvano; il gate
  esiste ma è pass-through; cred resta 1. (stima: M)

#### Gruppo DD — modelli di supporto

- [ ] **DD1 — Sezione "Modelli di supporto" (riuso `modelChainEditor`)** — File:
  `src/pages/manage/*` + riuso `src/shared/modelChainEditor.js` (lo stesso
  componente dietro Impostazioni/Modelli e admin-defaults/Modelli predefiniti).
  Sezione owner-only con uno **slot per compito**: **sanitizer**, **giudice L2**,
  **giudice red-team**, **giudice priorità** (F5). Ogni slot = selettore a catena
  modelli + fallback, UX identica a `options.js`/`admin-defaults.js`. La scelta va
  salvata in un posto **leggibile anche dal backend** per i compiti che girano lì
  (DD3): un doc di config su Firestore. **Done**: spec — la sezione mostra gli slot
  e salva/ricarica la scelta col componente esistente. (stima: M)

- [ ] **DD2 — Sanitizer LLM dei feedback per la board** (dipende soft da DD1) —
  Un passo che, prima che un feedback diventi visibile sulla board, **rimuove
  sempre i metadati** (identità, orario) e fa decidere a un **LLM** se il testo
  libero va redatto (info personali) e lo redige **solo se necessario**; salva la
  versione sanitizzata accanto all'originale (l'originale owner-only/cifrato resta
  per l'owner). Modello = slot "sanitizer" (DD1) con un default se non
  configurato. **Dove gira**: valutare backend (accanto a L2) vs app; coordinare
  con `filo-security`. Intreccio **S1**: la board mostra la versione sanitizzata,
  mai il testo grezzo altrui. **Done**: spec/unit — un testo con info personali
  viene redatto; uno pulito passa invariato (a parte i metadati). (stima: M)

- [ ] **DD3 — Audit LLM hard-coded + centralizzazione (incl. cross-repo)** —
  Stanare tutti gli LLM hard-coded e portarli sotto "Modelli di supporto": nel
  repo principale (es. `src/main/services/safebrowse/llm.js`, i modelli
  dell'agente in `tests/agent`, i default provider dove ha senso); per i **giudici
  L2/red-team** che girano in **`filo-security`** (Functions), far leggere al
  backend la scelta dal doc di config di DD1 (coordinamento cross-repo,
  documentare in filo-security — vedi memoria [[auto-improvement-loop]]). **Done**:
  elenco completo degli LLM hard-coded, ognuno spostato nello slot giusto o
  documentato il perché resta; backend che legge la config. (stima: L,
  multi-sessione, cross-repo)

#### Differito (design salvato, NON ora) — voto popolare sui design-class

Quando ci sarà una **base utenti vera**, accendere il voto popolare sui feedback
classificati **"design"** (non miglioramenti puri: potenziali violazioni dei
principi di Filo / UX peggiorativa) come canale di approvazione, per rendere il
sistema più autonomo. **Invariante dura**: l'approvazione popolare cambia SOLO
se/quando un task entra in coda e con che priorità — **non eleva mai la fiducia
nel testo del feedback né salta il cancello di merge L4/L5 (R6)**. Mitigazioni da
implementare allora (discusse 2026-06-23): **report-as-attack pre-esecuzione**
(ha senso solo prima che il fix sia spedito, NON nella verifica), **tenere aperto
X ore** a prescindere dai voti, **reliability scoring** (substrato già in DC5),
**classe intermedia con approvazione owner** (già esprimibile via `blocked` +
review in manage), **sezione commenti** (testo non fidato → escaping rigoroso +
moderazione owner). Accendere **reward + penalità credibilità INSIEME** (sono due
metà della stessa moneta: la penalità serve solo perché si paga il voto).

### Sistema routine: verifica avversariale + cancello di merge + utilizzo budget (spec 2026-06-22)

Spec utente (chat 2026-06-22). Obiettivo: rendere il ciclo delle routine cloud
più sicuro e capace di **sfruttare tutto il budget 5h** disponibile su **2
account** Filo. Decisioni di design confermate dall'utente:

- **Verificare TUTTO, non selettivo.** Anche un CSS mediocre è un difetto in
  un'app che vive di UX. Niente giudice "quale feedback verificare": si verifica
  ogni correzione. Il verificatore è un sotto-agente sull'abbonamento → zero
  costi API extra.
- **Verifica indipendente e avversariale.** Chi verifica NON è chi ha corretto
  (spawn separato, parte freddo, vede SOLO il sintomo utente del feedback —
  mai il diff/ragionamento del risolutore). Mandato: riprodurre la lamentela e
  romperla con input limite.
- **Niente merge su `main` prima del PASS.** Durante tutto il ciclo
  risolvi→verifica→correggi→verifica le modifiche restano sul branch; in `main`
  solo dopo verifica passata. **Max 3 loop**, poi il feedback va in pausa in uno
  **stato dedicato** (`blocked`) e decide l'utente.
- **Orchestratore = LLM sottile** (Agent tool, non script). L'unica attivazione
  della routine fa da orchestratore e spawna worker via Agent tool (i
  sotto-agenti NON consumano attivazioni; le 5/giorno valgono solo per i trigger
  di routine). L'orchestratore è **cieco**: loop "spawna worker finché il worker
  dice «niente da fare» o il budget è quasi pieno", non legge i corpi dei
  feedback, non sa quanti ce ne sono.
- **Worker unificato** (review-or-resolve): all'avvio controlla se c'è un branch
  da revisionare → se sì lo stressa avversarialmente; altrimenti claima un
  feedback e lo risolve sul branch. Precedenza: prima smaltire le revisioni in
  sospeso, poi prendere feedback nuovi.
- **Isolamento anti prompt-injection**: orchestratore vede SOLO metadati
  (id/numero/priority/titolo/status); il **corpo libero + screenshot** (input
  non fidato) li riceve solo il worker isolato; il report del worker è trattato
  come **dati**, non istruzioni.
- **Massimizzare l'utilizzo**: soglia di costo ALTA (non conservativa). Il loop
  continua a prendere feedback e — quando finiscono — passa all'audit proattivo,
  finché la finestra 5h non è quasi piena. Su **2 account** sfasati (vedi R5).
- **Feedback corposi → branch di feature, merge su main solo a feature finita
  (Modello B).** Motivo decisivo: c'è l'**auto-update periodico**, quindi
  `main` → TUTTI gli utenti. Una combinazione problematica/compromessa non deve
  MAI toccare main → la feature spezzata vive su un branch `feature/N`; i pezzi
  `#N.M` si fondono su `feature/N` (non su main), ognuno con la sua verifica
  avversariale + L4/L5 (tengono `feature/N` pulito); il **merge verso main
  avviene UNA volta sola** a `#N.final`, con L5 + **L4 d'integrazione cieco al
  prompt** sull'intera feature assemblata. Così c'è un solo cancello verso main
  per feature, che cattura anche il pezzo malevolo solo in combinazione (che in
  un merge per-pezzo sarebbe già stato spedito agli utenti).
  - **Niente conflitti, a una condizione**: appena parte una feature multipla le
    si dà **priorità massima** e ce la si tiene finché non è finita → la flotta
    lavora solo i suoi pezzi → nient'altro fonde *sorgente* su main → `feature/N`
    non diverge → merge finale pulito. (I commit di bookkeeping su main —
    coda triage/claim in `feedback-triage/` — toccano path disgiunti dal `src/`,
    quindi non confliggono.) **Pezzi in sequenza**, non in parallelo sullo stesso
    branch (naturale: spesso dipendono l'uno dall'altro).
  - **Nota tecnica (file "caldo")**: `src/shared/patchNotes.js` è l'UNICO file
    sorgente che *ogni* fix tocca (la riga di changelog obbligatoria). In
    sequenza sullo stesso `feature/N` non confligge; ma è il punto più probabile
    di conflitto se l'invariante "feature in volo = priorità massima" si rompe
    (es. un fix urgente standalone che salta la coda mentre una feature è in
    volo). Da tenere a mente implementando R2/R3.
  - I feedback **standalone NON cambiano**: un singolo feedback = feature di
    taglia 1, branch → cancello → main. Il branch di feature riguarda SOLO le
    spezzate.
  - Lo splitting in `#N.M` esiste già (`queue-feedback.mjs --parent`).
- **Sicurezza auto-modifica L4+L5 nel cancello di merge (PER-PEZZO).** Protegge
  dal caso di una routine pilotata da un feedback con injection che committa
  codice cattivo. **L5** (blocco deterministico sui file sensibili) e **L4**
  (review LLM del diff *cieca al prompt*) girano nel merge-gate **prima** che
  ogni branch entri in main — per-pezzo, perché un controllo "solo alla fine"
  sarebbe senza denti (i pezzi sarebbero già atterrati). In più un **L4
  d'integrazione** sul diff dell'intera feature alla fine, per i problemi
  cross-pezzo. Allineare le definizioni L4/L5 al DESIGN di filo-security
  ([[auto-improvement-loop]] in memoria).

Macchina a stati feedback: `todo` → (worker risolve sul branch) → `review`
(branch pronto, campo `branch` col nome) → verifica avversariale → PASS: merge
su main + `done`; FAIL: correggi e ri-verifica (max 3 loop) → dopo 3 fail
`blocked`. Ordine = dipendenze. Numerare R1..R5.

- [x] **R1 — Nuovi stati feedback (`review`, `blocked`) + campo `branch`** —
  _(fatto: routine affectionate-faraday-ckt1iw, 2026-06-22. Aggiunti `review`/`blocked`
  all'enum admin di `firestore.rules` + campo `branch` (string, <=200) in
  `affectedKeys().hasOnly`; ramo `isRoutine` lasciato invariato — lo decide R3, e
  comunque le routine ora scrivono via Action service-account che bypassa le rules.
  Dashboard: due tab "In revisione" + "Bloccati" con conteggio e badge `⎇ branch`
  sulle card. Script `queue-triage.mjs` (nuovi status + opzione `--branch`) e
  `apply-triage.mjs` (status + patch del campo `branch`). Spec
  `tests/feedback-review-blocked-tabs.spec.mjs` verde + suite completa (484 passed,
  2 flaky proxy non correlati). **MANCA AZIONE OWNER**: `firebase deploy --only
  firestore:rules` perché i nuovi stati/campo siano accettati lato server.)_
  Aggiungi i due stati al modello feedback in tutti i punti che li enumerano:
  (a) `firestore.rules` ramo admin update riga ~143 (enum `status` → aggiungi
  `'review'`, `'blocked'`) e `affectedKeys().hasOnly([...])` (aggiungi `'branch'`
  + validazione: string, <=200); valuta se anche il ramo `isRoutine` serve
  ancora (le routine scrivono via Action service-account che bypassa le rules —
  vedi R3). (b) dashboard feedback (`src/pages/feedback/feedback.js` +
  `feedback.html`): due tab nuovi **"In revisione"** e **"Bloccati"**, con il
  conteggio e il branch mostrato sui `blocked`/`review`. (c) script di coda
  (`scripts/queue-triage.mjs`, `scripts/apply-triage.mjs`): accettare i nuovi
  status + il campo `branch`. **Done**: spec Playwright che apre la dashboard e
  asserisce i due tab + che un feedback in `review` mostri il branch; `node
  --check` sugli script. **Azione manuale**: `firebase deploy --only
  firestore:rules` (le rules non si auto-deployano — vedi memoria
  [[feedback-schema-rules-deploy]]). (stima: L)

- [x] **R2 — Cancello di merge nell'hook auto-commit** — _(fatto: routine
  peaceful-allen-otgmfi, 2026-06-23)_ — **Esito**: l'hook
  `.claude/hooks/auto-commit-merge.sh` ora NON auto-fonde/auto-pusha su `main` i
  branch `worker/*` e `feature/*` (li committa e pusha solo sul loro branch per
  tracciabilità); tutti gli altri branch (incl. `claude/*` e il lavoro locale)
  restano invariati. La fusione di questi branch passa dal nuovo
  `scripts/merge-gate.mjs <source> [--into <target>]` (default target `main`):
  fetch + checkout target + cancello di sicurezza (SEAM per R6) + merge +
  push-con-retry sui push concorrenti. Exit code: 0 fuso, 10 bloccato (R6), 20
  conflitto, 1 errore. Il cancello L4/L5 vero è lasciato come seam
  `runSecurityGate()` (no-op pass-through finché R6 non lo riempie). Cambiamento
  **additivo e dormiente**: nessuna routine usa ancora `worker/*`/`feature/*`,
  quindi non altera il comportamento attuale. **Verificato** con
  `tests/unit/mergeGate.test.mjs` (git reale in sandbox, niente Electron): (1)
  edit su `worker/*` non arriva su main ma resta sul branch, (2) `merge-gate.mjs`
  la porta su main, (3) `--into feature/N` fonde sul branch di feature non su
  main, (4) un branch normale viene ancora auto-pushato su main + test puri su
  parseArgs/isValidBranch/seam. `npm run test:unit` verde (390). NB: la suite
  Playwright/Electron non gira in questa sandbox (Electron rifiuta di partire da
  root), ma R2 non tocca codice app. **Prossimo**: R6 (L4/L5 nel seam).
  _(Spec originale R2 conservata nella history git, commit precedenti.)_

- [x] **R6 — Controlli sicurezza L4/L5 nel cancello di merge** (dipende da R2) — _(fatto: routine peaceful-allen-h8z99n, 2026-06-23)_ — **Esito**: riempito il seam `runSecurityGate()` in `scripts/merge-gate.mjs`. **L5 (deterministico, con i denti, gira sempre in-script)**: estrae i path toccati dal diff (`changedPaths`, robusto su add/delete/rename) e blocca (exit 10) se ne tocca uno sensibile — lista `SENSITIVE_PATTERNS`: `firestore.rules`/`storage.rules`, `firebase.json`/`.firebaserc`, `.claude/hooks/*`, `.github/workflows/*`, gli script deploy/triage/claim/auth (`scripts/apply-triage|merge-gate|claim-feedback|queue-*|admin-login`, `scripts/lib/*`), `src/main/services/handlers/auth.js`, `src/shared/feedback.js`, `*.env`, `*.pem`/`*.key`, json di service-account/credentials. **L4 (giudizio LLM cieco)**: il verdetto è prodotto FUORI dallo script (un node script non può spawnare un Agent sull'abbonamento) — l'orchestratore (R3) lancia un sotto-agente che vede SOLO il diff, mai il testo del feedback, e passa il verdetto via env `FILO_L4_VERDICT`/`FILO_L4_REASON`; il gate lo APPLICA soltanto (`fail`→exit 10). Isolamento strutturale: `runSecurityGate(diff, ctx)` riceve solo diff+branch+verdetto, mai il corpo del feedback. Su blocco esce 10 → l'orchestratore mette il feedback in `blocked`. **Additivo/dormiente**: nessuna routine usa ancora `worker/*`/`feature/*`. **Verificato** con `tests/unit/mergeGate.test.mjs` (esteso, 14 test verdi): L5 passa il diff pulito / blocca ogni file sensibile (anche via flusso git reale: worker che tocca `firestore.rules` → exit 10, niente su main), L4 fail→exit 10, isolamento (testo malevolo in ctx ignorato), unit puri su `changedPaths`/`l5SensitiveHits`. `npm run test:unit` verde (408/408). NB Electron/Playwright non gira in questa sandbox (root senza --no-sandbox), ma R6 non tocca codice app. **Prossimo dipendente**: R3 (recipe orchestratore — deve documentare che l'orchestratore lancia il sotto-agente L4 cieco e passa il verdetto via env prima di chiamare `merge-gate.mjs`).
  Integra nel `merge-gate.mjs`, prima di ogni fusione su `main`: **L5**
  (deterministico) = se il diff tocca file sensibili (lista da definire allineata
  al DESIGN filo-security: `firestore.rules`, `.claude/hooks/*`, script di
  deploy/triage, chiavi/config, auth…) → NON fondere, feedback in `blocked` con
  nota "attende revisione umana". **L4** (LLM) = un sotto-agente che vede SOLO il
  diff (cieco al prompt/feedback → un'injection nel feedback non può
  convincerlo) e lo giudica per problemi di sicurezza; verdetto FAIL → `blocked`.
  Entrambi **per-pezzo** (al merge di ogni `#N.M` dentro `feature/N`: tengono il
  branch pulito). **Cancello critico = `feature/N`→main** (è ciò che l'auto-update
  spedisce agli utenti): lì gira L5 completo + un **L4 d'integrazione** sul diff
  cumulato dell'intera feature, che cattura il pezzo malevolo solo in
  combinazione. **Done**: test che (1) un diff su un file sensibile va in
  `blocked` e non in main, (2) un diff pulito passa, (3) il revisore L4 non
  riceve il testo del feedback. Allineare al DESIGN di filo-security
  ([[auto-improvement-loop]]). (stima: M)

- [x] **R3 — Recipe orchestratore + worker nel CLAUDE.md** — _(fatto: routine:amazing-galileo-rkaicz, 2026-06-23)_ — **Esito**: riscritte in `CLAUDE.md` le due sezioni "Routine cloud" e "un sub-agente per feedback" col nuovo flusso. (1) "Routine cloud" ora apre dichiarando che l'attivazione È l'**orchestratore cieco** (solo metadati, mai i corpi/screenshot, report dei worker = dati); box "Stato di rollout" che chiarisce cosa è attivo (R1/R2/R6) e cosa è ancora in calibrazione/owner (R4 cost-check best-effort, R5 scheduling, `firebase deploy` rules). Step riscritti: loop cieco che spawna un worker review-or-resolve per volta (precedenza: prima le revisioni in sospeso, poi i `todo`); **macchina a stati** `todo→review→done|blocked` con max 3 loop risolvi→verifica; **cancello di merge** (orchestratore spawna sotto-agente L4 cieco al feedback, esporta `FILO_L4_VERDICT`/`FILO_L4_REASON`, lancia `merge-gate.mjs`, mappa exit 0/10/20→done/blocked); "Cost-check / budget" R4 best-effort (`npx ccusage@latest blocks --active --json`, fallback al budget di contesto se non gira). (2) Nuova sezione "Orchestratore + worker unificato (review-or-resolve)": worker = risolutore O verificatore indipendente (spawn fresco, vede solo il sintomo utente, mai il diff/ragionamento del risolutore), sequenziale (race su `.git`), `npm test` una volta dall'orchestratore, modelli Opus/Sonnet; sotto-sezione **Modello B** completa (pezzi `#N.M` in sequenza su `worker/<N.M>`→`feature/N`, `#N.final` con L4 d'integrazione cieco, feature in volo = priorità massima, parallelismo vero ancora escluso). **Verificato**: doc-only, dry-run mentale del flusso senza buchi; `node --check` sui 4 script referenziati (merge-gate/queue-triage/claim-feedback/queue-feedback) verde; commit/push ancora funzionanti (claim R3 atterrato su origin/main). **Non incluso (scope)**: la sezione "Push automatico su origin/main" (riga ~38) descrive ancora genericamente l'auto-merge su main — vero per `claude/*`/locale, non più per `worker/*`/`feature/*` (gestito da R2); lasciata intatta perché fuori dalle due sezioni di R3, ma da allineare se l'owner vuole. **Prossimo dipendente**: R4 (cost-check, gated sul feedback diagnostico ccusage) e R5 (owner). _(Spec originale R3 conservata nella history git.)_

- [ ] **R4 — Cost-check / utilizzo budget nella sandbox cloud** — Verifica che
  `npx ccusage@latest blocks --active --json` giri nella sandbox cloud (Linux,
  node, rete) e legga il `costUSD` della finestra 5h attiva (include la spesa dei
  sotto-agenti, stesso account/processo). Definisci la regola operativa per
  l'orchestratore: prima di lanciare un nuovo worker, leggi `costUSD`; se <
  soglia → procedi; se ≥ soglia → niente nuovi feedback, finisci/checkpoint,
  termina. Soglia ALTA (obiettivo = usare il budget), **da calibrare al primo
  429** osservato (placeholder finché non c'è il dato). Rete di sicurezza:
  intercetta il 429 → checkpoint stato + rilascio claim. **Done**: comando
  ccusage documentato + funzionante in cloud; regola scritta nel CLAUDE.md
  (insieme a R3). **NB**: la domanda "ccusage gira in cloud?" è già stata
  accodata come feedback diagnostico (2026-06-22, priorità 2, "Diagnostica:
  ccusage gira nella sandbox cloud?") — una routine lo testa e risponde in
  `clarify`. Aspettare quella risposta prima di implementare R4. (stima: M)

- [ ] **R5 — (UTENTE, su claude.ai) Scheduling 2 account sfasati** — NON è codice,
  lo fa l'utente nell'UI delle routine. Crea/aggiorna la routine su **entrambi**
  gli account Filo (non quello privato), cron ogni 6h **sfasati**: account A
  `0 0,6,12,18 * * *`, account B `0 3,9,15,21 * * *` (equidistanti 6h ciascuno,
  insieme coprono ogni ~3h, ogni run trova una finestra 5h fresca). Verificare
  che `git push origin main` sia autenticato nella sandbox di entrambi gli
  account. Dipende da R1-R4 fatti. (utente)

### Dashboard revisione sicurezza (manage) — fatto, con dipendenze aperte (2026-06-23)

Migliorata la UI di `filo://manage/` tab Revisione (richiesta owner in chat):
(1) tutti i verdetti dei giudici **inline insieme** (non uno per click); (2) nome
del **modello** del giudice mostrato all'owner, anonimizzato "Giudice A/B…" per
gli altri; (3) **reasoning collassabile** sopra la chat; (4) **"Accetta e
sblocca"** + commento opzionale (owner) → scrive `reviewDecision='accepted'` +
`reviewComment` + `reviewedAt`, `status`→`todo`, il feedback esce dai Bloccati e
rientra in coda. Bug collaterale corretto: `renderList` lasciava la card vecchia
in un contenitore nascosto quando la lista si svuotava. **Verificato**:
`tests/manage-page.spec.mjs` 10/10 + `tests/unit/manageReview.test.mjs` 18/18.
File: `src/pages/manage/manage.{html,js}`, `src/shared/manageReview.js`
(classifyBlock esclude gli accettati), `src/shared/feedback.js` (updateStatus +
campi review), `src/main/services/handlers/auth.js`, `firestore.rules`.

DIPENDENZE APERTE (non chiudibili da questo repo):
- [ ] **Deploy rules — AZIONE OWNER**: `firebase deploy --only firestore:rules`
  perché i nuovi campi `reviewDecision`/`reviewComment`/`reviewedAt` siano
  accettati lato server (finché non lo fai, l'accept fallisce con permission
  denied). (Nota: in sospeso anche il deploy rules di R1 per `review`/`blocked`/
  `branch`.)
- [x] **Backend sicurezza (privato) — nome modello nei verdetti** (fatto
  2026-06-23, repo filo-security commit 7ce1570): `l2/judges.js` (makeJudge) +
  `l2/index.js` (runPanel) ora includono `model` in ogni verdetto; arriva fino a
  `pipeline.verdicts[]`. 145/145 test.
- [x] **Backend sicurezza (privato) — onorare l'override** (fatto 2026-06-23,
  stesso commit): guardia su `reviewDecision === 'accepted'` (match esatto) in
  `pipeline.js` `decide()` (→ `owner_accepted`) + short-circuit in `runner.js`
  (niente chiamate LLM, niente ri-blocco). Test parametrico che varianti
  ('Accepted',' accepted','accept',null) NON bypassano.
- [ ] **Deploy functions — AZIONE OWNER**: il codice backend è su
  `origin/main` di filo-security ma le Cloud Functions vanno **deployate** per
  andare in produzione: `firebase deploy --only functions` dalla root di
  filo-security (a meno che non ci sia già una CI che lo fa al push). Finché non
  è deployato, in produzione i verdetti non avranno `model` e l'override non sarà
  onorato lato server.

### Sicurezza: lettura feedback non più pubblica (spec 2026-06-22)

- [ ] **S1 — Lockdown lettura feedback + canale di lettura per le routine**
  (GATE del go-live routine) — Oggi `firestore.rules` ha `match /feedback`
  `allow read: if true`: chiunque (con la API key non-segreta del client) legge
  l'intero documento, **`status` incluso**. Con il nuovo sistema il feedback è
  una superficie d'attacco (injection nel testo) e `blocked` è il segnale "il tuo
  attacco è stato beccato" → lettura pubblica = **hill-climbing regalato**
  all'attaccante. Va chiuso. **Problema duro da risolvere INSIEME**: le routine
  oggi leggono i feedback *grazie* alla lettura pubblica e **non hanno auth
  sicura** (l'account robot è bloccato, niente secret store) — e il repo
  principale è **pubblico**, quindi non può ospitare i feedback. Le rules
  Firestore controllano la lettura **per-documento, non per-campo** (non puoi
  rendere pubblico `text` e privato `status`). **Il git è ANCH'ESSO un leak**
  (verificato 2026-06-22): `queue-feedback.mjs` e `queue-triage.mjs` scrivono
  `text`/`name`/`notes` in `feedback-triage/*.json` e fanno commit+push sul repo
  **pubblico**, e restano **nella history per sempre** anche dopo che la Action
  svuota la coda. Quindi S1 deve chiudere DUE canali: Firestore E il git.
  **APPROCCIO DECISO (owner, 2026-06-23): (B) CIFRATURA.** L'app cifra i campi
  sensibili con una **chiave pubblica** di Filo prima di scriverli (Firestore o
  coda git); decifrano solo chi ha la **chiave privata**: l'owner (dashboard,
  sulla sua macchina), il backend di sicurezza (filo-security, chiave nei
  secrets delle Functions) e le routine (chiave passata nel prompt). Il
  ciphertext è innocuo ovunque → Firestore e git pubblici restano ok, niente
  repo privato, niente auth-routine da risolvere, e l'hill-climbing è battuto
  (l'attaccante non ha la chiave). **Prima di iniziare, leggi il DESIGN di
  filo-security** ([[auto-improvement-loop]]) e coordina lo schema chiavi col
  backend (è lui che decifra per giudicare e che scrive `pipeline`).

  Spezzato in sotto-task ordinati (S1.1→S1.5), uno per sessione:
  - [x] **S1.1 — Modulo crypto condiviso** _(fatto: sessione locale 2026-06-24)_ —
    **Esito**: `src/shared/feedbackCrypto.js` (IIFE su globalThis `SN_FEEDBACK_CRYPTO`)
    implementa un *sealed box* su **WebCrypto** (zero dipendenze nuove, gira identico
    in Node 22 e nel browser): ECDH **P-256** con coppia EFFIMERA per messaggio →
    HKDF-SHA256 (info = chiave effimera) → AES-256-GCM. API:
    `encryptForOwner(text[,pub])`/`decrypt(str,priv)` (stringa `FENC1:`+base64url),
    `encryptBytesForOwner`/`decryptBytes` (per gli screenshot, ritorna/accetta
    Uint8Array), `isEncrypted`, `hasPublicKey`. La PUBBLICA vive in
    `src/shared/feedbackPublicKey.js` (committabile, ora `null` = cifratura inattiva
    finché l'owner non genera la coppia); la PRIVATA non tocca mai il repo.
    `scripts/gen-feedback-keys.mjs` genera la coppia, scrive la pubblica nel file
    (sostituzione fra marcatori) e **stampa** la privata con le istruzioni su dove
    metterla (owner/Functions secret/env routine `FILO_FEEDBACK_PRIVKEY`); `--print`
    per stampare senza toccare il file. Registrati nel loader (pubkey prima di
    crypto). **Verificato**: `tests/unit/feedbackCrypto.test.mjs` 12/12 (round-trip
    testo+byte, unicode/emoji, chiave effimera→output sempre diverso, privata
    sbagliata non decifra, ciphertext manomesso rifiutato da AES-GCM, no-op su null,
    errore esplicito senza chiave); suite unit completa 465/465; pipeline end-to-end
    provata davvero (gen reale → bake → cifra con pubblica del file → decifra con la
    privata stampata → file ripristinato a null per non committare chiavi orfane);
    `node --check` su tutti i file nuovi. **Azione owner (rimandata a S1.5)**: girare
    `gen-feedback-keys.mjs` per attivare la cifratura e custodire la privata.
    **Prossimo**: S1.2 (cifrare in scrittura: submit + code git + screenshot). (stima: M)
  - [~] **S1.2 — Cifra in scrittura** _(Fase 1 fatta, in corso — sessione locale 2026-06-24)_:
    **Fatto**: `SN_FEEDBACK.submit` cifra `text`, `url`, `title`, `name` prima di
    scrivere su Firestore; `updateStatus` cifra `notes` e `reviewComment`; gli
    screenshot/allegati vengono cifrati byte-by-byte con `encryptBytesForOwner`
    prima dell'upload su Storage. `queue-feedback.mjs` usa `queueFeedbackCreateEncrypted`
    che cifra `text`/`name`/`notes` nei file di coda git. `queue-triage.mjs` usa
    `queueTriageEncrypted` che cifra `notes`. Helper riusabili in
    `scripts/lib/encrypt-feedback-fields.mjs`. Guard inclusa: senza pubkey tutto
    in chiaro come prima. Fuori scope (→ Fase 2): `status`, `pipeline`, `verdicts`,
    `clientId` (dipendenze su rules/C5/filtraggio). (stima: L)
  - [~] **S1.3 — Decifra in lettura** _(Fase 1 fatta, in corso — sessione locale 2026-06-24)_:
    **Fatto**: Handler IPC `FEEDBACK_DECRYPT_FIELDS` nel main (`src/main/services/handlers/auth.js`)
    che riceve campi FENC1: dal renderer, li decifra con la privata, ritorna plaintext
    (privata NON lascia mai il main). Slot chiave privata in `getPrivateKey()`: legge
    da env `FILO_FEEDBACK_PRIVKEY` → `tests/agent/.env` → storage.json campo
    `feedbackPrivateKey`. Helper riusabile `scripts/lib/decrypt-feedback-fields.mjs`
    per le routine (passo NON-LLM: privkey via env, plaintext ai worker). Retrocompat:
    valori in chiaro passano invariati. Senza privata → placeholder leggibile.
    Costante `MSG.FEEDBACK_DECRYPT_FIELDS` in `src/shared/messages.js`. Test unit
    471/471. **Prossimo**: integrare il renderer (manage.js chiama
    `FEEDBACK_DECRYPT_FIELDS` dopo `FB.list()`), e la Fase 2 (status/pipeline/verdicts/clientId).
  - [ ] **S1.4 — Coordina col backend filo-security**: il backend deve decifrare
    il feedback per farlo giudicare (chiave privata nei secrets delle Functions)
    e **cifrare `pipeline`/`verdicts`** che scrive. Cross-repo: documenta lì.
    Le rules Firestore possono lasciare la lettura com'è (il contenuto è cifrato),
    ma verifica che NESSUN campo in chiaro riveli lo stato di blocco. (stima: M)
  - [ ] **S1.5 — Slot chiave (azione owner)**: dove l'owner mette la privkey
    (setting locale / env), dove le routine la ricevono (prompt→env), dove il
    backend la tiene (Functions secrets). Documenta la rotazione. La generazione
    e l'inserimento della chiave sono **azione owner**.
  **Done complessivo**: testo/note/stato/verdetti dei feedback non leggibili da
  chi non ha la chiave, su NESSUN canale (Firestore, git, Storage); owner +
  routine + backend continuano a lavorare via decrypt. (stima: L, multi-sessione)

### Manifest capacità di Filo + feedback autonomo (spec 2026-06-22)

Spec utente (chat 2026-06-22). Due feature collegate: F4 dipende da F1/F2.
Obiettivo: l'agente dentro Filo conosce TUTTO ciò che Filo sa fare (manifest), e
quando l'utente chiede qualcosa di non supportato — o si lamenta di sfuggita di
qualcosa di rotto — Filo **invia un feedback in autonomia**, senza azione utente.

- [x] **F1 — Manifest delle capacità (bootstrap retroattivo)** — _(fatto:
  routine blissful-hamilton-0853rw, 2026-06-23)_ — Creato
  `src/shared/capabilities.js` (IIFE su globalThis come `patchNotes.js`,
  registrato nel loader dopo patchNotes): **44 capacità** curate e verificate
  incrociando il codice (shortcut in `src/main/shortcuts.js`, icone/azioni del
  menu in `src/content/menuIcons.js`+`actions.js`, etichette reali da
  `src/shared/i18n.js`, le 14 pagine in `src/pages/*`). Ogni voce: `id` stabile
  kebab-case, `title`, `category` (12 categorie), `desc` e `invoke` in termini
  utente, `doesNot` dove utile (per F4). API: `index()` (indice compatto
  id/title/category per F2), `get(id)`, `byCategory()`, `all()`. **Verifica**:
  unit test `tests/unit/capabilities.test.mjs` (6 test, integrità + anti-stale
  che incrocia shortcut e pagine filo:// col codice reale → diventa rosso se una
  capacità deriva); suite unit 388/388 verde; app che bootta con il nuovo
  require nel loader (sentinel smoke scritto). Originariamente stima L. **Done**: file completo, accuratezza verificata incrociando col
  codice (la "verifica retroattiva"). (stima: L)

- [x] **F2 — Esporre il manifest all'agente di Filo (on-demand)** — _(fatto:
  routine gifted-goldberg-gl8x1i, 2026-06-23. L'agente di chat (filoChat) ora ha
  SEMPRE in contesto l'**indice compatto** delle capacità (titolo + id per
  categoria, generato da `SN_CAPABILITIES.renderIndexForPrompt()`), abbastanza per
  sapere SE Filo fa una cosa senza pesare sul prompt. Il **dettaglio lazy
  on-demand** è una nuova azione `CAPACITA_DETTAGLIO {ids}` (registrata a livello 1
  in `actionLevels.js`): l'agente la emette quando gli serve il "come si attiva" o
  i limiti esatti, l'handler restituisce desc/invoke/doesNot dal manifesto
  (`renderDetailForPrompt`), e il loop di auto-continuazione della dashboard
  ri-immette il dettaglio nel contesto (come per l'output dei comandi) così
  l'agente risponde nello stesso invio. Istruzione di **onestà** nel prompt: se
  nessuna capacità corrisponde, dire che Filo non sa farlo (niente procedure
  inventate). Chip "📖 Verifico cosa so fare" per trasparenza. Verifica: 6 unit
  test in `tests/unit/capabilitiesPrompt.test.mjs` (indice/dettaglio/prompt/livello)
  + 2 spec Playwright `tests/filo-capability-lookup.spec.mjs` che asseriscono il
  round-trip (il dettaglio REALE rientra nel contesto al 2° turno) e l'indice
  sempre presente; suite completa 486 passed, 2 flaky non correlati
  (proxy/tab-width). **Nota**: il manifesto NON ha una voce per l'assistente di chat
  stesso — possibile gap da valutare, non toccato qui per non fare scope creep.)_

- [x] **F3 — Regola di sincronizzazione anti-stale** — _(fatto: routine
  affectionate-bell-u2mnxt, 2026-06-23. Aggiunta a CLAUDE.md la sezione
  "Manifesto capacità: aggiorna `capabilities.js` ad OGNI capacità che cambia"
  (stesso pattern dei Patch notes: nuova/cambiata/rimossa → aggiorna la voce nello
  stesso commit; rimanda all'unit test anti-stale). Aggiunto l'angolo di audit
  "Drift del manifesto capacità" alla lista 6b. Verificato: il test anti-stale
  `tests/unit/capabilities.test.mjs` passa 6/6 senza Electron → manifesto allineato
  alla realtà ora.)_

- [ ] **F4 — Feedback autonomo da Filo** (dipende da F1/F2) — Quando l'agente
  conclude con confidenza ALTA (usando il manifest) che una richiesta è fuori
  capacità, o rileva una lamentela "di sfuggita" su qualcosa di rotto → compone e
  **invia un feedback senza azione utente**, marcato con source `auto:*`
  (capability-gap / complaint) così la dashboard lo raggruppa (come i ritrovamenti
  routine in tab "Agente"). **DECISIONI CONFERMATE (utente, 2026-06-22):**
  (a) **PRIVACY** — sempre **anonimizzare a monte** (descrizione generica della
  capacità mancante, NIENTE URL/testo personale verbatim; minimizzare il contesto
  auto-allegato). Inoltre i feedback NON devono più essere pubblici → vedi **S1**
  (lockdown lettura). Vale per tutti i feedback, non solo gli automatici.
  (b) **notifica** — invio immediato + **toast non bloccante con undo**
  ("L'ho segnalato a chi sviluppa Filo") + **voce in Impostazioni/Sicurezza,
  ON di default** per abilitare/disabilitare il feedback autonomo.
  (c) **dedup** — gestito da **F5** (groomer), non rimandato.
  (d) **crediti** — NIENTE +5 per-feedback automatico (si farmerebbe); invece un
  **bonus giornaliero ~+10 crediti finché l'opzione è ON** (incentivo a tenerla
  attiva; si aggancia al refill giornaliero del motore crediti C1).
  **Done**: spec che simula una richiesta fuori-capacità → asserisce invio di un
  feedback **sanitizzato** col source corretto, il toast con undo, e il bonus
  giornaliero condizionato al setting. (stima: L)

- [ ] **F5 — Groomer della coda: dedup + priorità** — Dopo i filtri di sicurezza,
  uno step che legge i feedback in coda e: se è un **duplicato**, lo **allega al
  primo** (arricchendo l'originale con eventuali info nuove sul bug) invece di
  creare un doppione; **alza la priorità** dell'originale in base alla domanda
  ripetuta (più utenti la chiedono → più priorità). Può essere lo stesso
  componente che decide la priorità. **Dedup sicuro**: per gli auto-feedback usa
  il `capability-gap id` (dati strutturati, immune a injection); per il testo
  libero degli utenti, similarità/LLM **trattando il testo come non-fidato** (non
  eseguire istruzioni dal testo). **Rischio injection: basso** (deciso utente
  2026-06-22): pur leggendo tutta la coda, il peggio che questo step può fare è
  cambiare una priorità o accorpare un feedback — irrilevante rispetto a un
  attacco vero; inoltre L1/L2 girano PRIMA. Quindi cautela sì, ma non è un
  bloccante.
  **Done**: spec che invia 2 feedback equivalenti → asserisce 1 solo originale
  con priorità alzata e il secondo allegato. (stima: M)

- [x] **F6 — Completare il manifest: sottosistema ASSISTENTE mancante** — _(fatto: routine happy-curie-q67v31, 2026-06-23)_ — **Esito**: aggiunte al manifesto `src/shared/capabilities.js` 7 voci per il sottosistema assistente, prima assente: `filo-assistant` (chat "Chiedi a Filo", FILO_CHAT), `generate-dashboard` (dashboard personale, FILO_GENERATE_DASHBOARD), `agent-actions` (Filo agisce al posto tuo con conferme, FILO_RUN_ACTION/FILO_CONFIRM_ACTION), `filo-memory` (FILO_GET_MEMORY), `filo-notes` (FILO_GET/ADD/DELETE_NOTE), `filo-timers` (FILO_GET/ADD/DELETE_TIMER + STOP_TIMER_ALARM), `filo-notifications` (FILO_GET_NOTIFICATIONS/DISMISS_NOTIFICATION). Tutte con `desc`/`invoke`/`doesNot` per l'utente; il nuovo-tab è la pagina dell'assistente (filo://newtab → dashboard.html), citato come filo://dashboard/dashboard.html. **Test esteso**: `tests/unit/capabilities.test.mjs` ora estrae tutti gli `on(MSG.FILO_*)` da `filo.js` e li incrocia con il manifesto via mappa `FILO_MSG_TO_CAP` (+ allowlist `INTERNAL` per `FILO_GET_STATE`): un nuovo handler FILO_* senza voce → test ROSSO. **Verificato**: `tests/unit/capabilities.test.mjs` 7/7; suite unit 409/410 (l'unico fallimento è `defaultsSecretsMerge.test.mjs`, preesistente e indipendente: richiede il modulo `electron` non installato in questa sandbox). Prova della "rossezza" del test fatta rimuovendo una voce in memoria. **Fuori scope, da valutare**: le pagine sicurezza `filo://redteam/redteam.html` e `filo://manage/` sono raggiungibili dall'utente ma non hanno una voce nel manifesto (sottosistema sicurezza, distinto dall'assistente) — candidato per un F-successivo o per l'audit "drift del manifesto". La
  verifica del 2026-06-23 (controllo del codice) ha trovato che
  `src/shared/capabilities.js` copre bene browser/menu/pagine (43 voci, il test
  `tests/unit/capabilities.test.mjs` passa) ma **manca tutto il sottosistema
  assistente di Filo**, esposto in `src/main/services/handlers/filo.js`. Aggiungi
  voci dedicate (id kebab-case stabile, `desc`/`invoke`/`doesNot` per l'utente)
  per: **memoria di Filo** (`FILO_GET_MEMORY`), **timer** (`FILO_ADD_TIMER`/
  `GET_TIMERS`/`STOP_TIMER_ALARM`/`DELETE_TIMER`), **note** (`FILO_ADD_NOTE`/
  `GET_NOTES`/`DELETE_NOTE`), **notifiche** (`FILO_GET_NOTIFICATIONS`/
  `DISMISS_NOTIFICATION`), **chat con Filo** (`FILO_CHAT`), **genera dashboard**
  (`FILO_GENERATE_DASHBOARD`), **azioni agentiche sulla pagina** (`FILO_RUN_ACTION`/
  `FILO_CONFIRM_ACTION` — Filo che agisce al posto dell'utente, col suo confine
  `doesNot`). **Metodo**: scorri TUTTI gli `MSG.FILO_*` di `filo.js` e ogni voce
  utente che ne deriva; poi ri-controlla che nessun'altra superficie (content
  actions, pagine `filo://` come `redteam`, shortcut) sia rimasta fuori. **Done**:
  ogni feature assistente reale ha una voce nel manifest; estendi
  `capabilities.test.mjs` perché incroci anche gli `MSG.FILO_*` chiave col
  manifest e diventi rosso se manca una voce. (stima: M)

### Sistema crediti + ricompense feedback + popup aggiornamento (spec 2026-06-17)

Spec utente (chat). Decisioni di design confermate dall'utente:
- **Crediti su Firestore per-account** (collezione `credits`, doc per utente),
  con **cache locale** in `storage.json` come copia di lavoro veloce/offline che
  si sincronizza al login e dopo ogni mutazione.
- **Costo reale dai token**: ogni chiamata AI passa da `SN_PROVIDERS`
  (`src/main/services/providers/index.js`) che già ritorna `usage`
  (promptTokens/completionTokens). Da token × prezzo modello → costo € (tracciato
  con 1 decimale **dietro le quinte, mai mostrato**); crediti consumati = costo/0,0008
  (1 credito = 0,08 centesimi = €0,0008).
- **Recap aggiornamento da file changelog curato** (`src/shared/patchNotes.js`,
  IIFE su globalThis): lista ordinata di versioni con `features[]`/`fixes[]` non
  tecniche. All'avvio si confronta la versione vista l'ultima volta con
  `app.getVersion()` per calcolare "quante patch sei indietro"; il box mostra
  `vecchia → nuova` in alto e ha un pulsante per condividere/copiare il recap.

Ordine = dipendenze (il motore va per primo). Numerare i task come C1..C5.

- [x] **C1 — Motore crediti: ledger Firestore per-account + conteggio API a token + refill mezzanotte**
  (2026-06-17) — FATTO il motore + l'accounting + i test. Cosa c'è:
  `src/main/services/creditStore.js` (`SN_CREDITS`, logica pura + cache locale):
  saldo iniziale 1000, refill **+100/mezzanotte locale** lazy multi-giorno (tetto
  30 gg anti-abuso orologio), conversione costo€→crediti (1 cr = €0,0008),
  aggregazione **per tipo d'uso** (`SN_CONST.CREDIT_USAGE_GROUPS`: correttore,
  riordino schede, chat, traduzione…) e per-azione col costo€ **dietro le quinte**;
  `publicView` elimina il costo € dalla vista UI. Aggancio all'accounting:
  `costTracker.record` ora chiama `SN_CREDITS.recordConsumption` → **tutti** i ~7
  call site AI coperti senza ritoccarli. IPC `GET_CREDITS`/`CREDITS_CHANGED`/
  `CREDITS_AWARD_FEEDBACK` in `handlers/credits.js` (+wire in handlers.js). Sync
  Firestore `credits/<uid>` per-account: load/adopt al login (lazy su GET_CREDITS),
  push debounced su ogni mutazione, via REST con ID token utente (helper REST
  esportati da feedback.js). Regola Firestore `match /credits/{uid}` (owner-only).
  Costanti `CREDIT` (incl. FEEDBACK_SEND=5 e tabella priorità 50/100/200/300).
  Scaffold changelog `src/shared/patchNotes.js` + sezione CLAUDE.md "Patch notes".
  **Verificato**: `npm run test:unit` 326/326 verdi (16 nuovi in
  `tests/unit/creditStore.test.mjs`: refill multi-giorno, costo→crediti,
  aggregazione per uso, vista pubblica senza €, ricompense); `node --check` su
  tutti i file toccati OK.
  **NON verificato / azioni manuali richieste**:
  (1) il round-trip Firestore live NON è testato headless (serve utente loggato);
  (2) **le regole vanno deployate**: `firebase deploy --only firestore:rules` —
  finché non lo fai, la sync per-account fallisce silenziosamente e i crediti
  restano nella cache locale (offline). Caveat: client-authoritative (alpha),
  vedi commento nelle rules.
  — Crea un *credit store* nel main process (es. `src/main/services/creditStore.js`,
  IIFE/CommonJS coerente col modulo) che tiene il saldo + uno storico aggregato
  **per tipo d'uso** (chat, correttore ortografico, riordino schede, spiegazione,
  ricerca semantica, traduzione, ecc.) e la cache locale in `storage.json`.
  Sincronizzazione Firestore: doc per utente nella collezione `credits` (chiave =
  uid/localId della sessione, fallback email), scritto via REST col pattern di
  `src/shared/feedback.js` (`toValue`, FIRESTORE_BASE) e Bearer
  `auth.getIdToken()`. Saldo iniziale **1000**; **+100 a mezzanotte** (refill lazy:
  alla lettura/avvio confronta `lastRefillDate` con oggi e accredita i giorni
  mancanti, una volta sola per giorno). Aggiornare `firestore.rules` perché un
  utente legga/scriva **solo il proprio** doc credits (documentare il caveat
  abuso: client-authoritative, accettabile in alpha) e **deployare le regole**
  (`firebase deploy --only firestore:rules`). Agganciare il conteggio:
  centralizzare in `SN_PROVIDERS` o in un wrapper attorno ad esso un hook
  `onApiCall({ usage, model, tokens, costEur, credits })` e **etichettare ogni
  call site** (i ~7 in `handlers.js`/`ai.js`) con il proprio `usage` type via un
  parametro che arriva fino al provider. Tabella prezzi modelli (usare il pricing
  di OpenRouter quando disponibile dal model list; tabella statica per Gemini;
  fallback stima). IPC `credits_get` (saldo + aggregato per uso, **senza** il
  costo €) per la UI. **Done**: unit test in `tests/unit/` per (a) refill
  mezzanotte multi-giorno, (b) conversione token→costo€→crediti, (c) aggregazione
  per uso. Verifica: `npm run test:unit`. (stima: L)

- [x] **C2 — Pagina Crediti nel profilo + icona moneta cinese + grafico a torta**
  (2026-06-17) — FATTO. Voce **"Crediti"** aggiunta al menu account della shell
  (sia loggato sia sloggato), apre `filo://credits/credits.html` (servita
  automaticamente dal protocol handler `filo://<page>/` → `src/pages/<page>/`, no
  registrazione extra). Nuova pagina (`credits.html`/`.css`/`.js`): saldo grande
  con **icona moneta forata cinese + filo annodato** (nuova icona `credits` in
  `src/shared/icons.js`), **grafico a torta SVG fatto a mano** del consumo per
  TIPO D'USO (legge `byUsage` da `GET_CREDITS`, ogni fetta `data-group` + legenda),
  movimenti recenti dalle ricompense, hint refill/offline. **Mai** il costo in €
  (usa `publicView`). Live-refresh su `CREDITS_CHANGED`. Nuovo pattern in
  PATTERNS.md (chart SVG a mano, niente lib, CSP). Changelog aggiornato.
  **Verificato**: `tests/credits-page.spec.mjs` 2/2 verdi (saldo 700 dopo consumo
  seed, 2 fette con etichette giuste + valori in legenda; stato vuoto a 1.000) +
  `test:shoot` visivo dello stato vuoto (icona/tema/layout ok).
  — Aggiungi la voce **"Crediti"** nel menu account della shell
  (`src/renderer/shell.js:245`, ramo loggato e sloggato) che apre una nuova pagina
  `filo://credits/credits.html` (registrarla nel protocol/router come le altre
  pagine in `src/pages/`). La pagina mostra: saldo corrente, **icona moneta forata
  cinese con un filo che ci passa attraverso** (SVG nuovo, da aggiungere anche a
  `src/shared/icons.js` come icona riutilizzabile dei crediti), e un **grafico a
  torta del consumo per tipo d'uso** (NON per modello: correttore, riordino
  schede, chat, ecc.) leggendo l'aggregato da `credits_get`. NON mostrare mai il
  costo in €. Storico essenziale delle ultime voci. Segui `PATTERNS.md` per lo
  stile. **Done**: spec Playwright che apre la pagina, asserisce saldo + presenza
  del grafico con le fette attese; check visivo `test:shoot`. (stima: M)

- [x] **C3 — Ricompense feedback: +5 all'invio con animazione, variabile alla risoluzione**
  (2026-06-17) — FATTO la parte invio (la variabile alla risoluzione resta C5).
  All'invio riuscito di un feedback il box chiede `CREDITS_AWARD_FEEDBACK`
  (handler già pronto da C1, +5 = `CREDIT.FEEDBACK_SEND`) e fa partire
  `flyCredits()` in `src/content/feedback.js`: alcune "monete credito" (icona
  `credits` dorata) volano dalla posizione del box verso l'angolo in **alto a
  destra** con etichetta "+5", via Web Animations API (arco + stagger + fade,
  rispetta `prefers-reduced-motion`). Toast aggiornato ("+5 crediti"). La
  ricompensa compare anche nei "movimenti recenti" della pagina Crediti
  (`feedback_sent`, già mappato). **Decisione di design**: la spec diceva "icona
  profilo *nella shell*", ma l'icona account vive nella home (la barra chrome è
  nascosta) e soprattutto **la shell disegna solo la barra in alto — l'area
  pagina è coperta dalla WebContentsView nativa, quindi un'animazione disegnata
  dalla shell sarebbe occlusa**. Perciò l'animazione vive nel content overlay
  (dove sta il box) e punta all'angolo alto-destra, la direzione del profilo.
  **Verificato**: `tests/feedback-credit-reward.spec.mjs` 1/1 verde (submit
  stubbato senza rete; asserisce saldo **+5 esatto** dopo l'invio e la comparsa
  del layer `.sn-fb-credit-fly`). Changelog aggiornato. Animazione transitoria
  (~1s): non catturabile in modo affidabile con uno shot statico, la sua
  presenza è asserita dallo spec.

- [x] **C4 — Popup recap aggiornamento (feature in alto, bugfix in basso, non tecnico)**
  (2026-06-17) — FATTO. Il recap vive nella pagina home (`src/pages/dashboard`):
  all'avvio il main (`handlers/misc.js`, nuovi `GET_UPDATE_RECAP`/`MARK_UPDATE_SEEN`)
  confronta `LAST_SEEN_VERSION` salvata con `app.getVersion()` e ritorna le note
  delle versioni saltate da `src/shared/patchNotes.js` (ora caricato anche nel
  loader main). Il popup mostra header **`vecchia → nuova`**, **Novità** in alto e
  **Correzioni** in basso (aggregate da tutte le versioni saltate), un pulsante
  **Condividi** (copia il recap negli appunti, prova `navigator.share` se c'è) e
  **Fatto**/X che salva la versione corrente come vista. Primissimo avvio
  soppresso (nessuna sorpresa): il main marca la versione e non ritorna note.
  Aggiunto il blocco changelog 0.2.50 con la feature. **Verificato**:
  `tests/update-recap.spec.mjs` 3/3 verdi (popup con novità sopra/correzioni
  sotto + header versioni; chiusura → marca visto e non riappare; primo avvio
  soppresso ma versione marcata).
  — Al primo avvio dopo un update (confronto `lastSeenVersion` salvata vs
  `app.getVersion()`), mostra un popup con il recap aggregato di **tutte** le
  versioni saltate (calcolo "quante patch indietro" da `src/shared/patchNotes.js`).
  Layout: in alto l'intestazione **`vecchia → nuova`**, poi **Novità** (features) in
  alto e **Correzioni** (fixes) in basso; testo non tecnico, niente "perché era
  rotto". Pulsante **Condividi/Copia** il recap. Salva `lastSeenVersion` alla
  chiusura. **Done**: spec che, forzando una `lastSeenVersion` vecchia, asserisce
  che il popup elenca le entry attese nell'ordine giusto. (stima: M)

- [x] **C5 — Popup ringraziamento feedback risolto + ricompensa per priorità (50/100/200/300)**
  (2026-06-17) — FATTO. All'avvio la home chiede al main `GET_FEEDBACK_REWARDS`:
  legge il `clientId` di questo install (`sn_feedback_client_id`, lo stesso che il
  box allega all'invio), cerca su Firestore i feedback **suoi** (match anche sul
  prefisso `owner:` per gli invii da admin) in stato `done`, e per ognuno NON
  ancora premiato accredita la ricompensa per priorità
  (`CREDIT.FEEDBACK_RESOLVE_BY_PRIORITY` 0→50/1→100/2→200/3→300, via il nuovo
  puro `SN_CREDITS.rewardForPriority`). L'anti-doppio-premio è `rewardedFeedback`
  nel doc credits (già in SYNC_FIELDS, quindi non ripaga su un altro dispositivo).
  La home mostra un popup di ringraziamento (riusa lo stile `.dash-recap-*` +
  `.dash-thanks-*`) con, per ciascun feedback, numero+titolo e **spiegazione non
  tecnica** estratta dai turni "modello" delle note (`SN_FEEDBACK_THREAD.splitNotes`),
  più il totale crediti; poi anima le monete verso l'icona profilo
  (`flyCreditsToAccount`, variante home di C3, punta all'elemento account reale).
  I due popup d'avvio (recap C4 + ringraziamento C5) sono **incatenati** per non
  sovrapporsi: il ringraziamento parte alla chiusura del recap, o subito se il
  recap non c'è. La pagina Crediti già etichetta `feedback_resolved` nei movimenti.
  Changelog 0.2.50 aggiornato. **Verificato**: `tests/feedback-resolved-reward.spec.mjs`
  3/3 (popup+saldo +200 per prio 2; aggregazione di 2 feedback = +350 escludendo
  todo e feedback altrui; anti-doppio-premio alla riapertura) + 2 nuovi unit in
  `creditStore.test.mjs` (rewardForPriority, clamp/stringa). Regressione mirata
  verde: update-recap 3/3, credits-page 2/2, feedback-credit-reward 1/1.
  **Nota tecnica**: il round-trip Firestore live (lista feedback reale) non è
  testato headless — lo stub di `SN_FEEDBACK.list` rende lo spec deterministico/
  offline; il filtro per clientId e la lettura note sono comunque esercitati.
  — All'update, se un feedback **inviato dall'utente** è passato a `done` da
  quando non guardava, mostra un popup per ciascuno (o aggregato) con:
  ringraziamento, conferma della risoluzione con **spiegazione non tecnica** presa
  dalle `notes` del feedback (come/dove usare la nuova feature), e **ricompensa
  crediti proporzionale alla priorità**: priorità 0→50, 1→100, 2→200, 3→300 (da
  confermare la mappatura esatta col campo `priority` 0-3). Anima i crediti verso
  il profilo (riusa C3). Richiede leggere da Firestore i feedback dell'utente
  (per email/clientId) e il loro stato/priority/notes; tracciare quali sono già
  stati premiati per non premiare due volte (campo nel doc credits). File:
  motore C1 + integrazione Firestore feedback (`src/shared/feedback.js`).
  **Done**: spec che simula un feedback `done` non ancora premiato e asserisce
  popup + incremento crediti corretto per priorità. (stima: L)

### Risanamento manutenibilità (valutazione 2026-06-10)

- [x] **Pulizie rapide** (2026-06-10) — Fatto: eliminato `src/shared/qrcode.js`
  (444 righe morte, il QR vivo è `qr.js`); eliminati 10 file scratch in tests/;
  PNG di `tests/.fb/` fuori da git (+gitignore); CLAUDE.md e README riallineati
  (~100 spec, architettura completa); hook auto-commit ora scrive i file
  cambiati nel messaggio invece del timestamp; rimossi 55 worktree/branch già
  atterrati su main. Verificato con boot+context-menu spec (8/8 verdi).

- [x] **Decidere i 5 branch superstiti non atterrati** (2026-06-11) — Esito:
  `condescending-dubinsky` (editor 05-22) SCARTATO: superato — il suo "switch
  globale" è evoluto in `isPinned` su main e `tests/editor.spec.mjs` esiste già
  in versione più recente. Trio `compassionate-kalam`/`hopeful-easley`/
  `vigilant-edison` SCARTATO: la patch unica (shell persistente per la modalità
  terminale) è già su main con hash diverso. `determined-leakey` RECUPERATO e
  adattato al refactor (il campionatore ora è in `pageColor.js`, non più in
  content.js): fix "tab bianca su YouTube" — theme-color/manifest neutri
  (croma < 24) non tingono più la tab, si ripiega sul favicon; nuovo modulo
  `src/shared/tabColor.js` + unit test, fallback identità per la tab attiva in
  shell.js, spec `tab-favicon-color`, sezione in PATTERNS.md, guida `test:unit`
  in CLAUDE.md, eliminati gli spec scratch dbg/dbg2/dbg3. NON recuperati i due
  ritocchi d'intensità della tinta (saturazione 18%→55%, mix 38%→60%): erano
  esperimenti di debug che contraddicono la spec §1.2 "tinta subliminale" —
  se la tinta delle tab inattive sembra troppo debole, è lì che si regola.
  Verificato: 16/16 unit + spec tab-favicon-color/tab-live-color/
  tab-identity-color/boot verdi. Eliminati anche i 3 branch più vecchi
  (`loving-lalande`, `nifty-johnson`, `suspicious-lovelace`): zero patch uniche.

- [x] **Spezzare `src/content/content.js` — parte 1: estrazioni pulite** (2026-06-10) —
  Fatto: 4 moduli nuovi, pattern IIFE su globalThis, caricati prima di
  content.js da entrambi i preload:
  `pageColor.js` (SN_PAGE_COLOR), `translatePage.js` (SN_TRANSLATE_PAGE, lo
  stato di traduzione ora vive lì), `tts.js` (SN_TTS: lettura ad alta voce +
  dettatura; riceve da content.js via `TTS.init({...})` getSettings /
  restorePasteContext / insertTextAtSelection / blobToDataUrl),
  `editBox.js` (SN_EDITBOX: riceve accesso al pasteContext via `init`).
  content.js: 3247 → 2433 righe. Le righe 2880-3045 della vecchia sezione TTS
  (buildInlineExplainImage/Link, analyzeLinkSuspicious, levenshteinSmall) NON
  sono TTS: lasciate in content.js per la parte 2 (vanno in actions.js).
  Verificato: 17/17 spec verdi (boot, context-menu, read-aloud,
  tts-preferences, tab-live-color, tab-identity-color, menu-icon-row,
  select-custom-orange). Nota ambiente: `npm run test:smoke` fallisce su
  questa macchina anche sul commit PRE-refactoring (Electron dist incompleto
  in node_modules: manca chrome_100_percent.pak) — non è una regressione;
  vedi memoria "npm install con Filo aperto".

- [x] **Spezzare `src/content/content.js` — parte 2: azioni e menu** (2026-06-10) —
  Fatto: 2 moduli nuovi, pattern IIFE su globalThis, caricati prima di
  content.js da entrambi i preload:
  `actions.js` (SN_ACTIONS, ~1370 righe: clipboard copia/taglia/incolla +
  cronologia, screenshot pieno/regione, trascrizione OCR, salva/condividi/
  cerca, color picker, QR code, spiegazioni inline testo/immagine/link,
  prefetch "Spiega", analyzeLinkSuspicious + levenshteinSmall; riceve via
  `Actions.init({...})` getPasteContext / restorePasteContext / isBlocked /
  getLastMouseEvent) e `menuIcons.js` (SN_MENU_ICONS, ~255 righe: registro
  icone globali, layout persistente + migrazioni, drag-and-drop; riceve
  isContentFullscreen; lastNavState ora memorizzato da buildGlobalIconRow).
  content.js: 2433 → 941 righe (bootstrap, routing contextmenu/runtime,
  menu spellcheck, matrice contestuale). TTS.init ora passa
  Actions.insertTextAtSelection/blobToDataUrl. In più: aggiunto comando
  `rclick-view:SEL` a tests/agent/shoot.mjs (+README) per il check visivo
  del menu. Verificato: 29/29 spec verdi (boot, context-menu, menu-icon-row,
  menu-app-icons, menu-disabled-icons-drag, menu-qr-code, menu-nav-actions,
  clipboard-paste-image, clipboard-history-search, spellcheck-input-menu-top,
  read-aloud x2, fullscreen-content, tab-activity-signals) + test:shoot del
  menu aperto (riga icone, Incolla con cronologia, Detta, feedback: ok).
  Il criterio "~600-900 righe" non è raggiunto del tutto (941): il residuo
  grosso è il menu spellcheck (~350 righe), estraibile in un'eventuale
  parte 3 se serve.

- [x] **Spezzare lo switch di `src/main/services/handlers.js`** (2026-06-11) —
  Fatto: lo switch (89 case) non esiste più. `handleMessage` è lookup su un
  registro `Map` + fallback; i case vivono in 9 moduli per dominio sotto
  `src/main/services/handlers/`: `nav.js` (18: OPEN_*/NAV_*/CLOSE_*/
  fullscreen/SHELL_ACTION/incognito/misspelling), `tabs.js` (12: _tabs:*,
  colori/attività/triage, archivio), `storage.js` (15: _storage:*, settings,
  export, clipboard, history, costi), `pages.js` (10: salvati+categorie),
  `ai.js` (6: AI_REQUEST, TTS, test provider/modelli, web search, save path),
  `filo.js` (12: chat/dashboard/memoria/note/timer/notifiche), `auth.js`
  (6: AUTH_*, FEEDBACK_UPDATE, DEFAULTS_*), `safebrowse.js` (4), `misc.js`
  (6: capture, feedback box, fetch_link_meta). Ogni modulo riceve via `ctx`
  gli helper condivisi rimasti in handlers.js (winOf, getEffectiveSettings,
  broadcast, …) e legge gli SN_* da globalThis. handlers.js: 1765 → 1025
  righe. Dedup in più: il case UPDATE_SETTINGS duplicava riga per riga
  `applySettingsUpdate` → ora la usa. CLAUDE.md e README aggiornati (punto
  "nuovo messaggio IPC"). Verificato in 5 batch: 91 test verdi totali (boot,
  context-menu, menu-nav-actions, fullscreen, tab-live-color/activity/archive,
  settings-instant-apply, export-data, clipboard x2, dashboard, filo-chat-set-
  preference, read-aloud, tts-preferences, agent-style, auth-shell,
  admin-defaults-gate, feedback-admin-gate/batch/dim/draw, safebrowse,
  cookies, incognito, slash-commands, tab-semantic-search,
  sidebar-shell-actions) + test:shoot del menu tasto destro (ok).

- [ ] **Consolidare la suite test (103 spec, ~25 min)** — Molti micro-spec
  avviano Electron per testare dettagli della stessa pagina (es.
  dashboard-command-color/-focus/-extra). Accorpare gli spec per pagina/area
  in file unici che condividono il `beforeAll`/fixture (1 avvio → N test).
  NON cambiare il fixture `tests/fixtures/electron.mjs`. Obiettivo: dimezzare
  gli avvii di Electron senza perdere copertura. Verifica: `npm test` in cloud
  (NON in locale). Questo task è ideale per una routine cloud. (stima: M)

- [ ] **Valutare se spezzare `src/pages/editor/editor.js` (2157 righe) e
  `src/main/tabs.js` (1299 righe)** — Solo dopo i task sopra: leggere la
  struttura, decidere se il taglio vale il rischio, proporre all'utente.
  (stima: M)
