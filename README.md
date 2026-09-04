# Filo

> **Non ancora pronto.** Questo repository è il dietro le quinte di un progetto
> in costruzione, non un prodotto da usare. I documenti di trasparenza sono
> incompleti e ci sono problemi di sicurezza noti in corso di risoluzione.
> L'eseguibile è scaricabile perché lo sviluppo è pubblico, ma per ora provalo
> solo per curiosità.

Browser AI-native cross-device. Layer di interazione sopra il linguaggio
naturale: la UI è un'accelerazione della conversazione, non l'opposto.

Filo è l'evoluzione dell'estensione Chrome `filo-extension` (archiviata in
`../ROBA VECCHIA/extension-mv3/` quando il refactor è completo). Il modello
extension era zoppo: niente vera new tab nativa, niente hotkey globali, niente
intercettazione pre-navigazione, quote `chrome.storage` strette. Filo desktop
risolve tutto questo costruendo sopra Electron.

## Architettura

```
src/
├── main/                       Processo main Electron (Node.js)
│   ├── main.js                 Entry point, app lifecycle
│   ├── window.js               BrowserWindow + shell
│   ├── tabs.js                 TabManager (multi-WebContentsView)
│   ├── protocol.js             Custom protocol filo://
│   ├── ipc.js                  Routing IPC main↔renderer
│   ├── shortcuts.js            Hotkey globali Alt+E/T/S/H
│   ├── updater.js              Auto-update (electron-builder: NSIS su Windows, zip su Mac)
│   ├── popup-menu.js, popup-tooltip.js   Popup nativi della shell
│   ├── auth/                   Login Google (PKCE, token store)
│   ├── config/                 Chiavi default incastonate dal build
│   ├── shim/
│   │   ├── storage.js          chrome.storage.local → file JSON
│   │   └── chrome-api.js       Namespace chrome.* per servizi portati
│   └── services/
│       ├── loader.js           Carica i moduli SN_* su globalThis
│       ├── handlers.js         Registro messaggi + helper condivisi (ex background.js)
│       ├── handlers/           Handler per dominio (nav, tabs, storage, pages,
│       │                       ai, filo, auth, safebrowse, misc)
│       ├── providers/          OpenRouter (chat, voce, dettatura, embedding), fallback chain
│       ├── safebrowse/         Protezione phishing/typosquatting (12 moduli)
│       ├── categorizer.js, savedPages.js, historyStore.js,
│       │   archivedTabs.js, cookies.js, costTracker.js, exportData.js,
│       │   fxRates.js, llmsTxt.js, webSearch.js, shell.js, ...
│       └── (porting 1:1 dei file background dell'estensione + servizi nuovi)
├── preload/
│   ├── shell-preload.js        Espone window.filoShell alla shell renderer
│   ├── internal-preload.js     Espone window.filo + shim chrome alle pagine filo://
│   ├── page-preload.js         Shim chrome + content script su pagine web esterne
│   ├── popup-preload.js        Preload dei popup nativi
│   └── wheel-zoom.js, fingerprint-guard.js
├── renderer/                   Shell del browser (tab bar + address bar)
│   ├── shell.html / shell.css / shell.js
├── pages/                      Pagine interne servite via filo://
│   ├── dashboard/   → filo://newtab/
│   ├── home/, editor/, options/, history/, feedback/,
│   ├── spellcheck/, security/, admin-defaults/
├── content/                    Content script (menu, popup, sidebar, highlight,
│                               spellcheck, feedback, extractContext, ...)
├── shared/                     Moduli condivisi main+renderer (IIFE → globalThis)
└── styles/                     CSS condivisi (theme, menu, popup, sidebar, ...)
assets/icons/                   Icone applicazione
```

Le istruzioni operative per Claude vivono in `CLAUDE.md` (con lo "switch di
ruolo": `LOCAL.md` per le sessioni locali; le routine cloud ricevono il proprio
ruolo da `scripts/dispatch.mjs`, file in `routines/roles/`); le convenzioni UI
in `PATTERNS.md`.

## Quick start

```bash
npm install                     # installa Electron + Playwright
npm start                       # avvia Filo (apre la finestra)
npm run test:smoke              # smoke headless (verifica che la newtab carichi)
```

Il primo `npm install` scarica Electron (~150MB). Se non lo fa in automatico
(succede su alcune configurazioni di npm), esegui manualmente:

```bash
node node_modules/electron/install.js
```

## Filosofia di porting

Il codice dell'estensione era scritto in stile "no-build, IIFE su globalThis":

```js
(function (global) {
  global.SN_MODULE = { ... };
})(typeof globalThis !== 'undefined' ? globalThis : self);
```

Questo si è rivelato un dono: caricando ogni file con `require()` nel main
process Electron, i moduli si auto-registrano su `globalThis` e gli altri li
trovano lì — esattamente come succedeva nel service worker via `importScripts`.

Le API `chrome.*` (storage, runtime, tabs, action, commands) sono shimmate
in `src/main/shim/chrome-api.js`. Lo storage punta a un file JSON in
`%APPDATA%/Filo/storage.json` invece che a `chrome.storage.local`.

Le pagine interne (dashboard, options, ecc.) hanno il loro shim `chrome.*`
nel preload `internal-preload.js`, che ridiriziona ogni chiamata via IPC al
main. Così le pagine girano quasi invariate.

## Stato del porting

- [x] Browser shell (tab bar, address bar, nav buttons, hotkey browser-style)
- [x] Multi-tab tramite `WebContentsView`
- [x] Protocollo `filo://` per pagine interne e asset
- [x] Storage su disco
- [x] Servizi background (providers, savedPages, categorizer, costTracker, history, llmsTxt, paths, fxRates, aiCache, webSearch)
- [x] IPC + streaming AI
- [x] Hotkey globali (Alt+E/T/S/H; su Mac Ctrl+Alt, perché Alt da solo è il tasto degli accenti)
- [x] Pagine: dashboard, options, history, feedback, spellcheck (HTML/CSS/JS portati 1:1)
- [x] **Content script** in pagine web (menu tasto destro, popup, sidebar, highlight, spellcheck, feedback) iniettati via `page-preload.js`
- [x] Test Playwright adattati a `_electron.launch` (~100 spec)
- [x] Auto-update (electron-builder/NSIS, vedi `src/main/updater.js`)
- [x] Packaging Windows (NSIS) e Mac (dmg universale, Intel + Apple Silicon); Linux non previsto per ora

## Test

```bash
npm run test:smoke     # smoke headless con screenshot (tests/.smoke/)
npm run test:unit      # unit test Node (veloci)
npm test               # suite Playwright completa (~100 spec, ~25 min — solo in cloud)
```

In locale NON lanciare la suite completa: usa gli spec mirati della feature
toccata (`npx playwright test tests/<feature>.spec.mjs`). Vedi CLAUDE.md.

## Sviluppo

I file `src/shared/*` e `src/main/services/*` sono **porting 1:1** dai
corrispondenti dell'estensione. Le modifiche dovrebbero restare allineate
finché l'estensione legacy esiste (ma vedi nota sopra: per ora è congelata).

Quando aggiungi un nuovo messaggio IPC, ricordati di:
1. Definirlo in `src/shared/messages.js` (costante `MSG.*`).
2. Gestirlo nel modulo di dominio giusto sotto `src/main/services/handlers/`
   registrandolo con `on(MSG.X, fn)` (il registro vive in `handlers.js`).
3. Se è broadcast main→renderer, usa `broadcastToTabs` o
   `broadcastLiveUpdate` (vedi handlers.js).

## Licenza

Il codice di Filo è distribuito sotto [licenza Apache 2.0](LICENSE): puoi
usarlo, modificarlo e ridistribuirlo, anche a scopo commerciale.

Il nome «Filo» e il logo NON sono coperti dalla licenza (è la sezione 6,
"Trademarks"): un fork deve presentarsi con un altro nome. È la stessa
distinzione di Firefox o VS Code: il codice è libero, l'identità no.
