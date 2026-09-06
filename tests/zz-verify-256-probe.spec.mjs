// Sonda temporanea del verificatore #256 — doppio clic su "Rimuovi".
import { test, expect } from './fixtures/electron.mjs';
import { _electron as electron } from '@playwright/test';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';

const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SEC_URL = 'filo://security/security.html';

async function findTabPage(app, hostname, timeout = 15000) {
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

async function launch(userData) {
  return electron.launch({
    args: ['.'], cwd: APP_ROOT,
    env: { ...process.env, FILO_USER_DATA: userData, NODE_ENV: 'test' },
  });
}

test('probe: doppio clic su Rimuovi nella pagina Sicurezza', async () => {
  const many = Array.from({ length: 8 }, (_, i) => ({ type: 'text', text: `voce-${i}`, ts: 100 - i }));
  const userData = mkdtempSync(join(tmpdir(), 'v256-p1-'));
  writeFileSync(join(userData, 'storage.json'), JSON.stringify({ clipboardHistory: many }), 'utf8');
  const app = await launch(userData);
  try {
    const shell = await app.firstWindow();
    await shell.waitForLoadState('domcontentloaded');
    await shell.evaluate((u) => window.filoShell.tabs.open(u), SEC_URL);
    const page = await findTabPage(app, 'security');
    await page.waitForLoadState('domcontentloaded');
    const rows = page.locator('#sec-clip-list .sn-clip-item');
    await expect(rows).toHaveCount(8);

    const prima = await page.locator('.sn-clip-text').allInnerTexts();
    console.log('PRIMA', JSON.stringify(prima));

    // Doppio clic rapido sul "Rimuovi" della terza voce (voce-2).
    await rows.nth(2).locator('.sn-clip-remove').dblclick({ delay: 20 });
    await page.waitForTimeout(1500);
    const dopo = await page.locator('.sn-clip-text').allInnerTexts();
    console.log('DOPO-DBLCLICK', JSON.stringify(dopo));
    console.log('RIMOSSE', prima.filter((t) => !dopo.includes(t)).join(' | '));

    // Sul disco?
    const storage = await page.evaluate(async () => {
      const r = await chrome.runtime.sendMessage({ type: window.SN_MSG.MSG.GET_CLIPBOARD_HISTORY });
      return (r.items || []).map((x) => x.text);
    });
    console.log('SU-DISCO', JSON.stringify(storage));
  } finally {
    try { await app.close(); } catch (_) {}
    rmSync(userData, { recursive: true, force: true });
  }
});

test('probe: doppio clic sulla × del menu Incolla', async () => {
  const many = Array.from({ length: 8 }, (_, i) => ({ type: 'text', text: `voce-${i}`, ts: 100 - i }));
  const userData = mkdtempSync(join(tmpdir(), 'v256-p2-'));
  writeFileSync(join(userData, 'storage.json'), JSON.stringify({ clipboardHistory: many }), 'utf8');
  const server = createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end('<!doctype html><html><body style="padding:40px"><textarea id="ta" rows="4" cols="40"></textarea></body></html>');
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${server.address().port}/p`;
  const app = await launch(userData);
  try {
    const shell = await app.firstWindow();
    await shell.waitForLoadState('domcontentloaded');
    await shell.evaluate((u) => window.filoShell.tabs.open(u), url);
    const web = await findTabPage(app, '127.0.0.1');
    await web.waitForFunction(() => document.documentElement.dataset.filoReady === '1', null, { timeout: 10000 });
    await web.locator('#ta').click({ button: 'right' });
    await expect(web.locator('.sn-menu')).toBeVisible();
    await web.locator('.sn-menu-paste-arrow').click();
    const sub = web.locator('.sn-menu-history-sub');
    await expect(sub).toBeVisible();
    await expect(sub.locator('.sn-menu-history-item')).toHaveCount(8);
    await sub.locator('.sn-menu-history-item').nth(2).locator('.sn-menu-history-remove').dblclick({ delay: 20 });
    await web.waitForTimeout(1500);
    const restanti = await sub.locator('.sn-menu-history-item').allInnerTexts();
    console.log('MENU-DOPO', JSON.stringify(restanti));
  } finally {
    server.close();
    try { await app.close(); } catch (_) {}
    rmSync(userData, { recursive: true, force: true });
  }
});
