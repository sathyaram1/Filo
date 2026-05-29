// Feedback alpha (riaperto 2x): "il tasto destro non funziona su reddit/youtube".
//
// Causa: questi siti hanno una CSP restrittiva (style-src) che BLOCCA il
// <link filo://style/menu.css> iniettato dal content script. Il menu Filo
// veniva creato nel DOM ma senza stile (position:static, niente sfondo né
// z-index) → invisibile. L'utente lo percepiva come "il tasto destro non
// funziona". I test esistenti usavano HTML locale SENZA CSP, quindi non lo
// vedevano (asimmetria test ↔ siti reali).
//
// Fix: il CSS dei content script viene iniettato anche via wc.insertCSS dal
// main process (ignora la CSP, come già il colore della selezione).
//
// Questo test asserisce il SUCCESSO: su un sito con CSP restrittiva il menu
// compare ED è effettivamente stilizzato (position:fixed + z-index alto).

import { test, expect } from './fixtures/electron.mjs';
import { createServer } from 'node:http';

const PAGE = `<!doctype html><html><body style="padding:40px;font:16px sans-serif">
  <h1>Sito con CSP (tipo YouTube/Reddit)</h1>
  <p id="p">Tasto destro qui.</p>
</body></html>`;

// CSP che blocca gli stylesheet di origini diverse da 'self' (come i siti reali):
// il <link filo://style/menu.css> viene rifiutato dal browser.
const CSP = "default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'";

let server;
let origin;
test.beforeAll(async () => {
  server = createServer((req, res) => {
    res.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Security-Policy': CSP,
    });
    res.end(PAGE);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  origin = `http://127.0.0.1:${server.address().port}/`;
});
test.afterAll(async () => { await new Promise((r) => server.close(r)); });

async function findPageByPort(app, port) {
  const deadline = Date.now() + 12000;
  while (Date.now() < deadline) {
    const p = app.windows().find((w) => {
      try { return new URL(w.url()).port === port; } catch (_) { return false; }
    });
    if (p) return p;
    await new Promise((r) => setTimeout(r, 100));
  }
  return null;
}

async function assertStyledMenu(page) {
  await page.locator('#p').click({ button: 'right' });
  const menu = page.locator('.sn-menu').first();
  await expect(menu).toBeVisible();
  // Il punto chiave: lo stile DEVE essere applicato anche con la CSP attiva.
  const style = await menu.evaluate((el) => {
    const cs = getComputedStyle(el);
    return { position: cs.position, zIndex: cs.zIndex };
  });
  expect(style.position, 'menu.css non applicato (CSP avrebbe bloccato lo stylesheet)').toBe('fixed');
  expect(Number(style.zIndex)).toBeGreaterThan(1000);
}

test('tasto destro: il menu è stilizzato su un sito con CSP restrittiva (tab aperto direttamente)', async ({ app, shell }) => {
  const port = new URL(origin).port;
  await shell.evaluate((u) => window.filoShell.tabs.open(u), origin);
  const page = await findPageByPort(app, port);
  expect(page, 'pagina esterna non aperta').toBeTruthy();
  await page.waitForLoadState('domcontentloaded').catch(() => {});
  await page.waitForTimeout(700);
  await assertStyledMenu(page);
});

test('tasto destro: funziona anche se una newtab interna naviga verso il sito con CSP', async ({ app, shell }) => {
  const port = new URL(origin).port;
  await shell.evaluate(() => window.filoShell.tabs.open('filo://newtab/'));
  await shell.waitForTimeout(400);
  const snap = await shell.evaluate(() => window.filoShell.tabs.snapshot());
  const tabs = snap.tabs || snap;
  const newtab = tabs.find((t) => (t.url || '').startsWith('filo://newtab'));
  expect(newtab).toBeTruthy();
  await shell.evaluate(({ id, u }) => window.filoShell.tabs.navigate(id, u), { id: newtab.id, u: origin });
  const page = await findPageByPort(app, port);
  expect(page, 'pagina esterna (post-navigate) non trovata').toBeTruthy();
  await page.waitForLoadState('domcontentloaded').catch(() => {});
  await page.waitForTimeout(700);
  await assertStyledMenu(page);
});
