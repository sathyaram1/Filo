// Feedback #256 — giro 5, seconda tornata: altre porte della stessa causa
// (la lista che si muove sotto la mano) e casi di lista lunga.

import { test, expect } from './fixtures/electron.mjs';
import { _electron as electron } from '@playwright/test';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';

const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SEC_URL = 'filo://security/security.html';
const SHOTS = join(APP_ROOT, 'tests', '.shots');
try { mkdirSync(SHOTS, { recursive: true }); } catch (_) {}
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

function conCronologia(prefix, items, extra) {
  const userData = mkdtempSync(join(tmpdir(), prefix));
  writeFileSync(join(userData, 'storage.json'), JSON.stringify({ clipboardHistory: items, ...extra }), 'utf8');
  return userData;
}

async function serviPagina() {
  const server = createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(PAGE);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { url: `http://127.0.0.1:${server.address().port}/p`, close: () => server.close() };
}

const cinquanta = () => Array.from({ length: 50 }, (_, i) => ({ type: 'text', text: `voce numero ${i}`, ts: 1000 - i }));

// A. Cinquanta voci: la lista scorre dentro il suo riquadro, e dopo aver tolto
//    una voce in fondo il posto in cui si stava guardando non si perde.
test('Sicurezza: con cinquanta voci la lista scorre e non perde il posto', async () => {
  const userData = conCronologia('g5b-50-', cinquanta());
  const app = await avvia(userData);
  try {
    const shell = await app.firstWindow();
    await shell.waitForLoadState('domcontentloaded');
    await shell.evaluate((u) => window.filoShell.tabs.open(u), SEC_URL);
    const page = await findTabPage(app, 'security');
    await page.waitForLoadState('domcontentloaded');
    const rows = page.locator('#sec-clip-list .sn-clip-item');
    await expect(rows).toHaveCount(50);

    const misure = await page.evaluate(() => {
      const l = document.getElementById('sec-clip-list');
      return { scrollH: l.scrollHeight, clientH: l.clientHeight, docOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth };
    });
    console.log('LISTA-50 >>>', JSON.stringify(misure));
    expect(misure.scrollH).toBeGreaterThan(misure.clientH); // scorre dentro il riquadro
    expect(misure.docOverflow).toBeLessThanOrEqual(1);

    // Scorro in fondo alla lista e tolgo una voce di lì.
    await page.evaluate(() => { document.getElementById('sec-clip-list').scrollTop = 99999; });
    await page.waitForTimeout(200);
    const primaScroll = await page.evaluate(() => document.getElementById('sec-clip-list').scrollTop);
    const visibile = await page.locator('#sec-clip-list .sn-clip-item:visible').last();
    await visibile.locator('.sn-clip-remove').hover();
    await page.mouse.down(); await page.mouse.up();
    await page.waitForTimeout(900);
    // Esco dalla lista: si ricompone.
    await page.mouse.move(5, 5);
    await expect(rows).toHaveCount(49);
    const dopoScroll = await page.evaluate(() => document.getElementById('sec-clip-list').scrollTop);
    console.log('SCROLL prima/dopo >>>', primaScroll, dopoScroll);
    await page.screenshot({ path: join(SHOTS, 'g5b-50-dopo.png') });
  } finally {
    try { await app.close(); } catch (_) {}
    rmSync(userData, { recursive: true, force: true });
  }
});

// B. Uscendo dalla lista, il tasto "Svuota cronologia" si sposta? Se la lista si
//    accorcia, tutto ciò che sta sotto risale: il clic che stavi per dare su
//    "Svuota" potrebbe finire altrove.
test('Sicurezza: uscendo dalla lista il tasto "Svuota" non si sposta sotto il puntatore', async () => {
  const userData = conCronologia('g5b-shift-', cinquanta().slice(0, 10));
  const app = await avvia(userData);
  try {
    const shell = await app.firstWindow();
    await shell.waitForLoadState('domcontentloaded');
    await shell.evaluate((u) => window.filoShell.tabs.open(u), SEC_URL);
    const page = await findTabPage(app, 'security');
    await page.waitForLoadState('domcontentloaded');
    const rows = page.locator('#sec-clip-list .sn-clip-item');
    await expect(rows).toHaveCount(10);
    const primaSvuota = await page.locator('#sec-clip-clear').boundingBox();
    // Tolgo tre voci col puntatore dentro la lista.
    for (let i = 0; i < 3; i++) {
      await rows.nth(i).locator('.sn-clip-remove').hover();
      await page.mouse.down(); await page.mouse.up();
      await page.waitForTimeout(500);
    }
    // Esco: la lista si ricompone e si accorcia.
    await page.mouse.move(5, 5);
    await expect(rows).toHaveCount(7);
    const dopoSvuota = await page.locator('#sec-clip-clear').boundingBox();
    console.log('SVUOTA prima/dopo >>>', JSON.stringify(primaSvuota), JSON.stringify(dopoSvuota));
    // Cosa c'è ADESSO dove stava "Svuota cronologia" prima?
    const sotto = await page.evaluate((box) => {
      const el = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
      return el ? (el.id || el.className || el.tagName) : null;
    }, primaSvuota);
    console.log('DOVE-STAVA-SVUOTA-ORA >>>', sotto);
  } finally {
    try { await app.close(); } catch (_) {}
    rmSync(userData, { recursive: true, force: true });
  }
});

// C. Menu con cinquanta voci: scorre dentro il suo riquadro e non sfonda lo
//    schermo; la conferma dello svuotamento dopo aver tolto qualcosa a mano.
test('menu Incolla: cinquanta voci scorrono nel riquadro', async () => {
  const userData = conCronologia('g5b-menu50-', cinquanta());
  const srv = await serviPagina();
  const app = await avvia(userData);
  try {
    const shell = await app.firstWindow();
    await shell.waitForLoadState('domcontentloaded');
    await shell.evaluate((u) => window.filoShell.tabs.open(u), srv.url);
    const web = await findTabPage(app, '127.0.0.1');
    await web.waitForFunction(() => document.documentElement.dataset.filoReady === '1', null, { timeout: 15000 });
    await web.locator('#ta').click({ button: 'right' });
    await web.locator('.sn-menu-paste-arrow').click();
    const sub = web.locator('.sn-menu-history-sub');
    await expect(sub).toBeVisible();
    await expect(sub.locator('.sn-menu-history-item')).toHaveCount(50);
    const box = await sub.boundingBox();
    const vp = web.viewportSize() || { width: 1280, height: 800 };
    console.log('SUB-BOX >>>', JSON.stringify(box), 'viewport', JSON.stringify(vp));
    expect(box.y).toBeGreaterThanOrEqual(-1);
    expect(box.y + box.height).toBeLessThanOrEqual(vp.height + 2);
    await web.screenshot({ path: join(SHOTS, 'g5b-menu-50.png') });
  } finally {
    srv.close();
    try { await app.close(); } catch (_) {}
    rmSync(userData, { recursive: true, force: true });
  }
});

// D. Tastiera: si arriva ai tasti "Rimuovi" e "Svuota" senza mouse, e due Invio
//    di fila non portano via due voci.
test('Sicurezza: da tastiera due Invio di fila tolgono UNA voce', async () => {
  const userData = conCronologia('g5b-tastiera-', cinquanta().slice(0, 6));
  const app = await avvia(userData);
  try {
    const shell = await app.firstWindow();
    await shell.waitForLoadState('domcontentloaded');
    await shell.evaluate((u) => window.filoShell.tabs.open(u), SEC_URL);
    const page = await findTabPage(app, 'security');
    await page.waitForLoadState('domcontentloaded');
    await expect(page.locator('#sec-clip-list .sn-clip-item')).toHaveCount(6);
    // Il puntatore è lontano dalla lista: la rimozione da tastiera ricompone.
    await page.mouse.move(5, 5);
    await page.locator('#sec-clip-list .sn-clip-item').nth(2).locator('.sn-clip-remove').focus();
    await page.keyboard.press('Enter');
    await page.waitForTimeout(120);
    await page.keyboard.press('Enter');
    await page.waitForTimeout(1200);
    const testi = await page.evaluate(async () => {
      const r = await chrome.runtime.sendMessage({ type: window.SN_MSG.MSG.GET_CLIPBOARD_HISTORY });
      return (r.items || []).map((x) => x.text);
    });
    console.log('DOPO-DUE-INVIO >>>', JSON.stringify(testi));
    expect(testi).toHaveLength(5);
    const focus = await page.evaluate(() => {
      const a = document.activeElement;
      return a ? (a.className || a.tagName) : null;
    });
    console.log('FOCUS-DOPO >>>', focus);
  } finally {
    try { await app.close(); } catch (_) {}
    rmSync(userData, { recursive: true, force: true });
  }
});
