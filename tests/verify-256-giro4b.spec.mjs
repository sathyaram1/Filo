// Verifica avversariale #256, giro 4 — seconda tornata: cronologia piena,
// immagini, tastiera, e l'incastro fra "la lista non si muove sotto la mano" e
// tutto il resto.

import { test, expect } from './fixtures/electron.mjs';
import { _electron as electron } from '@playwright/test';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';
import { confirmText, clickConfirm } from './helpers/confirm.mjs';

const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SEC_URL = 'filo://security/security.html';
const PAGE = '<!doctype html><html><body style="padding:40px"><textarea id="ta" rows="4" cols="40"></textarea><p id="p">testo qualunque da copiare</p></body></html>';
const SHOTS = join(APP_ROOT, 'tests', '.shots');

// Due PNG 1x1 di colore diverso: due immagini copiate che devono distinguersi.
const PNG_ROSSO = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const PNG_BLU = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
const GIF_1x1 = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';

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

function conStorage(prefix, storage) {
  const userData = mkdtempSync(join(tmpdir(), prefix));
  writeFileSync(join(userData, 'storage.json'), JSON.stringify(storage), 'utf8');
  return userData;
}

const conCronologia = (prefix, items) => conStorage(prefix, { clipboardHistory: items });

async function serviPagina() {
  const server = createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(PAGE);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { url: `http://127.0.0.1:${server.address().port}/p`, close: () => server.close() };
}

const voci = (n) => Array.from({ length: n }, (_, i) => ({ type: 'text', text: `voce-${i}`, ts: 1000 - i }));

test('D1 — cronologia piena (50 voci): la lista scorre dentro il suo riquadro e il sotto-menu resta nello schermo', async () => {
  const userData = conCronologia('g4b-50-', voci(50));
  const srv = await serviPagina();
  const app = await avvia(userData);
  try {
    const shell = await app.firstWindow();
    await shell.waitForLoadState('domcontentloaded');
    await shell.evaluate((u) => window.filoShell.tabs.open(u), SEC_URL);
    const page = await findTabPage(app, 'security');
    await page.waitForLoadState('domcontentloaded');
    await expect(page.locator('#sec-clip-list .sn-clip-item')).toHaveCount(50);
    const misure = await page.evaluate(() => {
      const l = document.getElementById('sec-clip-list');
      const s = getComputedStyle(l);
      return {
        overflowY: s.overflowY,
        maxH: s.maxHeight,
        scroll: l.scrollHeight,
        client: l.clientHeight,
        pagSbordaX: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
      };
    });
    console.log('[D1] lista pagina:', JSON.stringify(misure));
    expect(misure.scroll, 'la lista deve scorrere dentro il suo riquadro').toBeGreaterThan(misure.client);
    expect(misure.pagSbordaX).toBe(false);

    // Il sotto-menu della freccia «Incolla» con 50 voci resta dentro lo schermo.
    await shell.evaluate((u) => window.filoShell.tabs.open(u), srv.url);
    const web = await findTabPage(app, '127.0.0.1');
    await web.waitForFunction(() => document.documentElement.dataset.filoReady === '1', null, { timeout: 20000 });
    await web.locator('#ta').click({ button: 'right' });
    await web.locator('.sn-menu-paste-arrow').click();
    const sub = web.locator('.sn-menu-history-sub');
    await expect(sub).toBeVisible();
    const box = await sub.boundingBox();
    const vp = await web.evaluate(() => ({ w: window.innerWidth, h: window.innerHeight }));
    console.log('[D1] sotto-menu:', JSON.stringify(box), 'viewport', JSON.stringify(vp));
    expect(box.y).toBeGreaterThanOrEqual(-1);
    expect(box.y + box.height, 'il sotto-menu non deve uscire dal fondo').toBeLessThanOrEqual(vp.h + 1);
    expect(box.x + box.width, 'né dal lato').toBeLessThanOrEqual(vp.w + 1);
  } finally {
    srv.close();
    try { await app.close(); } catch (_) {}
    rmSync(userData, { recursive: true, force: true });
  }
});

test('D2 — due immagini copiate diverse si distinguono da tutte e due le parti', async () => {
  const items = [
    { type: 'image', dataUrl: PNG_ROSSO, description: 'Immagine', ts: 100 },
    { type: 'image', dataUrl: PNG_BLU, description: 'Immagine', ts: 99 },
    { type: 'text', text: 'una riga di testo', ts: 98 },
  ];
  const userData = conCronologia('g4b-img-', items);
  const srv = await serviPagina();
  const app = await avvia(userData);
  try {
    const shell = await app.firstWindow();
    await shell.waitForLoadState('domcontentloaded');
    await shell.evaluate((u) => window.filoShell.tabs.open(u), SEC_URL);
    const page = await findTabPage(app, 'security');
    await page.waitForLoadState('domcontentloaded');
    const thumbPagina = await page.evaluate(() => [...document.querySelectorAll('#sec-clip-list img.sn-clip-thumb')].map((i) => i.src.slice(0, 60)));
    console.log('[D2] miniature nella pagina:', thumbPagina.length, 'distinte:', new Set(thumbPagina).size);
    expect(thumbPagina.length).toBe(2);
    expect(new Set(thumbPagina).size, 'due immagini diverse, due miniature diverse').toBe(2);

    await shell.evaluate((u) => window.filoShell.tabs.open(u), srv.url);
    const web = await findTabPage(app, '127.0.0.1');
    await web.waitForFunction(() => document.documentElement.dataset.filoReady === '1', null, { timeout: 20000 });
    await web.locator('#ta').click({ button: 'right' });
    await web.locator('.sn-menu-paste-arrow').click();
    await expect(web.locator('.sn-menu-history-sub')).toBeVisible();
    await web.waitForTimeout(400);
    const thumbMenu = await web.evaluate(() => [...document.querySelectorAll('.sn-menu-history-sub img.sn-menu-history-thumb')].map((i) => i.src.slice(0, 60)));
    console.log('[D2] miniature nel menu:', thumbMenu.length, 'distinte:', new Set(thumbMenu).size);
    expect(thumbMenu.length, 'anche nel menu ogni immagine ha la sua miniatura').toBe(2);
    expect(new Set(thumbMenu).size).toBe(2);
    mkdirSync(SHOTS, { recursive: true });
    await web.screenshot({ path: join(SHOTS, '256-g4-menu-immagini.png') });
  } finally {
    srv.close();
    try { await app.close(); } catch (_) {}
    rmSync(userData, { recursive: true, force: true });
  }
});

test('D3 — «Rimetti negli appunti» con un\'immagine: PNG e non-PNG', async () => {
  const items = [
    { type: 'image', dataUrl: PNG_ROSSO, description: 'Quadratino rosso', ts: 100 },
    { type: 'image', dataUrl: GIF_1x1, description: 'Una gif', ts: 99 },
  ];
  const userData = conCronologia('g4b-copiaimg-', items);
  const app = await avvia(userData);
  try {
    await app.evaluate(({ clipboard }) => clipboard.clear());
    const shell = await app.firstWindow();
    await shell.waitForLoadState('domcontentloaded');
    await shell.evaluate((u) => window.filoShell.tabs.open(u), SEC_URL);
    const page = await findTabPage(app, 'security');
    await page.waitForLoadState('domcontentloaded');
    await expect(page.locator('#sec-clip-list .sn-clip-item')).toHaveCount(2);

    await page.locator('#sec-clip-list .sn-clip-item').nth(0).locator('.sn-clip-copy').click();
    await page.waitForTimeout(800);
    const avvisoPng = await page.locator('#sec-clip-hint').textContent();
    const png = await app.evaluate(({ clipboard }) => {
      const i = clipboard.readImage();
      return { vuota: i.isEmpty(), dim: i.getSize() };
    });
    console.log('[D3] PNG → avviso:', JSON.stringify(avvisoPng), 'appunti:', JSON.stringify(png));

    await app.evaluate(({ clipboard }) => clipboard.clear());
    await page.locator('#sec-clip-list .sn-clip-item').nth(1).locator('.sn-clip-copy').click();
    await page.waitForTimeout(800);
    const avvisoGif = await page.locator('#sec-clip-hint').textContent();
    const gif = await app.evaluate(({ clipboard }) => {
      const i = clipboard.readImage();
      return { vuota: i.isEmpty(), dim: i.getSize() };
    });
    console.log('[D3] GIF → avviso:', JSON.stringify(avvisoGif), 'appunti:', JSON.stringify(gif));

    expect(png.vuota, 'un PNG copiato deve finire davvero negli appunti').toBe(false);
    expect(gif.vuota, 'anche un\'immagine non-PNG deve finire negli appunti, o l\'avviso deve dirlo').toBe(false);
  } finally {
    try { await app.close(); } catch (_) {}
    rmSync(userData, { recursive: true, force: true });
  }
});

test('D4 — da tastiera, tolta una voce il fuoco resta sulla lista anche col mouse fermo sopra', async () => {
  const userData = conCronologia('g4b-fuoco-', voci(6));
  const app = await avvia(userData);
  try {
    const shell = await app.firstWindow();
    await shell.waitForLoadState('domcontentloaded');
    await shell.evaluate((u) => window.filoShell.tabs.open(u), SEC_URL);
    const page = await findTabPage(app, 'security');
    await page.waitForLoadState('domcontentloaded');
    await expect(page.locator('#sec-clip-list .sn-clip-item')).toHaveCount(6);

    // Caso 1 — mouse lontano (il caso del giro scorso): deve restare qualcosa
    // sotto le dita.
    await page.mouse.move(4, 4);
    await page.locator('#sec-clip-list .sn-clip-item').nth(2).locator('.sn-clip-remove').focus();
    await page.keyboard.press('Enter');
    await page.waitForTimeout(500);
    const dove1 = await page.evaluate(() => {
      const a = document.activeElement;
      return { tag: a && a.tagName, classe: (a && a.className) || '', riga: a && a.closest && a.closest('.sn-clip-item') ? a.closest('.sn-clip-item').textContent : null };
    });
    console.log('[D4] mouse lontano, fuoco dopo Invio:', JSON.stringify(dove1));
    expect(dove1.classe, 'il fuoco resta su un «Rimuovi»').toContain('sn-clip-remove');

    // Caso 2 — mouse FERMO sopra la lista (la mano sul mouse mentre si usa la
    // tastiera): la lista non si ricompone, e il bottone premuto è disabilitato.
    const riga = page.locator('#sec-clip-list .sn-clip-item').nth(1);
    await riga.hover();
    await riga.locator('.sn-clip-remove').focus();
    await page.keyboard.press('Enter');
    await page.waitForTimeout(500);
    const dove2 = await page.evaluate(() => {
      const a = document.activeElement;
      return {
        tag: a && a.tagName,
        classe: (a && a.className) || '',
        disabilitato: !!(a && a.disabled),
        corpo: a === document.body,
      };
    });
    console.log('[D4] mouse sulla lista, fuoco dopo Invio:', JSON.stringify(dove2));
    expect(dove2.corpo, 'col mouse fermo sulla lista il fuoco non deve tornare al corpo della pagina').toBe(false);
  } finally {
    try { await app.close(); } catch (_) {}
    rmSync(userData, { recursive: true, force: true });
  }
});

test('D5 — col puntatore sulla lista, «Svuota cronologia» e la ricerca continuano a funzionare', async () => {
  const userData = conCronologia('g4b-freeze-', voci(8));
  const app = await avvia(userData);
  try {
    const shell = await app.firstWindow();
    await shell.waitForLoadState('domcontentloaded');
    await shell.evaluate((u) => window.filoShell.tabs.open(u), SEC_URL);
    const page = await findTabPage(app, 'security');
    await page.waitForLoadState('domcontentloaded');
    await expect(page.locator('#sec-clip-list .sn-clip-item')).toHaveCount(8);

    // Tolgo due voci col mouse (la lista resta ferma, due righe barrate).
    await page.locator('#sec-clip-list .sn-clip-item').nth(0).locator('.sn-clip-remove').click();
    await page.waitForTimeout(250);
    await page.locator('#sec-clip-list .sn-clip-item').nth(1).locator('.sn-clip-remove').click();
    await page.waitForTimeout(250);
    await expect(page.locator('#sec-clip-list .sn-clip-gone')).toHaveCount(2);

    // La ricerca deve continuare a filtrare le righe rimaste.
    await page.fill('#sec-clip-search', 'voce-5');
    await page.waitForTimeout(200);
    const visibili = await page.locator('#sec-clip-list .sn-clip-item:visible').count();
    console.log('[D5] righe visibili filtrando "voce-5":', visibili);
    expect(visibili).toBe(1);

    // La conferma dello svuotamento conta le voci VERE rimaste (6), non 8.
    await page.evaluate(() => document.getElementById('sec-clip-clear').focus());
    await page.keyboard.press('Enter');
    await page.waitForTimeout(400);
    const testo = await confirmText(page);
    console.log('[D5] conferma dopo due rimozioni:', JSON.stringify(testo));
    await clickConfirm(page, 'cancel');
    expect(testo).toContain('6');
  } finally {
    try { await app.close(); } catch (_) {}
    rmSync(userData, { recursive: true, force: true });
  }
});

test('D6 — la pagina lasciata aperta perde una voce tolta dal menu «Incolla», e la riprende quando il puntatore esce', async () => {
  const userData = conCronologia('g4b-due-viste-', voci(5));
  const srv = await serviPagina();
  const app = await avvia(userData);
  try {
    const shell = await app.firstWindow();
    await shell.waitForLoadState('domcontentloaded');
    await shell.evaluate((u) => window.filoShell.tabs.open(u), SEC_URL);
    const page = await findTabPage(app, 'security');
    await page.waitForLoadState('domcontentloaded');
    await expect(page.locator('#sec-clip-list .sn-clip-item')).toHaveCount(5);

    await shell.evaluate((u) => window.filoShell.tabs.open(u), srv.url);
    const web = await findTabPage(app, '127.0.0.1');
    await web.waitForFunction(() => document.documentElement.dataset.filoReady === '1', null, { timeout: 20000 });
    await web.locator('#ta').click({ button: 'right' });
    await web.locator('.sn-menu-paste-arrow').click();
    const sub = web.locator('.sn-menu-history-sub');
    await expect(sub.locator('.sn-menu-history-item')).toHaveCount(5);
    await sub.locator('.sn-menu-history-item').nth(0).locator('.sn-menu-history-remove').click();
    await web.waitForTimeout(1200);

    const rimaste = await page.locator('#sec-clip-list .sn-clip-item').count();
    const barrate = await page.locator('#sec-clip-list .sn-clip-gone').count();
    console.log('[D6] pagina dietro: righe', rimaste, 'barrate', barrate);
    expect(rimaste - barrate, 'la voce tolta dal menu sparisce anche dalla pagina rimasta aperta').toBe(4);
  } finally {
    srv.close();
    try { await app.close(); } catch (_) {}
    rmSync(userData, { recursive: true, force: true });
  }
});

test('D7 — cronologia vuota: la pagina lo dice e non offre niente da svuotare', async () => {
  const userData = conCronologia('g4b-vuota-', []);
  const app = await avvia(userData);
  try {
    const shell = await app.firstWindow();
    await shell.waitForLoadState('domcontentloaded');
    await shell.evaluate((u) => window.filoShell.tabs.open(u), SEC_URL);
    const page = await findTabPage(app, 'security');
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(600);
    await expect(page.locator('#sec-clip-empty')).toBeVisible();
    await expect(page.locator('#sec-clip-clear')).toBeHidden();
    await expect(page.locator('#sec-clip-search-row')).toBeHidden();
    mkdirSync(SHOTS, { recursive: true });
    await page.screenshot({ path: join(SHOTS, '256-g4-vuota.png') });
  } finally {
    try { await app.close(); } catch (_) {}
    rmSync(userData, { recursive: true, force: true });
  }
});
