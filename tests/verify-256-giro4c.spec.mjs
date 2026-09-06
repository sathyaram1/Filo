// Verifica avversariale #256, giro 4 — terza tornata: miniature vere,
// scorrimento della lista quando si ricompone, tastiera nel menu.

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
const PNG_BLU = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

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

async function serviPagina() {
  const server = createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(PAGE);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { url: `http://127.0.0.1:${server.address().port}/p`, close: () => server.close() };
}

const voci = (n) => Array.from({ length: n }, (_, i) => ({ type: 'text', text: `voce-${i}`, ts: 1000 - i }));

test('E1 — due immagini copiate diverse hanno miniature diverse, in pagina e nel menu', async () => {
  const items = [
    { type: 'image', dataUrl: PNG_ROSSO, description: 'Immagine', ts: 100 },
    { type: 'image', dataUrl: PNG_BLU, description: 'Immagine', ts: 99 },
    { type: 'text', text: 'una riga di testo', ts: 98 },
  ];
  const userData = conCronologia('g4c-img-', items);
  const srv = await serviPagina();
  const app = await avvia(userData);
  try {
    const shell = await app.firstWindow();
    await shell.waitForLoadState('domcontentloaded');
    await shell.evaluate((u) => window.filoShell.tabs.open(u), SEC_URL);
    const page = await findTabPage(app, 'security');
    await page.waitForLoadState('domcontentloaded');
    const pag = await page.evaluate(() => [...document.querySelectorAll('#sec-clip-list img.sn-clip-thumb')].map((i) => i.src));
    console.log('[E1] miniature pagina:', pag.length, 'distinte:', new Set(pag).size);
    expect(pag.length).toBe(2);
    expect(new Set(pag).size).toBe(2);

    await shell.evaluate((u) => window.filoShell.tabs.open(u), srv.url);
    const web = await findTabPage(app, '127.0.0.1');
    await web.waitForFunction(() => document.documentElement.dataset.filoReady === '1', null, { timeout: 20000 });
    await web.locator('#ta').click({ button: 'right' });
    await web.locator('.sn-menu-paste-arrow').click();
    await expect(web.locator('.sn-menu-history-sub')).toBeVisible();
    await web.waitForTimeout(500);
    const men = await web.evaluate(() => [...document.querySelectorAll('.sn-menu-history-sub img.sn-menu-history-thumb')].map((i) => ({ src: i.src, w: i.getBoundingClientRect().width })));
    console.log('[E1] miniature menu:', JSON.stringify(men.map((m) => ({ w: m.w, src: m.src.slice(-12) }))));
    expect(men.length, 'anche nel menu ogni immagine ha la sua miniatura').toBe(2);
    expect(new Set(men.map((m) => m.src)).size).toBe(2);
    for (const m of men) expect(m.w, 'la miniatura si deve vedere').toBeGreaterThan(4);
    mkdirSync(SHOTS, { recursive: true });
    await web.screenshot({ path: join(SHOTS, '256-g4-menu-immagini.png') });
  } finally {
    srv.close();
    try { await app.close(); } catch (_) {}
    rmSync(userData, { recursive: true, force: true });
  }
});

test('E2 — tolta una voce in fondo a una lista lunga, allontanando il mouse non si perde il punto in cui si stava guardando', async () => {
  const userData = conCronologia('g4c-scroll-', voci(50));
  const app = await avvia(userData);
  try {
    const shell = await app.firstWindow();
    await shell.waitForLoadState('domcontentloaded');
    await shell.evaluate((u) => window.filoShell.tabs.open(u), SEC_URL);
    const page = await findTabPage(app, 'security');
    await page.waitForLoadState('domcontentloaded');
    await expect(page.locator('#sec-clip-list .sn-clip-item')).toHaveCount(50);

    // Scorro in fondo alla lista e tolgo una voce da lì.
    await page.evaluate(() => { const l = document.getElementById('sec-clip-list'); l.scrollTop = l.scrollHeight; });
    await page.waitForTimeout(200);
    const prima = await page.evaluate(() => document.getElementById('sec-clip-list').scrollTop);
    const riga = page.locator('#sec-clip-list .sn-clip-item').nth(47);
    await riga.locator('.sn-clip-remove').click();
    await page.waitForTimeout(400);
    const durante = await page.evaluate(() => document.getElementById('sec-clip-list').scrollTop);

    // Ora allontano il puntatore: è qui che la lista si ricompone.
    await page.mouse.move(5, 5);
    await page.waitForTimeout(800);
    const dopo = await page.evaluate(() => document.getElementById('sec-clip-list').scrollTop);
    console.log('[E2] scorrimento — prima:', prima, 'durante:', durante, 'dopo il ricomporsi:', dopo);
    expect(await page.locator('#sec-clip-list .sn-clip-item').count()).toBe(49);
    expect(dopo, 'la lista non deve tornare in cima quando si ricompone').toBeGreaterThan(prima / 2);
  } finally {
    try { await app.close(); } catch (_) {}
    rmSync(userData, { recursive: true, force: true });
  }
});

test('E3 — menu «Incolla»: da tastiera il fuoco resta sulla lista anche col puntatore fermo sopra', async () => {
  const userData = conCronologia('g4c-menu-fuoco-', voci(6));
  const srv = await serviPagina();
  const app = await avvia(userData);
  try {
    const shell = await app.firstWindow();
    await shell.waitForLoadState('domcontentloaded');
    await shell.evaluate((u) => window.filoShell.tabs.open(u), srv.url);
    const web = await findTabPage(app, '127.0.0.1');
    await web.waitForFunction(() => document.documentElement.dataset.filoReady === '1', null, { timeout: 20000 });
    await web.locator('#ta').click({ button: 'right' });
    await web.locator('.sn-menu-paste-arrow').click();
    const sub = web.locator('.sn-menu-history-sub');
    await expect(sub.locator('.sn-menu-history-item')).toHaveCount(6);
    const riga = sub.locator('.sn-menu-history-item').nth(1);
    await riga.hover();
    await riga.locator('.sn-menu-history-remove').focus();
    await web.keyboard.press('Enter');
    await web.waitForTimeout(400);
    const dove = await web.evaluate(() => {
      const a = document.activeElement;
      return { tag: a && a.tagName, classe: (a && a.className) || '', corpo: a === document.body };
    });
    console.log('[E3] fuoco nel menu dopo Invio, col puntatore sulla riga:', JSON.stringify(dove));
    expect(dove.corpo, 'il fuoco non deve tornare al corpo della pagina').toBe(false);
  } finally {
    srv.close();
    try { await app.close(); } catch (_) {}
    rmSync(userData, { recursive: true, force: true });
  }
});

test('E4 — copiando in un\'altra scheda mentre il puntatore è sulla lista, la pagina lo dice e non sposta niente', async () => {
  const userData = conCronologia('g4c-pending-', voci(5));
  const srv = await serviPagina();
  const app = await avvia(userData);
  try {
    const shell = await app.firstWindow();
    await shell.waitForLoadState('domcontentloaded');
    await shell.evaluate((u) => window.filoShell.tabs.open(u), SEC_URL);
    const page = await findTabPage(app, 'security');
    await page.waitForLoadState('domcontentloaded');
    await expect(page.locator('#sec-clip-list .sn-clip-item')).toHaveCount(5);
    // Il puntatore entra nella lista e ci resta.
    await page.locator('#sec-clip-list .sn-clip-item').nth(2).hover();

    // Una copia arriva da fuori (stessa cosa che farebbe un'altra scheda).
    await page.evaluate(async () => {
      await chrome.runtime.sendMessage({
        type: window.SN_MSG.MSG.PUSH_CLIPBOARD_ENTRY,
        entry: { type: 'text', text: 'ROBA-NUOVA-COPIATA' },
      });
    });
    await page.waitForTimeout(800);
    const righe = await page.locator('#sec-clip-list .sn-clip-item').count();
    const avviso = await page.locator('#sec-clip-pending').textContent();
    const prima = await page.locator('#sec-clip-list .sn-clip-item').first().textContent();
    console.log('[E4] righe:', righe, '| avviso:', JSON.stringify(avviso), '| prima riga:', JSON.stringify(prima));
    expect(righe, 'la lista non si allunga sotto la mano').toBe(5);
    expect(avviso || '', 'la pagina deve dire che c\'è qualcosa in attesa').toMatch(/copiat/i);

    // Allontanato il puntatore, la voce nuova compare.
    await page.mouse.move(5, 5);
    await page.waitForTimeout(800);
    await expect(page.locator('#sec-clip-list .sn-clip-item')).toHaveCount(6);
    await expect(page.locator('#sec-clip-list .sn-clip-item').first()).toContainText('ROBA-NUOVA-COPIATA');
    await expect(page.locator('#sec-clip-pending')).toBeHidden();
  } finally {
    srv.close();
    try { await app.close(); } catch (_) {}
    rmSync(userData, { recursive: true, force: true });
  }
});
