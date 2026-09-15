// Entry point del processo main: qui si decide solo l'ORDINE dell'avvio
// (protocollo, servizi, barra dei menu, finestra). La logica sta nei moduli.

const { app, BrowserWindow, nativeTheme, session } = require('electron');
const path = require('node:path');

// Anche userData (cookie, cache) va nella temp, o l'isolamento non è completo.
if (process.env.FILO_USER_DATA) {
  try { app.setPath('userData', process.env.FILO_USER_DATA); } catch (_) {}
}

// Senza AppUserModelID la taskbar di Windows mostra l'icona di Electron.
if (process.platform === 'win32') {
  try { app.setAppUserModelId('ai.filo.desktop'); } catch (_) {}
}

// UA pulita (il perché in src/main/userAgent.js). `userAgentFallback` è quella
// che eredita ogni session, e va fissata PRIMA di whenReady.
try {
  const { stripEmbeddedUaTokens } = require('./userAgent');
  const cleaned = stripEmbeddedUaTokens(app.userAgentFallback || '', app.getName());
  if (cleaned) app.userAgentFallback = cleaned;
} catch (_) { /* best-effort: in peggio resta la UA di default */ }

// I moduli condivisi si auto-registrano su `globalThis` (convenzione IIFE):
// chi li usa non li richiede, li trova già lì.
require('./shim/chrome-api');
require('./services/loader');

// Dentro app.evaluate `require` non esiste: i test arrivano ai servizi veri da
// qui. SINCRONO, non dentro whenReady: un test può valutare prima che finisca.
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

// PRIMA di app.whenReady, o i privilegi dello schema non si applicano.
require('./protocol').registerProtocolSchemes();

let mainWindow = null;

function syncNativeTheme(theme) {
  nativeTheme.themeSource = theme === 'dark' ? 'dark' : theme === 'light' ? 'light' : 'system';
}

// Senza queste lingue Hunspell resta sulla sola lingua di sistema e i
// suggerimenti dietro lo zigzag non arrivano. #169: l'inglese NON si forza, o
// le parole italiane sbagliate ricevono correzioni inglesi. Su macOS è ignorata.
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
  // PRIMA di qualsiasi finestra: su Mac la barra vince sui tasti delle pagine.
  installaMenuApplicazione();

  const Storage = globalThis.SN_STORAGE;
  try {
    const s = await Storage.getSettings();
    syncNativeTheme(s.theme);
    const Cookies = require('./services/cookies');
    Cookies.configureFromSettings(s);
    // Fingerprint e pulizia dei cookie di tracker vanno PRIMA che si apra una
    // scheda: dopo, la prima pagina è già stata letta con le difese spente.
    try { await require('./services/fingerprint').init(s); } catch (_) {}
    try { await Cookies.wipeTrackerCookies(s); } catch (_) {}
    try { await require('./services/adblock').init(s); } catch (_) {}
    try { require('./services/siteBlock').configureFromSettings(s); } catch (_) {}
    // Una-tantum, idempotente: i vecchi appunti diventano un file dell'editor.
    try { await require('./services/editorFiles').migrateNotesToEditor(); } catch (_) {}
  } catch (_) {}

  // Le due identità: entrambe leggono solo file, niente rete all'avvio.
  try { require('./auth/google-auth').restore(); } catch (_) {}
  try { require('./auth/anon-auth').restore(); } catch (_) {}

  // I tre in background non bloccano l'avvio: finché la config remota non
  // arriva valgono i default del codice, e senza chiavi resta l'analisi locale.
  try { require('./services/defaultsStore').refresh().catch(() => {}); } catch (_) {}
  try { require('./services/handlers').wireSafebrowse().catch(() => {}); } catch (_) {}
  try { require('./services/downloads').init().catch(() => {}); } catch (_) {}

  mainWindow = createMainWindow();
  registerShortcuts(mainWindow);

  // #322 — le scadenze si controllano nel main: altrimenti una sveglia scatta
  // solo se la newtab è aperta.
  try { require('./services/alarmWatcher').start(); } catch (_) {}

  initAutoUpdater();

  // Smoke sentinel: in test mode apre la newtab E una pagina di test esterna,
  // verifica che i content script si caricano in quest'ultima, cattura
  // screenshot di entrambe, scrive un report e si chiude.
  //
  // ORDINE: il sentinel — l'unica cosa che lo script fuori sta aspettando — si
  // scrive appena lo stato delle schede è quello da riportare, PRIMA delle
  // catture. Le catture sono diagnostica: aprono altre finestre e aspettano che
  // finiscano di caricare, cioè dipendono dalla rete e da quanto è carica la
  // macchina. Scrivendo il sentinel dopo, una cattura lenta diventava
  // indistinguibile da un'app che non parte — «sentinel non scritto entro 20 s»
  // su un avvio andato benissimo. Adesso l'esito è deciso dal boot, e il resto
  // può prendersi il suo tempo (o fallire) senza cambiarlo.
  if (process.env.FILO_SMOKE) {
    const fs = require('node:fs');
    const path = require('node:path');
    // Nessuna attesa dello smoke può durare per sempre: l'app resterebbe
    // appesa senza dire niente.
    const entro = (promessa, ms, cosa) => Promise.race([
      promessa,
      new Promise((r) => setTimeout(() => { console.log(`[smoke] ${cosa}: scaduti ${ms}ms, proseguo`); r(null); }, ms)),
    ]);
    const checkReady = async () => {
      const tabs = mainWindow?._filoTabs;
      const ready = tabs && tabs.tabs.length > 0 && tabs.tabs.some((t) => !t.loading);
      if (!ready) { setTimeout(checkReady, 250); return; }
      // did-stop-loading non vuol dire dipinto: un attimo al renderer.
      await new Promise((r) => setTimeout(r, 800));
      const outDir = path.dirname(process.env.FILO_SMOKE);
      // Il verdetto, subito: da qui in poi è tutta diagnostica.
      try {
        fs.writeFileSync(process.env.FILO_SMOKE, JSON.stringify({
          ts: new Date().toISOString(),
          tabs: tabs.snapshot(),
        }));
        console.log('[smoke] sentinel scritto:', process.env.FILO_SMOKE);
      } catch (e) { console.log('[smoke] sentinel non scritto:', e?.message || String(e)); }
      // Senza una composizione visibile capturePage fallisce con "display
      // surface not available", e da Node Windows non la mostra da sé.
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
          const img = await entro(wc.capturePage(), 15_000, `cattura ${label}`);
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
      await dump('shell', mainWindow.webContents);
      // Aggiro electron#24694: capturePage su una WebContentsView torna
      // un'immagine vuota, quindi l'URL si riapre in una finestra dedicata.
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
          await entro(
            new Promise((res) => captureWin.webContents.once('did-stop-loading', res)),
            15_000, `attesa caricamento ${label}`,
          );
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

      // Una pagina che NON è filo://: è l'unico modo di provare i content script.
      const testPageUrl = 'file:///' + path.join(__dirname, '..', '..', 'tests', 'fixtures', 'test-page.html').replace(/\\/g, '/');
      const csWin = await captureUrl('test-page', testPageUrl, 'page-preload.js');
      if (csWin) {
        try {
          const csDiag = await entro(csWin.webContents.executeJavaScript(
            "({ href: location.href," +
            " filoReady: document.documentElement.dataset.filoReady," +
            " filoModules: document.documentElement.dataset.filoModules," +
            " filoTheme: document.documentElement.dataset.snTheme," +
            " filoStyleInjected: !!document.querySelector('link[href*=\"filo://style/\"]')," +
            " linkCount: document.querySelectorAll('link[rel=stylesheet]').length })"
          ), 10_000, 'diagnostica content-script');
          console.log('[smoke] content-script diag:', JSON.stringify(csDiag, null, 2));

          await entro(csWin.webContents.executeJavaScript(`(() => {
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
          })()`), 10_000, 'tasto destro simulato');
          await new Promise((r) => setTimeout(r, 500));
          const menuDiag = await entro(csWin.webContents.executeJavaScript(
            "({ menu: !!document.querySelector('.sn-menu')," +
            " menuItems: document.querySelectorAll('.sn-menu .sn-menu-item, .sn-menu button').length," +
            " menuHtml: (document.querySelector('.sn-menu')?.outerHTML || '').slice(0,300) })"
          ), 10_000, 'diagnostica menu');
          console.log('[smoke] right-click menu diag:', JSON.stringify(menuDiag, null, 2));
          await dump('menu', csWin.webContents);
        } catch (e) { console.log('[smoke] content-script diag failed', e.message); }
        csWin.close();
      }
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

// Salvataggio SINCRONO delle schede aperte: quello normale ha un debounce, e
// chi esce subito dopo aver aperto una scheda la perderebbe.
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
