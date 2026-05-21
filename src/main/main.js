// Filo — entry point del processo main Electron.
// Boota:
//   - protocollo filo:// per pagine interne e asset
//   - finestra principale con shell (tab bar + indirizzo)
//   - manager dei tab basato su WebContentsView
//   - servizi (storage, providers AI, saved pages, ecc.)
//   - shortcut globali

const { app, BrowserWindow } = require('electron');
const path = require('node:path');

// In test mode, redirigi anche userData (cookies, cache, ecc.) sotto la
// directory temp così l'isolamento è completo.
if (process.env.FILO_USER_DATA) {
  try { app.setPath('userData', process.env.FILO_USER_DATA); } catch (_) {}
}

// Carica i moduli "shared/background" portati dall'estensione. Si registrano
// tutti su `globalThis` (pattern IIFE preservato dal codice extension), così
// gli altri moduli del main process li trovano via global.
require('./shim/chrome-api');
require('./services/loader');

const { createMainWindow } = require('./window');
const { registerFiloProtocol } = require('./protocol');
const { registerIpcHandlers } = require('./ipc');
const { registerShortcuts } = require('./shortcuts');

// Permette al protocollo filo:// di caricarsi con privilegi standard (CORS
// libero, fetch, ecc.) — deve essere chiamato PRIMA di app.whenReady.
require('./protocol').registerProtocolSchemes();

let mainWindow = null;

app.whenReady().then(async () => {
  await registerFiloProtocol();
  registerIpcHandlers();
  mainWindow = createMainWindow();
  registerShortcuts(mainWindow);

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
