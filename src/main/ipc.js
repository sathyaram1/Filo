// IPC routing: traduce le chiamate dal renderer (shell, pagine interne,
// content script via preload) al handler centrale dei servizi.
//
// Canali esposti:
//   filo:message     — invoke(msg) → response. Equivalente a chrome.runtime.sendMessage.
//   ai-stream:start  — invoke({ requestId, action, payload }). Il main streamma
//                      via ai-stream:<requestId>:delta / :done / :error fino al renderer.
//   ai-stream:abort  — send({ requestId })
//   tabs:*           — controllo del TabManager dalla shell renderer.

const { ipcMain, BrowserWindow } = require('electron');
const path = require('node:path');
const { handleMessage, handleStream, broadcastToTabs } = require('./services/handlers');
const { showPopupMenu } = require('./popup-menu');
const { showTooltip, hideTooltip } = require('./popup-tooltip');
const DiskStorage = require('./shim/storage');

const inFlightStreams = new Map(); // requestId → AbortController

function senderInfo(event) {
  const wc = event.sender;
  // BrowserWindow.fromWebContents() può ritornare null per le WebContentsView
  // figlie: in quel caso iteriamo tutte le finestre per trovare il TabManager
  // che possiede questa wc. Senza il fallback, sender.tab restava null e i
  // bottoni back/forward/reload/closeTab del menu (che leggono sender.tab.id)
  // non facevano nulla (feedback alpha).
  let win = BrowserWindow.fromWebContents(wc);
  let tab = null;
  if (win?._filoTabs) {
    tab = win._filoTabs.tabs.find((t) => t.view.webContents === wc);
  }
  if (!tab) {
    for (const w of BrowserWindow.getAllWindows()) {
      const t = w._filoTabs?.tabs?.find((tt) => tt.view.webContents === wc);
      if (t) { tab = t; win = w; break; }
    }
  }
  return {
    tab: tab ? { id: tab.id, url: tab.url, title: tab.title } : null,
    url: wc.getURL(),
    isShell: win ? win.webContents === wc : false,
    // Riferimento alla finestra proprietaria (in-process: l'handler è chiamato
    // direttamente, non oltre il confine IPC) + flag incognito, così i servizi
    // aprono i tab nella finestra giusta e l'IPC instrada lo storage in RAM.
    win: win || null,
    isIncognito: !!win?._filoIncognito,
  };
}

function registerIpcHandlers() {
  ipcMain.handle('filo:message', async (event, msg) => {
    const info = senderInfo(event);
    // In incognito avvolgiamo l'handler in runIncognito(): ogni lettura/scrittura
    // dello storage che ne discende (anche dopo await) finisce nell'overlay in
    // RAM invece che su disco. Copre TUTTE le azioni di memoria senza dover
    // gattare ogni singolo case.
    const run = () => handleMessage(msg, info);
    try {
      return info.isIncognito ? await DiskStorage.runIncognito(run) : await run();
    } catch (err) {
      console.error('[Filo IPC] handler error', msg?.type, err);
      return { ok: false, error: err.message || String(err), code: err.code || 'UNKNOWN' };
    }
  });

  ipcMain.handle('ai-stream:start', async (event, { requestId, action, payload }) => {
    const incognito = !!BrowserWindow.fromWebContents(event.sender)?._filoIncognito
      || senderInfo(event).isIncognito;
    const ac = new AbortController();
    inFlightStreams.set(requestId, ac);
    const send = (suffix, data) => {
      try { event.sender.send(`ai-stream:${requestId}:${suffix}`, data); } catch (_) {}
    };
    // ai-stream è un canale IPC SEPARATO da filo:message: va avvolto anch'esso
    // in runIncognito così cache AI e tracciamento costi restano effimeri.
    const work = async () => {
      try {
        const meta = {};
        const result = await handleStream({
          action, payload, origin: event.sender.getURL(),
          signal: ac.signal,
          onMeta: (m) => { Object.assign(meta, m); send('meta', m); },
          onDelta: (delta) => send('delta', { delta }),
        });
        send('done', { ...result });
      } catch (err) {
        console.warn('[Filo IPC] stream error', requestId, err);
        send('error', { message: err.message || String(err), code: err.code || 'UNKNOWN' });
      } finally {
        inFlightStreams.delete(requestId);
      }
    };
    if (incognito) await DiskStorage.runIncognito(work); else await work();
    return { ok: true };
  });

  ipcMain.on('ai-stream:abort', (_event, { requestId }) => {
    const ac = inFlightStreams.get(requestId);
    if (ac) {
      try { ac.abort(); } catch (_) {}
      inFlightStreams.delete(requestId);
    }
  });

  // ─── tab control dalla shell ─────────────────────────────────────────────
  const winFor = (event) => {
    const wc = event.sender;
    for (const w of BrowserWindow.getAllWindows()) {
      if (w._filoShell?.webContents === wc) return w;
      if (w._filoTabs?.tabs?.some((t) => t.view.webContents === wc)) return w;
    }
    return BrowserWindow.fromWebContents(wc) || BrowserWindow.getAllWindows()[0];
  };
  ipcMain.handle('tabs:open', (event, { url } = {}) => {
    const win = winFor(event);
    if (!win || !win._filoTabs) return { ok: false };
    const id = win._filoTabs.openTab(url || 'filo://newtab/');
    return { ok: true, id };
  });
  ipcMain.handle('tabs:close', (event, { id }) => {
    const win = winFor(event);
    if (win?._filoTabs) win._filoTabs.closeTab(id);
    return { ok: true };
  });
  ipcMain.handle('tabs:activate', (event, { id }) => {
    const win = winFor(event);
    if (win?._filoTabs) win._filoTabs.activate(id);
    return { ok: true };
  });
  ipcMain.handle('tabs:navigate', (event, { id, url }) => {
    const win = winFor(event);
    if (win?._filoTabs) win._filoTabs.navigate(id, url);
    return { ok: true };
  });
  ipcMain.handle('tabs:reserve-top', (event, { px }) => {
    const win = winFor(event);
    if (win?._filoTabs) win._filoTabs.setTopInset(px);
    return { ok: true };
  });
  ipcMain.handle('tabs:back', (event, { id }) => {
    const win = winFor(event);
    if (win?._filoTabs) win._filoTabs.goBack(id);
    return { ok: true };
  });
  ipcMain.handle('tabs:forward', (event, { id }) => {
    const win = winFor(event);
    if (win?._filoTabs) win._filoTabs.goForward(id);
    return { ok: true };
  });
  ipcMain.handle('tabs:reload', (event, { id }) => {
    const win = winFor(event);
    if (win?._filoTabs) win._filoTabs.reload(id);
    return { ok: true };
  });
  ipcMain.handle('tabs:set-active-visible', (event, { visible } = {}) => {
    const win = winFor(event);
    if (win?._filoTabs) win._filoTabs.setActiveVisible(visible !== false);
    return { ok: true };
  });
  ipcMain.handle('tabs:snapshot', (event) => {
    const win = winFor(event);
    if (!win?._filoTabs) return { activeId: null, tabs: [] };
    return win._filoTabs.snapshot();
  });
  ipcMain.handle('tabs:open-blocked-popup', (event, { url } = {}) => {
    const win = winFor(event);
    if (!win?._filoTabs || !url) return { ok: false };
    win._filoTabs.openBlockedPopup(url);
    return { ok: true };
  });

  // ─── popup menu custom (sopra le WebContentsView) ────────────────────────
  ipcMain.handle('shell:popup-menu', (event, { entries, x, y }) => {
    const win = winFor(event);
    if (!win?._filoTabs) return { ok: false };
    showPopupMenu(win, entries, x, y, (value) => {
      // Le voci con `action` custom tornano al renderer chiamante; quelle con
      // `url` (default) aprono un nuovo tab.
      if (typeof value === 'string' && value.startsWith('@action:')) {
        try { event.sender.send('shell:menu-action', value.slice('@action:'.length)); } catch (_) {}
      } else if (value) {
        win._filoTabs.openTab(value);
      }
    });
    return { ok: true };
  });

  // ─── tooltip custom (sopra le WebContentsView) ───────────────────────────
  ipcMain.on('shell:tooltip-show', (event, { text, x, y }) => {
    const win = winFor(event);
    if (!win) return;
    showTooltip(win, String(text || ''), Number(x) || 0, Number(y) || 0);
  });
  ipcMain.on('shell:tooltip-hide', () => hideTooltip());

  // ─── controlli finestra (min / max / close) ──────────────────────────────
  ipcMain.handle('window:minimize', (event) => {
    const win = winFor(event); if (win) win.minimize();
    return { ok: true };
  });
  ipcMain.handle('window:toggle-maximize', (event) => {
    const win = winFor(event);
    if (win) {
      if (win.isMaximized()) win.unmaximize(); else win.maximize();
    }
    return { ok: true };
  });
  ipcMain.handle('window:close', (event) => {
    const win = winFor(event); if (win) win.close();
    return { ok: true };
  });

  // ─── apertura finestra incognito ─────────────────────────────────────────
  // Lazy require di window.js per evitare un ciclo di import al boot.
  ipcMain.handle('window:open-incognito', () => {
    try {
      const { createIncognitoWindow } = require('./window');
      createIncognitoWindow();
      return { ok: true };
    } catch (err) {
      console.error('[Filo IPC] open-incognito', err);
      return { ok: false, error: err.message || String(err) };
    }
  });
}

async function openInternalPage(name) {
  // Vedi filoWin() in handlers.js: getAllWindows()[0] può essere una finestra
  // figlia (tooltip/popup) senza _filoTabs. Cerca quella che possiede i tab.
  const wins = BrowserWindow.getAllWindows();
  const win = wins.find((w) => w._filoTabs) || wins[0];
  if (!win || !win._filoTabs) return;
  const url = `filo://${name}/${name}.html`;
  win._filoTabs.openTab(url);
}

module.exports = { registerIpcHandlers, openInternalPage };
