// Filo — entry point del processo main Electron.
// Boota:
//   - protocollo filo:// per pagine interne e asset
//   - finestra principale con shell (tab bar + indirizzo)
//   - manager dei tab basato su WebContentsView
//   - servizi (storage, providers AI, saved pages, ecc.)
//   - shortcut globali

const { app, BrowserWindow, desktopCapturer } = require('electron');
const path = require('node:path');

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

  // Smoke sentinel: in test mode scrivi un marker quando la prima tab è pronta
  // così uno smoke script può verificare il boot senza GUI. Cattura anche
  // uno screenshot dell'intera finestra (shell + tab attiva) e lo salva
  // accanto al sentinel — utile per ispezione visiva.
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
      const active = tabs.tabs.find((t) => t.id === tabs.activeId);
      if (active) {
        await dump('tab', active.view.webContents);
        // Composito reale via OS-level capture.
        // Per distinguere la nostra finestra dall'Explorer di Windows (che
        // capita di chiamarsi pure "Filo" quando l'utente è in quella cartella),
        // imposto un titolo univoco prima di chiamare desktopCapturer.
        const MARKER = `Filo Smoke ${Date.now()}`;
        mainWindow.setTitle(MARKER);
        await new Promise((r) => setTimeout(r, 300));
        try {
          const sources = await desktopCapturer.getSources({
            types: ['window'],
            thumbnailSize: { width: 1280, height: 840 },
          });
          console.log('[smoke] desktopCapturer sources:', sources.map((s) => s.name));
          const ours = sources.find((s) => s.name === MARKER);
          if (ours) {
            const png = ours.thumbnail.toPNG();
            const file = path.join(outDir, 'screenshot-window.png');
            fs.writeFileSync(file, png);
            const sz = ours.thumbnail.getSize();
            console.log(`[smoke] capture window: ${sz.width}x${sz.height}, ${png.length} bytes → ${file}`);
          } else {
            console.log('[smoke] desktopCapturer: marker window not found');
          }
        } catch (e) { console.log('[smoke] desktopCapturer failed', e.message); }
        mainWindow.setTitle('Filo');
        // Diagnostica: dump del DOM, computed dimensions, ed eventuali errori.
        try {
          const diag = await active.view.webContents.executeJavaScript(`(() => {
            const out = {
              url: location.href,
              title: document.title,
              bodyChildren: document.body?.children?.length || 0,
              bodyHTML_len: (document.body?.outerHTML || '').length,
              bodyHTML_head: (document.body?.outerHTML || '').slice(0, 400),
              dashState: document.body?.dataset?.state,
              hasInput: !!document.getElementById('input'),
              hasSettings: !!document.getElementById('settingsBtn'),
              hasHome: !!document.getElementById('homeMessage'),
              homeMsgText: document.getElementById('homeMessage')?.textContent,
              SN_CONST_loaded: typeof window.SN_CONST !== 'undefined',
              SN_MSG_loaded: typeof window.SN_MSG !== 'undefined',
              chrome_runtime: typeof window.chrome?.runtime !== 'undefined',
              bodyBg: getComputedStyle(document.body).backgroundColor,
              viewportSize: [window.innerWidth, window.innerHeight],
            };
            return out;
          })()`);
          console.log('[smoke] dashboard diag:', JSON.stringify(diag, null, 2));
        } catch (e) { console.log('[smoke] diag failed:', e?.message); }
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
