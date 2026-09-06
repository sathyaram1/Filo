// Verifica #256, giro 4 — tracce visive della sezione "Cronologia appunti"
// (chiaro e scuro) e del sotto-menu della freccia «Incolla».

import { test, expect } from './fixtures/electron.mjs';
import { _electron as electron } from '@playwright/test';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';

const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SEC_URL = 'filo://security/security.html';
const PAGE = '<!doctype html><html><body style="padding:40px"><textarea id="ta" rows="4" cols="40"></textarea></body></html>';
const SHOTS = join(APP_ROOT, 'tests', '.shots');
const PNG_ROSSO = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

const items = [
  { type: 'text', text: 'Hunter2-la-mia-password', ts: 100 },
  { type: 'image', dataUrl: PNG_ROSSO, description: 'Schermata del sito', ts: 99 },
  { type: 'text', text: 'https://example.com/una/pagina/lunga/da/leggere', ts: 98 },
  { type: 'text', text: '   \n\t  ', ts: 97 },
  { type: 'text', text: 'Un pezzo di testo un po\' più lungo copiato da un articolo che continua e continua ancora', ts: 96 },
];

async function findTabPage(app, hostname, timeout = 20000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const w = app.windows().find((p) => {
      try { return new URL(p.url()).hostname === hostname; } catch (_) { return false; }
    });
    if (w) return w;
    await new Promise((r) => setTimeout(r, 100));
  }
  return null;
}

function avvia(userData) {
  return electron.launch({
    args: ['.'], cwd: APP_ROOT,
    env: { ...process.env, FILO_USER_DATA: userData, NODE_ENV: 'test' },
  });
}

function conTema(prefix, theme) {
  const userData = mkdtempSync(join(tmpdir(), prefix));
  writeFileSync(join(userData, 'storage.json'), JSON.stringify({
    clipboardHistory: items,
    settings: { theme },
  }), 'utf8');
  return userData;
}

for (const tema of ['light', 'dark']) {
  test(`traccia visiva — sezione cronologia appunti, tema ${tema}`, async () => {
    const userData = conTema(`g4-shot-${tema}-`, tema);
    const app = await avvia(userData);
    try {
      const shell = await app.firstWindow();
      await shell.waitForLoadState('domcontentloaded');
      await shell.evaluate((u) => window.filoShell.tabs.open(u), SEC_URL);
      const page = await findTabPage(app, 'security');
      await page.waitForLoadState('domcontentloaded');
      await expect(page.locator('#sec-clip-list .sn-clip-item')).toHaveCount(5);
      await page.evaluate(() => document.getElementById('sec-clip-title').scrollIntoView({ block: 'center' }));
      await page.waitForTimeout(500);
      mkdirSync(SHOTS, { recursive: true });
      await page.screenshot({ path: join(SHOTS, `256-g4-sezione-${tema}.png`) });
    } finally {
      try { await app.close(); } catch (_) {}
      rmSync(userData, { recursive: true, force: true });
    }
  });
}

test('traccia visiva — sotto-menu della freccia «Incolla»', async () => {
  const userData = conTema('g4-shot-menu-', 'light');
  const server = createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(PAGE);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${server.address().port}/p`;
  const app = await avvia(userData);
  try {
    const shell = await app.firstWindow();
    await shell.waitForLoadState('domcontentloaded');
    await shell.evaluate((u) => window.filoShell.tabs.open(u), url);
    const web = await findTabPage(app, '127.0.0.1');
    await web.waitForFunction(() => document.documentElement.dataset.filoReady === '1', null, { timeout: 20000 });
    await web.locator('#ta').click({ button: 'right' });
    await web.locator('.sn-menu-paste-arrow').click();
    await expect(web.locator('.sn-menu-history-sub')).toBeVisible();
    await web.waitForTimeout(600);
    mkdirSync(SHOTS, { recursive: true });
    await web.screenshot({ path: join(SHOTS, '256-g4-sottomenu.png') });
  } finally {
    server.close();
    try { await app.close(); } catch (_) {}
    rmSync(userData, { recursive: true, force: true });
  }
});
