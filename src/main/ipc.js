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

const inFlightStreams = new Map(); // requestId → AbortController

function senderInfo(event) {
  const wc = event.sender;
  const win = BrowserWindow.fromWebContents(wc);
  let tab = null;
  if (win?._filoTabs) {
    tab = win._filoTabs.tabs.find((t) => t.view.webContents === wc);
  }
  return {
    tab: tab ? { id: tab.id, url: tab.url, title: tab.title } : null,
    url: wc.getURL(),
    isShell: win ? win.webContents === wc : false,
  };
}

function registerIpcHandlers() {
  ipcMain.handle('filo:message', async (event, msg) => {
    try {
      return await handleMessage(msg, senderInfo(event));
    } catch (err) {
      console.error('[Filo IPC] handler error', msg?.type, err);
      return { ok: false, error: err.message || String(err), code: err.code || 'UNKNOWN' };
    }
  });

  ipcMain.handle('ai-stream:start', async (event, { requestId, action, payload }) => {
    const ac = new AbortController();
    inFlightStreams.set(requestId, ac);
    const send = (suffix, data) => {
      try { event.sender.send(`ai-stream:${requestId}:${suffix}`, data); } catch (_) {}
    };
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

  // ─── popup menu custom (sopra le WebContentsView) ────────────────────────
  ipcMain.handle('shell:popup-menu', (event, { entries, x, y }) => {
    const win = winFor(event);
    if (!win?._filoTabs) return { ok: false };
    showPopupMenu(win, entries, x, y, (url) => {
      win._filoTabs.openTab(url);
    });
    return { ok: true };
  });

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
}

async function openInternalPage(name) {
  const win = BrowserWindow.getAllWindows()[0];
  if (!win || !win._filoTabs) return;
  const url = `filo://${name}/${name}.html`;
  win._filoTabs.openTab(url);
}

module.exports = { registerIpcHandlers, openInternalPage };
