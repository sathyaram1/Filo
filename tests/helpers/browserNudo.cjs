// Un browser qualunque per le prove: una finestra di Electron senza niente di Filo, sull'indirizzo di BROWSER_NUDO_URL.
// Serve alle pagine che devono funzionare quando Filo non parte (#489). Invisibile come le finestre di Filo nei test.
const { app, BrowserWindow } = require('electron');
const { join } = require('node:path');
const { hideForTests } = require(join(__dirname, '..', '..', 'src', 'main', 'test-window-mode.js'));

if (process.env.BROWSER_NUDO_DATI) app.setPath('userData', process.env.BROWSER_NUDO_DATI);

app.whenReady().then(() => {
  const win = new BrowserWindow({ width: 1100, height: 820, webPreferences: { contextIsolation: true, sandbox: true } });
  hideForTests(win, { main: true });
  win.loadURL(process.env.BROWSER_NUDO_URL || 'about:blank');
});
app.on('window-all-closed', () => app.quit());
