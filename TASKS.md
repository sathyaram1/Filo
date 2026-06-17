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

- [ ] **C4 — Popup recap aggiornamento (feature in alto, bugfix in basso, non tecnico)**
  — Al primo avvio dopo un update (confronto `lastSeenVersion` salvata vs
  `app.getVersion()`), mostra un popup con il recap aggregato di **tutte** le
  versioni saltate (calcolo "quante patch indietro" da `src/shared/patchNotes.js`).
  Layout: in alto l'intestazione **`vecchia → nuova`**, poi **Novità** (features) in
  alto e **Correzioni** (fixes) in basso; testo non tecnico, niente "perché era
  rotto". Pulsante **Condividi/Copia** il recap. Salva `lastSeenVersion` alla
  chiusura. **Done**: spec che, forzando una `lastSeenVersion` vecchia, asserisce
  che il popup elenca le entry attese nell'ordine giusto. (stima: M)

- [ ] **C5 — Popup ringraziamento feedback risolto + ricompensa per priorità (50/100/200/300)**
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
