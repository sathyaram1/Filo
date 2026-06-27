// Probe: carica filo://newtab direttamente come primary webContents di una
// BrowserWindow, prova a catturarla, scrive il risultato in tests/.smoke/.
// Diagnostica per capire se il problema è filo:// o WebContentsView.

const { app, BrowserWindow, protocol, net } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { pathToFileURL } = require('node:url');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'src');
const ASSETS = path.join(ROOT, 'assets');

protocol.registerSchemesAsPrivileged([{
  scheme: 'filo',
  privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true },
}]);

app.whenReady().then(async () => {
  protocol.handle('filo', async (request) => {
    const url = new URL(request.url);
    const host = url.hostname;
    const rel = decodeURIComponent(url.pathname.replace(/^\/+/, ''));
    let fsPath;
    if (host === 'newtab') fsPath = path.join(SRC, 'pages', 'dashboard', rel || 'dashboard.html');
    else if (host === 'asset') fsPath = path.join(ASSETS, rel);
    else if (host === 'style') fsPath = path.join(SRC, 'styles', rel);
    else if (host === 'shared') fsPath = path.join(SRC, 'shared', rel);
    else fsPath = path.join(SRC, rel);
    return net.fetch(pathToFileURL(fsPath).href);
  });

  const win = new BrowserWindow({
    width: 1280, height: 840,
    show: true,
    webPreferences: { contextIsolation: false, nodeIntegration: false },
  });
  win.loadURL('filo://newtab/');

  const tryCapture = async (label, delay) => {
    await new Promise((r) => setTimeout(r, delay));
    try {
      const img = await win.webContents.capturePage();
      const sz = img.getSize();
      const out = path.join(ROOT, 'tests', '.smoke', `probe-${label}.png`);
      fs.mkdirSync(path.dirname(out), { recursive: true });
      const png = img.toPNG();
      fs.writeFileSync(out, png);
      console.log(`[probe] ${label} (+${delay}ms): ${sz.width}x${sz.height}, ${png.length} bytes`);
    } catch (e) {
      console.log(`[probe] ${label} (+${delay}ms): FAILED ${e.message}`);
    }
  };

  win.webContents.once('did-stop-loading', async () => {
    win.show(); win.focus();
    await tryCapture('t0', 0);
    await tryCapture('t500', 500);
    await tryCapture('t1500', 1000);
    await tryCapture('t3000', 1500);
    setTimeout(() => app.quit(), 200);
  });
});
