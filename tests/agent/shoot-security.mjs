// One-off: scrolla la sezione Sicurezza nell'options page e cattura.
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
await shell.evaluate(() => window.filoShell.tabs.open('filo://options/'));

let page = null;
const deadline = Date.now() + 10_000;
while (Date.now() < deadline) {
  page = app.windows().find((w) => w.url().startsWith('filo://options/'));
  if (page) break;
  await new Promise((r) => setTimeout(r, 100));
}
await page.waitForLoadState('domcontentloaded');
await page.waitForSelector('#sec-security', { timeout: 5_000 });
await page.evaluate(() => document.querySelector('#sec-security').scrollIntoView({ block: 'start' }));
await new Promise((r) => setTimeout(r, 500));
await page.screenshot({ path: join(OUT, 'security-section.png'), fullPage: false });
console.log('saved:', join(OUT, 'security-section.png'));
await app.close();
