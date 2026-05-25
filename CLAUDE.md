# Istruzioni per Claude Code

## PRIMA DI TUTTO: sync con `origin/main`

Routine remote (su claude.ai) pushano commit su `origin/main` durante la
giornata. Prima di iniziare **qualsiasi** task, sincronizza il repo locale:

```bash
git -C "C:/Users/agenti AI/Desktop/Filo/Filo" pull --rebase origin main
```

Questo allinea anche tutti i worktree (condividono lo stesso `.git`). Se il
pull fallisce per conflitti, fermati e chiedi all'utente prima di procedere
— non risolvere conflitti senza autorizzazione.

## DOPO OGNI MODIFICA: push su `origin/main`

Le routine remote partono dallo stato di `origin/main`, quindi se non pushi
lavorano su codice vecchio e potrebbero rifare cose già fatte o introdurre
conflitti. Dopo qualsiasi Edit/Write — una volta che l'auto-commit/merge
hook ha già aggiornato `main` locale — pusha:

```bash
git -C "C:/Users/agenti AI/Desktop/Filo/Filo" push origin main
```

Fallo a fine task (non dopo ogni singolo Edit, sarebbe troppo rumoroso): è
sufficiente un push prima di restituire il controllo all'utente. Se il push
viene rifiutato per `non-fast-forward`, significa che `origin/main` ha
commit nuovi (forse da una routine partita nel frattempo): fai prima
`git pull --rebase origin main` e poi ripushha.

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
npm test                   # suite Playwright (17 test)
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

## Controlli visivi / agentici dopo OGNI feature

Gli unit test Playwright non vedono i bug **compositi** (shell + WebContentsView
native) né le regressioni visive. Dopo aver implementato o modificato una feature,
esegui SEMPRE un controllo visivo dell'area toccata. Strumenti in `tests/agent/`
(cattura la finestra reale via Win32 `PrintWindow`, vedi `tests/agent/README.md`):

1. **Controllo a vista (deterministico, gratis)** — `npm run test:shoot`:
   ```bash
   npm run test:shoot -- "nav:filo://editor/editor.html; click-view:#doc; type:ciao; shot:editor"
   ```
   Guarda gli screenshot in `tests/agent/.out/*.png` e verifica a occhio.

2. **Esplorazione/compito guidato da LLM** — `npm run test:explore`:
   ```bash
   npm run test:explore -- --start filo://editor/editor.html --steps 10 \
     --task "<usa la feature appena fatta, passo per passo>"
   ```
   Dai un `--task` che esercita la feature: il modello la usa con interazioni
   reali e segnala i bug incontrati (finiscono nei feedback, tab "Agente").

**Modelli (strategia):** usa **`gemini-3.1-flash-lite`** come primario (è "il
modello buono" e ha quota generosa), con **`gemma-4-31b-it`** come **fallback**
automatico quando il primario esaurisce i crediti/quota (429). Così si sfrutta
prima il modello migliore. La chiave sta in `tests/agent/.env` (gitignorata).

**Come reagire a ciò che emerge:**
- **Bug ovvio** (qualcosa di palesemente rotto: area vuota, crash, funzione che
  non risponde) → **correggilo subito** nello stesso worktree.
- **Scelta di design discutibile / non-bug ovvio** (ridondanze, UX opinabile,
  incoerenze minori) → **NON** cambiarla di tua iniziativa: **segnalala**
  all'utente (o lasciala nel report/feedback) perché decida lui.
- **Sospetto falso positivo** dell'harness (es. focus rubato, percezione errata
  dello screenshot): prima di trattarlo come bug **riproducilo in modo
  deterministico con `test:shoot`**. Se non si riproduce, è un artefatto: non
  segnalarlo come bug reale.

## Feedback alpha tester

I feedback arrivano da Firestore (progetto `filo-8b9cb`, collezione `feedback`).
Accesso via REST con API key in `src/shared/feedback.js`. Le Firestore rules
stanno in `../extension/firestore.rules` e si deployano con:

```bash
cd ../extension && firebase deploy --only firestore:rules
```

**Workflow**: quando l'utente chiede di "risolvere i feedback", lavora
**solo** sui feedback con status `todo` ("Da risolvere"). Ignora quelli
in `new` (inbox), `draft` (bozze — richiedono decisioni di design dell'utente),
`done` (già risolti, in attesa di verifica), `verified` e `ignored`.

Per ogni feedback `todo`:
1. Leggi testo + screenshot allegati per capire il problema
2. Trova il codice coinvolto e implementa il fix
3. Aggiorna lo status a `done` su Firestore (PATCH con `updateMask`)
   e scrivi nelle `notes` una breve spiegazione causa/fix

## Cosa NON è in scope

- L'estensione MV3 (`../extension/` o `../ROBA VECCHIA/extension-mv3/`) è
  congelata. Niente fix né nuove feature lì. Se l'utente dice "fai X anche
  sull'extension", **chiedi conferma** — di solito vuole solo Filo.

## Workflow worktree

Per ogni nuovo task crea un worktree dedicato:

```bash
git worktree add .claude/worktrees/<slug> -b claude/<slug>
```

Auto-commit e auto-merge su `main` avvengono via hook a ogni Edit/Write
(vedi `.claude/hooks/`). Non serve committare a mano.
