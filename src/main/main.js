// Filo — entry point del processo main Electron.
// Boota:
//   - protocollo filo:// per pagine interne e asset
//   - finestra principale con shell (tab bar + indirizzo)
//   - manager dei tab basato su WebContentsView
//   - servizi (storage, providers AI, saved pages, ecc.)
//   - shortcut globali

const { app, BrowserWindow, nativeTheme, session } = require('electron');
const path = require('node:path');

// In test mode, redirigi anche userData (cookies, cache, ecc.) sotto la
// directory temp così l'isolamento è completo.
if (process.env.FILO_USER_DATA) {
  try { app.setPath('userData', process.env.FILO_USER_DATA); } catch (_) {}
}

// Su Windows serve un AppUserModelID esplicito perché la taskbar mostri
// l'icona giusta (e non quella di Electron di default).
if (process.platform === 'win32') {
  try { app.setAppUserModelId('ai.filo.desktop'); } catch (_) {}
}

// User agent pulito (vedi src/main/userAgent.js per il perché). Togliamo i
// token `filo/<ver>` ed `Electron/<ver>` dalla UA di default così i login dei
// siti esterni (Google, Claude, …) non scambiano Filo per un browser embedded
// e non rifiutano l'accesso. `userAgentFallback` è il default ereditato da ogni
// session/webContents che non imposta una UA propria, quindi vale per tutte le
// tab. Va fissato PRIMA di whenReady.
try {
  const { stripEmbeddedUaTokens } = require('./userAgent');
  const cleaned = stripEmbeddedUaTokens(app.userAgentFallback || '', app.getName());
  if (cleaned) app.userAgentFallback = cleaned;
} catch (_) { /* best-effort: in peggio resta la UA di default */ }

// Carica i moduli "shared/background" portati dall'estensione. Si registrano
// tutti su `globalThis` (pattern IIFE preservato dal codice extension), così
// gli altri moduli del main process li trovano via global.
require('./shim/chrome-api');
require('./services/loader');

// Solo in test: esponi i singleton di handlers/defaults su globalThis così i
// test Playwright (che girano nel main via app.evaluate, dove `require` non è
// iniettato) possono esercitare la catena reale chiave-condivisa → motore. Va
// fatto in modo SINCRONO qui (non dentro whenReady) perché i test che dipendono
// solo dal fixture `app` possono valutare prima che il callback async finisca.
if (process.env.NODE_ENV === 'test') {
  try {
    globalThis.__filoHandlers = require('./services/handlers');
    globalThis.__filoDefaults = require('./services/defaultsStore');
    globalThis.__filoCookies = require('./services/cookies');
    globalThis.__filoAdblock = require('./services/adblock');
    globalThis.__filoFingerprint = require('./services/fingerprint');
    globalThis.__filoProxyTab = require('./services/proxyTab');
    globalThis.__filoShortcuts = require('./shortcuts');
  } catch (_) {}
}

const { createMainWindow } = require('./window');
const { registerFiloProtocol } = require('./protocol');
const { registerIpcHandlers } = require('./ipc');
const { registerShortcuts } = require('./shortcuts');
const { installaMenuApplicazione } = require('./menu');
const { initAutoUpdater } = require('./updater');

// Permette al protocollo filo:// di caricarsi con privilegi standard (CORS
// libero, fetch, ecc.) — deve essere chiamato PRIMA di app.whenReady.
require('./protocol').registerProtocolSchemes();

let mainWindow = null;

function syncNativeTheme(theme) {
  nativeTheme.themeSource = theme === 'dark' ? 'dark' : theme === 'light' ? 'light' : 'system';
}

// Configura le lingue del correttore ortografico NATIVO (Hunspell) di Electron.
// Senza questa chiamata Electron usa solo la lingua di sistema: su molte
// configurazioni i suggerimenti dietro lo zigzag rosso non arrivano (il main
// li inoltra al menu di correzione via `_spell:native`, vedi tabs.js). La
// vecchia estensione Chrome aveva i dizionari pronti d'ufficio; qui li
// attiviamo esplicitamente — italiano (l'app è italiana) + lingua di sistema —
// così la correzione in cima al menu funziona anche senza chiave LLM. NON
// forziamo più l'inglese (#169): con il dizionario inglese sempre attivo le
// parole italiane errate ricevevano suggerimenti inglesi ("funzion"→"function").
// Su macOS la chiamata è ignorata (Electron usa NSSpellChecker), nessun problema.
function configureSpellchecker() {
  try {
    const ses = session.defaultSession;
    if (!ses || typeof ses.setSpellCheckerLanguages !== 'function') return;
    const available = ses.availableSpellCheckerLanguages || [];
    if (!available.length) return; // macOS / nativo: nessuna lista Hunspell
    const want = globalThis.SN_SPELL_LANG.select(available, app.getLocale());
    if (want.length) ses.setSpellCheckerLanguages(want);
  } catch (_) { /* best-effort: il correttore resta sul default di sistema */ }
}

app.whenReady().then(async () => {
  await registerFiloProtocol();
  registerIpcHandlers();
  configureSpellchecker();

  const Storage = globalThis.SN_STORAGE;
  try {
    const s = await Storage.getSettings();
    syncNativeTheme(s.theme);
    // Gestione cookie: emetti GPC sulla sessione di default secondo la modalità.
    const Cookies = require('./services/cookies');
    Cookies.configureFromSettings(s);
    // Anti-fingerprinting: carica/genera il master secret persistente e fissa
    // la modalità corrente (off/default/privacy) prima di aprire qualsiasi tab.
    try { await require('./services/fingerprint').init(s); } catch (_) {}
    // Backstop del wipe: se dei cookie di tracker noti sono rimasti su disco
    // (es. da prima di attivare l'Automatico, o da un'uscita interrotta),
    // ripuliscili PRIMA di aprire qualsiasi tab. I cookie funzionali/di login
    // restano. In privacy le sessioni sono effimere; in manual non tocchiamo nulla.
    try { await Cookies.wipeTrackerCookies(s); } catch (_) {}
    // Ad-blocking per-dominio basato su liste (StevenBlack/EasyList): applica il
    // blocco alla sessione di default, carica la cache e — se attivo e stantia —
    // avvia un refresh in background. Non blocca l'avvio.
    try { await require('./services/adblock').init(s); } catch (_) {}
    // Blocco apertura siti in blacklist (#170.3): legge la config dalle
    // impostazioni (riusa le liste dell'ad-blocker + la blacklist dell'utente).
    try { require('./services/siteBlock').configureFromSettings(s); } catch (_) {}
    // Appunti → editor: sposta una-tantum i vecchi appunti dell'archivio in un
    // file "Appunti" dell'editor (fine dell'archivio separato). Idempotente.
    try { await require('./services/editorFiles').migrateNotesToEditor(); } catch (_) {}
  } catch (_) {}

  // Ripristina la sessione "Accedi con Google" persistita (non fa rete: l'ID
  // token si rinnova alla prima richiesta che lo serve). Vedi src/main/auth/.
  try { require('./auth/google-auth').restore(); } catch (_) {}

  // Carica in background la config "modelli predefiniti" condivisa da Firestore
  // (modelli pubblici + eventuali chiavi ruotate dall'admin, se loggati). Non
  // blocca l'avvio: finché non arriva si usano i default da costanti/build.
  try { require('./services/defaultsStore').refresh().catch(() => {}); } catch (_) {}

  // Configura il rilevatore di siti pericolosi con chiave GSB/LLM/rete/sandbox
  // dalle impostazioni. Non blocca: senza chiavi resta solo l'analisi locale.
  try { require('./services/handlers').wireSafebrowse().catch(() => {}); } catch (_) {}

  // #410.1 — intercetta gli scaricamenti della navigazione (clic su un link a
  // un file) sulla sessione predefinita: carica la cronologia persistita e
  // aggancia will-download così la barra in alto ne mostra l'avanzamento.
  try { require('./services/downloads').init().catch(() => {}); } catch (_) {}

  mainWindow = createMainWindow();
  registerShortcuts(mainWindow);

  // Sveglie e timer (#322): controlla nel main le scadenze arrivate, mostra la
  // notifica di sistema e avvisa le dashboard aperte (che fanno partire la
  // suoneria). Senza questo, una sveglia scatta solo se la newtab è aperta.
  try { require('./services/alarmWatcher').start(); } catch (_) {}

  // Auto-update: controlla le GitHub Releases e applica la nuova versione
  // al riavvio (no-op in dev/test — vedi updater.js).
  initAutoUpdater();

  // Smoke sentinel: in test mode apre la newtab E una pagina di test esterna,
  // verifica che i content script si caricano in quest'ultima, cattura
  // screenshot di entrambe, scrive un report e si chiude.
  if (process.env.FILO_SMOKE) {
    const fs = require('node:fs');
    const path = require('node:path');
    const checkReady = async () => {
      const tabs = mainWindow?._filoTabs;
      const ready = tabs && tabs.tabs.length > 0 && tabs.tabs.some((t) => !t.loading);
      if (!ready) { setTimeout(checkReady, 250); return; }
      // Diamo un attimo al renderer per dipingere dopo did-stop-loading.
      await new Promise((r) => setTimeout(r, 800));
      const outDir = path.dirname(process.env.FILO_SMOKE);
      // Forza la finestra in primo piano. Quando spawn-ata da Node non
      // sempre Windows la mostra automaticamente; senza una composizione
      // visibile, capturePage delle child WebContentsView fallisce con
      // "display surface not available" e desktopCapturer non la vede.
      try {
        mainWindow.show();
        mainWindow.moveTop();
        mainWindow.focus();
        mainWindow.setAlwaysOnTop(true);
        console.log('[smoke] window state', JSON.stringify({
          visible: mainWindow.isVisible(),
          minimized: mainWindow.isMinimized(),
          focused: mainWindow.isFocused(),
          bounds: mainWindow.getBounds(),
        }));
      } catch (e) { console.log('[smoke] show/focus error', e.message); }
      await new Promise((r) => setTimeout(r, 800));
      const dump = async (label, wc) => {
        console.log(`[smoke] dump:${label} start`);
        try {
          const img = await wc.capturePage();
          console.log(`[smoke] dump:${label} capturePage resolved, img=`, !!img, 'empty=', img?.isEmpty?.());
          if (!img) { console.log(`[smoke] dump:${label} no img`); return; }
          const png = img.toPNG();
          const sz = img.getSize();
          const file = path.join(outDir, `screenshot-${label}.png`);
          fs.writeFileSync(file, png);
          console.log(`[smoke] capture ${label}: ${sz.width}x${sz.height}, ${png.length} bytes → ${file}`);
        } catch (e) {
          console.log(`[smoke] capture ${label} threw:`, e?.stack || e?.message || String(e));
        }
      };
      // Cattura: shell (= primary webContents), tab attiva (di solito fallisce
      // — vedi electron#24694), e composito via desktopCapturer.
      await dump('shell', mainWindow.webContents);
      // captureUrl: apre URL in una BrowserWindow dedicata e cattura il
      // primary. Workaround a electron#24694 (capturePage su WebContentsView
      // restituisce empty image in molte configurazioni).
      const captureUrl = async (label, url, preloadName) => {
        try {
          const captureWin = new BrowserWindow({
            width: 1280, height: 800, show: true,
            webPreferences: {
              preload: path.join(__dirname, '..', 'preload', preloadName),
              contextIsolation: preloadName !== 'internal-preload.js',
              sandbox: false, nodeIntegration: false,
            },
          });
          captureWin.loadURL(url);
          await new Promise((res) => captureWin.webContents.once('did-stop-loading', res));
          captureWin.show(); captureWin.moveTop(); captureWin.focus();
          captureWin.setAlwaysOnTop(true);
          await new Promise((r) => setTimeout(r, 900));
          await dump(label, captureWin.webContents);
          return captureWin;
        } catch (e) { console.log(`[smoke] capture ${label} failed`, e.message); return null; }
      };

      const active = tabs.tabs.find((t) => t.id === tabs.activeId);
      if (active) {
        const tabCaptureWin = await captureUrl('tab', active.url, 'internal-preload.js');
        if (tabCaptureWin) tabCaptureWin.close();
      }

      // Test pagina esterna + content script: apri una pagina file:// che
      // non è filo:// e verifica che i content script si carichino bene.
      const testPageUrl = 'file:///' + path.join(__dirname, '..', '..', 'tests', 'fixtures', 'test-page.html').replace(/\\/g, '/');
      const csWin = await captureUrl('test-page', testPageUrl, 'page-preload.js');
      if (csWin) {
        try {
          const csDiag = await csWin.webContents.executeJavaScript(
            "({ href: location.href," +
            " filoReady: document.documentElement.dataset.filoReady," +
            " filoModules: document.documentElement.dataset.filoModules," +
            " filoTheme: document.documentElement.dataset.snTheme," +
            " filoStyleInjected: !!document.querySelector('link[href*=\"filo://style/\"]')," +
            " linkCount: document.querySelectorAll('link[rel=stylesheet]').length })"
          );
          console.log('[smoke] content-script diag:', JSON.stringify(csDiag, null, 2));

          // Simula selezione + right-click per verificare che il menu compaia.
          await csWin.webContents.executeJavaScript(`(() => {
            const span = document.querySelector('.selectable');
            if (!span) return false;
            const range = document.createRange();
            range.selectNodeContents(span);
            const sel = window.getSelection();
            sel.removeAllRanges();
            sel.addRange(range);
            const rect = span.getBoundingClientRect();
            const evt = new MouseEvent('contextmenu', {
              bubbles: true, cancelable: true, view: window,
              clientX: rect.left + rect.width / 2,
              clientY: rect.top + rect.height / 2,
              button: 2,
            });
            return span.dispatchEvent(evt);
          })()`);
          await new Promise((r) => setTimeout(r, 500));
          const menuDiag = await csWin.webContents.executeJavaScript(
            "({ menu: !!document.querySelector('.sn-menu')," +
            " menuItems: document.querySelectorAll('.sn-menu .sn-menu-item, .sn-menu button').length," +
            " menuHtml: (document.querySelector('.sn-menu')?.outerHTML || '').slice(0,300) })"
          );
          console.log('[smoke] right-click menu diag:', JSON.stringify(menuDiag, null, 2));
          await dump('menu', csWin.webContents);
        } catch (e) { console.log('[smoke] content-script diag failed', e.message); }
        csWin.close();
      }
      fs.writeFileSync(process.env.FILO_SMOKE, JSON.stringify({
        ts: new Date().toISOString(),
        tabs: tabs.snapshot(),
      }));
      setTimeout(() => app.quit(), 200);
    };
    setTimeout(checkReady, 500);
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      mainWindow = createMainWindow();
    }
  });
});

// Alla chiusura salva sincronicamente la sessione (tab aperti) così alla
// prossima apertura vengono ripristinati anche se l'utente esce subito dopo
// aver aperto/chiuso un tab (il salvataggio normale è con debounce).
app.on('before-quit', () => {
  try {
    const tm = mainWindow?._filoTabs;
    const Storage = require('./shim/storage');
    if (tm && Storage?.setSync) {
      const key = globalThis.SN_CONST?.STORAGE_KEYS?.OPEN_TABS || 'sn_open_tabs';
      Storage.setSync({ [key]: tm.sessionState() });
    }
    Storage?.flushSync?.();
  } catch (_) {}
});

// Wipe dei cookie-tracker all'uscita (modalità 'default'): i cookie funzionali e
// i login restano (le tue scelte non si perdono); rimuoviamo solo eventuali
// cookie di domini-tracker noti. Il wipe è asincrono: rimandiamo l'uscita finché
// non termina (con un timeout di sicurezza, così l'app si chiude comunque se il
// wipe si impalla). In privacy le sessioni sono effimere (niente da fare); in
// manual non tocchiamo nulla.
let cookieWipeDone = false;
app.on('before-quit', (e) => {
  if (cookieWipeDone) return;
  let pending;
  try { pending = require('./services/cookies').wipeOnExit(); } catch (_) { return; }
  if (!pending || typeof pending.then !== 'function') return;
  e.preventDefault();
  const finish = () => { cookieWipeDone = true; app.quit(); };
  const timer = setTimeout(finish, 2500);
  pending.then(() => { clearTimeout(timer); finish(); }, () => { clearTimeout(timer); finish(); });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// Single instance: la seconda apertura ridà focus all'esistente.
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
}
