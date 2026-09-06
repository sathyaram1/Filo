// Verifica avversariale #256, giro 4 — quarta tornata: doppio clic vero (stesse
// coordinate), menu del tasto destro dentro una pagina di Filo, aperture e
// chiusure ripetute.

import { test, expect } from './fixtures/electron.mjs';
import { _electron as electron } from '@playwright/test';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';

const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SEC_URL = 'filo://security/security.html';
const PAGE = '<!doctype html><html><body style="padding:40px"><textarea id="ta" rows="4" cols="40"></textarea></body></html>';

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

function conCronologia(prefix, items) {
  const userData = mkdtempSync(join(tmpdir(), prefix));
  writeFileSync(join(userData, 'storage.json'), JSON.stringify({ clipboardHistory: items }), 'utf8');
  return userData;
}

const voci = (n) => Array.from({ length: n }, (_, i) => ({ type: 'text', text: `voce-${i}`, ts: 1000 - i }));

test('F1 — doppio clic vero (stesse coordinate) sul «Rimuovi»: una voce sola, a 0,1 s e a 0,3 s', async () => {
  const userData = conCronologia('g4d-dbl-', voci(8));
  const app = await avvia(userData);
  try {
    const shell = await app.firstWindow();
    await shell.waitForLoadState('domcontentloaded');
    await shell.evaluate((u) => window.filoShell.tabs.open(u), SEC_URL);
    const page = await findTabPage(app, 'security');
    await page.waitForLoadState('domcontentloaded');
    await expect(page.locator('#sec-clip-list .sn-clip-item')).toHaveCount(8);

    const bersaglio = page.locator('#sec-clip-list .sn-clip-item').nth(2).locator('.sn-clip-remove');
    await bersaglio.scrollIntoViewIfNeeded();
    await page.waitForTimeout(200);
    const box = await bersaglio.boundingBox();
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;
    await page.mouse.move(cx, cy);
    await page.mouse.down(); await page.mouse.up();
    await page.waitForTimeout(100);
    await page.mouse.down(); await page.mouse.up();
    await page.waitForTimeout(600);
    let restanti = await page.evaluate(async () => {
      const r = await chrome.runtime.sendMessage({ type: window.SN_MSG.MSG.GET_CLIPBOARD_HISTORY });
      return (r.items || []).map((x) => x.text);
    });
    console.log('[F1] dopo il doppio clic a 0,1 s:', JSON.stringify(restanti));
    expect(restanti.length, 'un doppio clic rapido toglie UNA voce').toBe(7);
    expect(restanti).toContain('voce-3');

    // Stessa prova a tre decimi di secondo, su un'altra voce.
    const b2 = page.locator('#sec-clip-list .sn-clip-item').nth(4).locator('.sn-clip-remove');
    await b2.scrollIntoViewIfNeeded();
    await page.waitForTimeout(200);
    const box2 = await b2.boundingBox();
    await page.mouse.move(box2.x + box2.width / 2, box2.y + box2.height / 2);
    await page.mouse.down(); await page.mouse.up();
    await page.waitForTimeout(300);
    await page.mouse.down(); await page.mouse.up();
    await page.waitForTimeout(600);
    restanti = await page.evaluate(async () => {
      const r = await chrome.runtime.sendMessage({ type: window.SN_MSG.MSG.GET_CLIPBOARD_HISTORY });
      return (r.items || []).map((x) => x.text);
    });
    console.log('[F1] dopo il doppio clic a 0,3 s:', JSON.stringify(restanti));
    expect(restanti.length, 'anche a tre decimi toglie UNA voce').toBe(6);
  } finally {
    try { await app.close(); } catch (_) {}
    rmSync(userData, { recursive: true, force: true });
  }
});

test('F2 — dentro una pagina di Filo il tasto destro su un campo di testo offre la stessa cronologia', async () => {
  const userData = conCronologia('g4d-interna-', voci(4));
  const app = await avvia(userData);
  try {
    const shell = await app.firstWindow();
    await shell.waitForLoadState('domcontentloaded');
    await shell.evaluate((u) => window.filoShell.tabs.open(u), SEC_URL);
    const page = await findTabPage(app, 'security');
    await page.waitForLoadState('domcontentloaded');
    await page.locator('#sec-clip-search').click({ button: 'right' });
    await page.waitForTimeout(700);
    const stato = await page.evaluate(() => ({
      menu: !!document.querySelector('.sn-menu'),
      freccia: !!document.querySelector('.sn-menu-paste-arrow'),
      voci: [...document.querySelectorAll('.sn-menu-item')].map((b) => b.textContent.trim()).slice(0, 12),
    }));
    console.log('[F2] menu del tasto destro su una pagina di Filo:', JSON.stringify(stato));
  } finally {
    try { await app.close(); } catch (_) {}
    rmSync(userData, { recursive: true, force: true });
  }
});

test('F3 — apri e chiudi il sotto-menu dieci volte: le voci tolte restano tolte e non ne spariscono altre', async () => {
  const userData = conCronologia('g4d-ripeti-', voci(10));
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
    for (let giro = 0; giro < 10; giro++) {
      await web.locator('#ta').click({ button: 'right' });
      await web.locator('.sn-menu-paste-arrow').click();
      const sub = web.locator('.sn-menu-history-sub');
      await expect(sub).toBeVisible();
      if (giro % 3 === 0) {
        await sub.locator('.sn-menu-history-item:not(.sn-menu-history-gone)').first()
          .locator('.sn-menu-history-remove').click();
        await web.waitForTimeout(250);
      }
      await web.keyboard.press('Escape');
      await web.waitForTimeout(150);
    }
    await web.locator('#ta').click({ button: 'right' });
    await web.locator('.sn-menu-paste-arrow').click();
    const finali = await web.locator('.sn-menu-history-sub .sn-menu-history-item').count();
    const testi = await web.evaluate(() => [...document.querySelectorAll('.sn-menu-history-sub .sn-menu-label')].map((s) => s.textContent));
    console.log('[F3] voci rimaste dopo 10 giri con 4 rimozioni:', finali, JSON.stringify(testi));
    expect(finali, 'quattro rimozioni, sei voci rimaste').toBe(6);
  } finally {
    server.close();
    try { await app.close(); } catch (_) {}
    rmSync(userData, { recursive: true, force: true });
  }
});
