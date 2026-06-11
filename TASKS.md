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

### Risanamento manutenibilità (valutazione 2026-06-10)

- [x] **Pulizie rapide** (2026-06-10) — Fatto: eliminato `src/shared/qrcode.js`
  (444 righe morte, il QR vivo è `qr.js`); eliminati 10 file scratch in tests/;
  PNG di `tests/.fb/` fuori da git (+gitignore); CLAUDE.md e README riallineati
  (~100 spec, architettura completa); hook auto-commit ora scrive i file
  cambiati nel messaggio invece del timestamp; rimossi 55 worktree/branch già
  atterrati su main. Verificato con boot+context-menu spec (8/8 verdi).

- [ ] **Decidere i 5 branch superstiti non atterrati** — Branch con patch mai
  arrivate su main (`git cherry main <br>`): `claude/condescending-dubinsky-9ef8fb`
  (editor, 2026-05-22), `claude/determined-leakey-b953af` (debug colore
  tab/favicon + shell.js, 2026-06-09), e il trio identico
  `claude/compassionate-kalam-dedd0f` / `claude/hopeful-easley-5f084f` /
  `claude/vigilant-edison-c2b0b2` (ipc/shell/dashboard, 2026-06-02, 1 patch).
  Per ciascuno: guardare il diff reale, chiedere all'utente se il lavoro va
  recuperato o buttato, poi eliminare branch+worktree. (stima: S)

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
