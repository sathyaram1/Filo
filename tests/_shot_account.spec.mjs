import { test } from './fixtures/electron.mjs';
import { buildHTML, computeMenuWidth } from '../src/main/popup-menu.js';

const ENTRIES = [
  { label: 'sathyarampontillo@gmail.com', disabled: true },
  { type: 'separator' },
  { label: 'Esci', icon: 'close', action: 'auth-signout' },
];

test('shot account menu', async ({ app }) => {
  const MARGIN = 26;
  const width = computeMenuWidth(ENTRIES);
  const html = buildHTML(ENTRIES, false, MARGIN);
  const winW = width + MARGIN * 2;
  await app.evaluate(async ({ BrowserWindow }, { html, winW }) => {
    const win = new BrowserWindow({ show: false, width: winW, height: 150, transparent: true, frame: false, backgroundColor: '#00000000', webPreferences: {} });
    await win.webContents.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
    await new Promise((r) => setTimeout(r, 300));
    const img = await win.webContents.capturePage();
    require('fs').writeFileSync('/tmp/account_menu.png', img.toPNG());
    win.destroy();
  }, { html, winW });
});
