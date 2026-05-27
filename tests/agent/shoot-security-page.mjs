// One-off: screenshot della nuova pagina filo://security/ + del menu Impostazioni
// aperto (per verificare l'icona lucchetto).
import { _electron as electron } from '@playwright/test';
import { mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const APP_ROOT = resolve(__dirname, '..', '..');
const OUT = join(__dirname, '.out');
mkdirSync(OUT, { recursive: true });

const userData = mkdtempSync(join(tmpdir(), 'filo-shoot-'));
const app = await electron.launch({
  args: ['.'], cwd: APP_ROOT,
  env: { ...process.env, FILO_USER_DATA: userData, NODE_ENV: 'test' },
});
const shell = await app.firstWindow();
await shell.waitForLoadState('domcontentloaded');

// 1) Apri il menu Impostazioni e screenshot
await shell.locator('#nav-settings').click();
await new Promise((r) => setTimeout(r, 400));
const before = new Set();
const menuWin = app.windows().find((w) => w.url().startsWith('data:text/html'));
if (menuWin) {
  await menuWin.screenshot({ path: join(OUT, 'settings-menu.png') });
  console.log('saved settings-menu.png');
}

// 2) Naviga a filo://security/ e screenshot
await shell.evaluate(() => window.filoShell.tabs.open('filo://security/'));
let page = null;
const deadline = Date.now() + 10_000;
while (Date.now() < deadline) {
  page = app.windows().find((w) => w.url().startsWith('filo://security'));
  if (page) break;
  await new Promise((r) => setTimeout(r, 100));
}
await page.waitForLoadState('domcontentloaded');
await page.waitForSelector('#sec-protect-ip', { timeout: 5_000 });
await new Promise((r) => setTimeout(r, 400));
await page.screenshot({ path: join(OUT, 'security-page.png') });
console.log('saved security-page.png');

await app.close();
