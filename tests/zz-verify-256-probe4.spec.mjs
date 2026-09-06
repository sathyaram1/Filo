// Sonda temporanea #256 — doppio clic con la cadenza di una mano umana.
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

for (const gap of [0, 150, 300]) {
  test(`probe: due clic a ${gap}ms sulla stessa posizione — pagina Sicurezza`, async () => {
    const many = Array.from({ length: 8 }, (_, i) => ({ type: 'text', text: `voce-${i}`, ts: 100 - i }));
    const userData = mkdtempSync(join(tmpdir(), 'v256-pg-'));
    writeFileSync(join(userData, 'storage.json'), JSON.stringify({ clipboardHistory: many }), 'utf8');
    const app = await electron.launch({
      args: ['.'], cwd: APP_ROOT,
      env: { ...process.env, FILO_USER_DATA: userData, NODE_ENV: 'test' },
    });
    try {
      const shell = await app.firstWindow();
      await shell.waitForLoadState('domcontentloaded');
      await shell.evaluate((u) => window.filoShell.tabs.open(u), SEC_URL);
      const page = await findTabPage(app, 'security');
      await page.waitForLoadState('domcontentloaded');
      const rows = page.locator('#sec-clip-list .sn-clip-item');
      await expect(rows).toHaveCount(8);

      // Il mouse si posiziona una volta sola, poi preme due volte.
      await rows.nth(2).locator('.sn-clip-remove').hover();
      await page.mouse.down(); await page.mouse.up();
      if (gap) await page.waitForTimeout(gap);
      await page.mouse.down(); await page.mouse.up();
      await page.waitForTimeout(1200);
      const dopo = await page.locator('.sn-clip-text').allInnerTexts();
      console.log(`GAP${gap} rimaste=${dopo.length} -> ${JSON.stringify(dopo)}`);
    } finally {
      try { await app.close(); } catch (_) {}
      rmSync(userData, { recursive: true, force: true });
    }
  });

  test(`probe: due clic a ${gap}ms sulla × del menu Incolla`, async () => {
    const many = Array.from({ length: 8 }, (_, i) => ({ type: 'text', text: `voce-${i}`, ts: 100 - i }));
    const userData = mkdtempSync(join(tmpdir(), 'v256-pm-'));
    writeFileSync(join(userData, 'storage.json'), JSON.stringify({ clipboardHistory: many }), 'utf8');
    const server = createServer((req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end('<!doctype html><html><body style="padding:40px"><textarea id="ta" rows="4" cols="40"></textarea></body></html>');
    });
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    const url = `http://127.0.0.1:${server.address().port}/p`;
    const app = await electron.launch({
      args: ['.'], cwd: APP_ROOT,
      env: { ...process.env, FILO_USER_DATA: userData, NODE_ENV: 'test' },
    });
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
      await sub.locator('.sn-menu-history-item').nth(2).locator('.sn-menu-history-remove').hover();
      await web.mouse.down(); await web.mouse.up();
      if (gap) await web.waitForTimeout(gap);
      await web.mouse.down(); await web.mouse.up();
      await web.waitForTimeout(1200);
      const su = await web.evaluate(async () => {
        const r = await new Promise((res) => { try { chrome.runtime.sendMessage({ type: 'get_clipboard_history' }, res); } catch (_) { res(null); } });
        return r && r.items ? r.items.map((x) => x.text) : null;
      });
      const nel = await sub.locator('.sn-menu-history-item .sn-menu-label').allInnerTexts();
      console.log(`MENU-GAP${gap} a-schermo=${JSON.stringify(nel)} su-disco=${JSON.stringify(su)}`);
    } finally {
      server.close();
      try { await app.close(); } catch (_) {}
      rmSync(userData, { recursive: true, force: true });
    }
  });
}
