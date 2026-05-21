# Istruzioni per Claude Code

Questo è **Filo desktop** — un browser AI-native costruito su Electron. È
l'evoluzione dell'estensione Chrome `filo-extension` (archiviata, o in via di
archiviazione, sotto `../ROBA VECCHIA/`). Tutto il valore dell'estensione
(menu tasto destro, popup, sidebar, spellcheck, dashboard, salva per dopo)
è stato portato qui 1:1; in più ora abbiamo controllo completo del browser
e shortcut globali OS.

## Run / test

```bash
npm install                # Electron + Playwright (~150MB)
npm start                  # avvia la app
npm run test:smoke         # smoke headless con screenshot in tests/.smoke/
npm test                   # suite Playwright (13 test)
```

Se `npm install` non scarica il binario Electron (succede su alcuni setup):
`node node_modules/electron/install.js`.

## Architettura (riepilogo da README)

```
src/main/                  Processo main Electron (Node)
  main.js                  app lifecycle, smoke sentinel
  window.js                BrowserWindow + shell
  tabs.js                  TabManager multi-WebContentsView
  protocol.js              filo:// custom protocol
  ipc.js                   IPC routing main↔renderer
  shortcuts.js             globalShortcut Alt+E/T/S/H
  shim/
    storage.js             chrome.storage.local → userData/storage.json
    chrome-api.js          chrome.* namespace per i moduli portati
  services/
    loader.js              carica shared/* + background/* su globalThis
    handlers.js            switch centrale messaggi (ex background.js dell'extension)
    providers/             openrouter, gemini, fallback
    categorizer.js, savedPages.js, historyStore.js, ...
src/preload/
  shell-preload.js         filoShell IPC per la shell (tab bar + addr bar)
  internal-preload.js      chrome shim + content script su pagine filo://
                           (escluse options/history/feedback/spellcheck)
  page-preload.js          chrome shim + content script su pagine web esterne
src/renderer/              shell.html / shell.css / shell.js
src/pages/                 dashboard, options, history, feedback, spellcheck
src/shared/                IIFE moduli che attaccano a globalThis (constants,
                           messages, i18n, icons, storage, filoMemory,
                           filoState, paths, feedback, pageBootstrap)
src/content/               content scripts (menu, popup, sidebar, highlight,
                           spellcheck, feedback, extractContext, content)
src/styles/                CSS condivisi (theme, menu, popup, sidebar, ...)
```

Lo storage usa **`%APPDATA%/Filo/storage.json`** in produzione e `$FILO_USER_DATA/storage.json`
nei test.

## Convenzione di porting

Il codice originale dell'estensione era scritto in stile **IIFE su globalThis**:

```js
(function (global) {
  global.SN_MODULE = { ... };
})(typeof globalThis !== 'undefined' ? globalThis : self);
```

Si è rivelato un dono per il porting: `require()` nel main process e nei
preload esegue il file e i moduli si auto-registrano. Gli altri trovano
SN_CONST/SN_MSG/ecc. su globalThis senza bisogno di import espliciti.

Quando aggiungi un modulo, **mantieni questo pattern** se appartiene al
codice condiviso shared/* o background/*. Il loader (`src/main/services/loader.js`)
deve poi chiamare `require()` su di esso nell'ordine corretto.

## Chrome shim

Il codice portato chiama `chrome.runtime.sendMessage`, `chrome.storage.local`,
`chrome.tabs.*`. Lo shim sta in tre file diversi a seconda del contesto:

- **Main process**: `src/main/shim/chrome-api.js` (per i moduli background)
- **Pagine filo://**: `src/preload/internal-preload.js` (contextIsolation:false,
  assegna direttamente a `window.chrome`)
- **Pagine web esterne**: `src/preload/page-preload.js` (contextIsolation:true,
  assegna a `globalThis` del mondo isolato)

Quando aggiungi un nuovo tipo di messaggio:
1. Definiscilo in `src/shared/messages.js` (costante `MSG.*`)
2. Gestiscilo in `src/main/services/handlers.js` (switch case in `handleMessage`)
3. Per broadcast main→renderer usa `broadcastToTabs` o `broadcastLiveUpdate`

## Test

I test usano `_electron.launch` di Playwright con un fixture custom in
`tests/fixtures/electron.mjs` che fornisce:
- `app`: l'istanza ElectronApplication (userData isolato in temp dir)
- `shell`: Page object della shell (BrowserWindow primary webContents)
- `openTab(url)`: apre URL come tab e ritorna la Page del WebContentsView
- `testServer`: mini HTTP server locale per pagine di test

**Selettore di Page per un WebContentsView**: usa `app.windows().find(...)`
filtrando sull'URL hostname. `app.waitForEvent('window')` è race-prone perché
la newtab apre subito al boot e il suo event può coincidere con quello del
tab che hai appena aperto.

**Limitazione capturePage su WebContentsView**: noto bug Electron #24694 —
ritorna empty image in molte configurazioni. Il `smoke.mjs` aggira aprendo
l'URL in una BrowserWindow primary dedicata e cattura quella. Replica il
pattern se vuoi screenshot affidabili in nuovi test.

## Cosa NON è in scope

- L'estensione MV3 (`../extension/` o `../ROBA VECCHIA/extension-mv3/`) è
  congelata. Niente fix né nuove feature lì. Se l'utente dice "fai X anche
  sull'extension", **chiedi conferma** — di solito vuole solo Filo.
- Il backend Firestore dei feedback alpha non è (ancora) ricollegato. Se
  l'utente parla di "feedback degli alpha tester" assume che siano nel
  vecchio dashboard dell'extension e chiede di leggerli da lì.

## Workflow worktree

Per ogni nuovo task crea un worktree dedicato:

```bash
git worktree add .claude/worktrees/<slug> -b claude/<slug>
```

Auto-commit e auto-merge su `main` avvengono via hook a ogni Edit/Write
(vedi `.claude/hooks/`). Non serve committare a mano.
