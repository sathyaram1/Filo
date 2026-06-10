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

- [ ] **Spezzare `src/content/content.js` — parte 2: azioni e menu** —
  Dopo la parte 1, valutare l'estrazione della sezione "Azioni" (~righe
  1477-1634 nel file originale) e "Nuove azioni globali/contestuali" in
  `content/actions.js`. Includere anche buildInlineExplainImage,
  buildInlineExplainLink, analyzeLinkSuspicious e levenshteinSmall (lasciati
  in content.js dalla parte 1). Stesso metodo e stesse verifiche della
  parte 1. Criterio di fatto: content.js è solo bootstrap + routing eventi
  (~600-900 righe). (stima: L)

- [ ] **Spezzare lo switch di `src/main/services/handlers.js` (82 case, ~790 righe)** —
  Sostituire il mega-switch in `handleMessage` con un registro
  `Map<MSG.*, handlerFn>` popolato da moduli per dominio sotto
  `src/main/services/handlers/`: es. `nav.js` (NAV_*, OPEN_*, CLOSE_*,
  fullscreen), `filo.js` (FILO_*), `auth.js` (AUTH_*, DEFAULTS_*),
  `safebrowse.js` (SAFEBROWSE_*), `misc.js` (resto). `handleMessage` resta
  come lookup + fallback. Le funzioni di supporto condivise (buildMessages,
  getEffectiveSettings, broadcastToTabs, …) restano in handlers.js ed
  esportate ai sottomoduli via parametro o globalThis come già avviene.
  Farlo un dominio alla volta; dopo ogni dominio: `npx playwright test
  tests/boot.spec.mjs tests/context-menu.spec.mjs` + uno spec dell'area
  spostata. Criterio di fatto: nessun case nello switch originale, suite
  mirata verde. (stima: L)

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
