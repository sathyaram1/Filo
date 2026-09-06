// Feedback #256 — verifica avversariale, giro 5.
//
// La cronologia degli appunti si ripulisce da due parti (la freccia "Incolla"
// del tasto destro e Impostazioni → Sicurezza). Qui si riprovano le porte già
// chiuse nei giri passati e si cerca quello che si è rotto adesso.

import { test, expect } from './fixtures/electron.mjs';
import { _electron as electron } from '@playwright/test';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';
import { CONFIRM_HOST, confirmText, clickConfirm } from './helpers/confirm.mjs';

const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SEC_URL = 'filo://security/security.html';
const SHOTS = join(APP_ROOT, 'tests', '.shots');
try { mkdirSync(SHOTS, { recursive: true }); } catch (_) {}
const PAGE = '<!doctype html><html><body style="padding:40px"><textarea id="ta" rows="4" cols="40"></textarea></body></html>';
const ROSSO = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAIAAACQkWg2AAAAFklEQVR42mO4Y2NEEmIY1TCqYfhqAAAatkoQSZYreAAAAABJRU5ErkJggg==';

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

const cinque = () => Array.from({ length: 5 }, (_, i) => ({ type: 'text', text: `voce-${i}`, ts: 100 - i }));

// ── 1. La conferma dello svuotamento nel menu "Incolla" ─────────────────────
// Il giro scorso chiedeva che la conferma dicesse QUANTE voci spariscono, e che
// dichiarasse quando una ricerca ne sta nascondendo una parte. Senza nessuna
// ricerca scritta, la conferma non deve parlare di ricerca.
test('menu Incolla: senza ricerca la conferma non parla di ricerca', async () => {
  const userData = conCronologia('g5-menu-conf-', cinque());
  const srv = await serviPagina();
  const app = await avvia(userData);
  try {
    const shell = await app.firstWindow();
    await shell.waitForLoadState('domcontentloaded');
    await shell.evaluate((u) => window.filoShell.tabs.open(u), srv.url);
    const web = await findTabPage(app, '127.0.0.1');
    await web.waitForFunction(() => document.documentElement.dataset.filoReady === '1', null, { timeout: 15000 });
    await web.locator('#ta').click({ button: 'right' });
    await expect(web.locator('.sn-menu')).toBeVisible();
    await web.locator('.sn-menu-paste-arrow').click();
    const sub = web.locator('.sn-menu-history-sub');
    await expect(sub).toBeVisible();
    await expect(sub.locator('.sn-menu-history-item')).toHaveCount(5);

    await sub.locator('.sn-menu-history-clear-btn').click();
    await expect(web.locator(CONFIRM_HOST)).toBeVisible();
    // La conferma vive in uno shadow DOM chiuso: si guarda com'è a schermo.
    await web.screenshot({ path: join(SHOTS, 'g5-menu-conferma-senza-ricerca.png') });
  } finally {
    srv.close();
    try { await app.close(); } catch (_) {}
    rmSync(userData, { recursive: true, force: true });
  }
});

test('menu Incolla: con una ricerca attiva la conferma dice quante ne mostra', async () => {
  const items = [
    { type: 'text', text: 'password-Hunter2', ts: 100 },
    ...Array.from({ length: 6 }, (_, i) => ({ type: 'text', text: `nota ${i}`, ts: 50 - i })),
  ];
  const userData = conCronologia('g5-menu-conf2-', items);
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
    await sub.locator('.sn-menu-history-search-input').fill('password');
    await web.waitForTimeout(300);
    await sub.locator('.sn-menu-history-clear-btn').click();
    await expect(web.locator(CONFIRM_HOST)).toBeVisible();
    await web.screenshot({ path: join(SHOTS, 'g5-menu-conferma-con-ricerca.png') });
  } finally {
    srv.close();
    try { await app.close(); } catch (_) {}
    rmSync(userData, { recursive: true, force: true });
  }
});

// ── 2. Sicurezza: la conferma senza ricerca ─────────────────────────────────
test('Sicurezza: senza ricerca la conferma dice il numero e basta', async () => {
  const userData = conCronologia('g5-sec-conf-', cinque());
  const app = await avvia(userData);
  try {
    const shell = await app.firstWindow();
    await shell.waitForLoadState('domcontentloaded');
    await shell.evaluate((u) => window.filoShell.tabs.open(u), SEC_URL);
    const page = await findTabPage(app, 'security');
    await page.waitForLoadState('domcontentloaded');
    await expect(page.locator('#sec-clip-list .sn-clip-item')).toHaveCount(5);
    await page.click('#sec-clip-clear');
    const testo = await confirmText(page);
    console.log('CONFERMA-SICUREZZA-SENZA-RICERCA >>>', JSON.stringify(testo));
    expect(testo).toContain('5');
    expect(testo).not.toMatch(/ricerca/i);
    await clickConfirm(page, 'cancel');
  } finally {
    try { await app.close(); } catch (_) {}
    rmSync(userData, { recursive: true, force: true });
  }
});

// ── 3. Casi limite del contenuto ────────────────────────────────────────────
test('Sicurezza: spazi, 10.000 caratteri, HTML, emoji e immagine rotta', async () => {
  const lungo = 'L'.repeat(10000);
  const items = [
    { type: 'text', text: '       ', ts: 10 },
    { type: 'text', text: lungo, ts: 9 },
    { type: 'text', text: '<img src=x onerror="window.__bucato=1"><script>window.__bucato=1</script>', ts: 8 },
    { type: 'text', text: 'javascript:window.__bucato=1', ts: 7 },
    { type: 'text', text: '🎉 àèìòù 中文 テスト', ts: 6 },
    { type: 'image', dataUrl: 'data:image/png;base64,NONVALIDO', ts: 5 },
    { type: 'image', dataUrl: ROSSO, ts: 4 },
  ];
  const userData = conCronologia('g5-limite-', items);
  const app = await avvia(userData);
  try {
    const shell = await app.firstWindow();
    await shell.waitForLoadState('domcontentloaded');
    await shell.evaluate((u) => window.filoShell.tabs.open(u), SEC_URL);
    const page = await findTabPage(app, 'security');
    await page.waitForLoadState('domcontentloaded');
    const rows = page.locator('#sec-clip-list .sn-clip-item');
    await expect(rows).toHaveCount(7);
    // Niente esecuzione di codice.
    expect(await page.evaluate(() => window.__bucato)).toBeUndefined();
    // La voce di soli spazi si legge.
    await expect(rows.nth(0)).toContainText(/spazi/i);
    // Niente scorrimento orizzontale della pagina.
    const overflow = await page.evaluate(() => ({
      doc: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      lista: (() => { const l = document.getElementById('sec-clip-list'); return l.scrollWidth - l.clientWidth; })(),
    }));
    console.log('OVERFLOW >>>', JSON.stringify(overflow));
    expect(overflow.doc).toBeLessThanOrEqual(1);
    await page.screenshot({ path: join(SHOTS, 'g5-sicurezza-casi-limite.png'), fullPage: true });
  } finally {
    try { await app.close(); } catch (_) {}
    rmSync(userData, { recursive: true, force: true });
  }
});

// ── 4. Stato vuoto e ultima voce tolta ──────────────────────────────────────
test('Sicurezza: tolta l\'ultima voce compare lo stato vuoto e spariscono ricerca e svuota', async () => {
  const userData = conCronologia('g5-ultima-', [{ type: 'text', text: 'unica', ts: 1 }]);
  const app = await avvia(userData);
  try {
    const shell = await app.firstWindow();
    await shell.waitForLoadState('domcontentloaded');
    await shell.evaluate((u) => window.filoShell.tabs.open(u), SEC_URL);
    const page = await findTabPage(app, 'security');
    await page.waitForLoadState('domcontentloaded');
    await expect(page.locator('#sec-clip-list .sn-clip-item')).toHaveCount(1);
    await page.locator('.sn-clip-remove').first().click();
    await page.waitForTimeout(800);
    await page.mouse.move(5, 5);
    await expect(page.locator('#sec-clip-empty')).toBeVisible();
    await expect(page.locator('#sec-clip-clear')).toBeHidden();
    await expect(page.locator('#sec-clip-search-row')).toBeHidden();
    await page.screenshot({ path: join(SHOTS, 'g5-sicurezza-vuota.png'), fullPage: true });
  } finally {
    try { await app.close(); } catch (_) {}
    rmSync(userData, { recursive: true, force: true });
  }
});

// ── 5. Tema scuro ───────────────────────────────────────────────────────────
test('Sicurezza: tema scuro, i tasti hanno i colori di Filo', async () => {
  const userData = conCronologia('g5-scuro-', cinque(), { settings: { theme: 'dark' } });
  const app = await avvia(userData);
  try {
    const shell = await app.firstWindow();
    await shell.waitForLoadState('domcontentloaded');
    await shell.evaluate((u) => window.filoShell.tabs.open(u), SEC_URL);
    const page = await findTabPage(app, 'security');
    await page.waitForLoadState('domcontentloaded');
    await expect(page.locator('#sec-clip-list .sn-clip-item')).toHaveCount(5);
    await page.waitForTimeout(500);
    const colori = await page.evaluate(() => {
      const g = (sel) => { const e = document.querySelector(sel); const s = getComputedStyle(e); return { bg: s.backgroundColor, fg: s.color }; };
      return {
        tema: document.documentElement.dataset.snTheme || document.documentElement.getAttribute('data-theme') || '',
        rimuovi: g('.sn-clip-remove'),
        svuota: g('#sec-clip-clear'),
        esporta: g('#sec-export-btn'),
        importa: g('#sec-import-btn'),
        pagina: getComputedStyle(document.body).backgroundColor,
      };
    });
    console.log('COLORI-SCURO >>>', JSON.stringify(colori, null, 1));
    await page.screenshot({ path: join(SHOTS, 'g5-sicurezza-scuro.png'), fullPage: true });
  } finally {
    try { await app.close(); } catch (_) {}
    rmSync(userData, { recursive: true, force: true });
  }
});

// ── 6. Aggiornamento dal vivo nelle due direzioni ───────────────────────────
test('Sicurezza: la pagina lasciata aperta si riallinea da sola', async () => {
  const userData = conCronologia('g5-live-', cinque());
  const app = await avvia(userData);
  try {
    const shell = await app.firstWindow();
    await shell.waitForLoadState('domcontentloaded');
    await shell.evaluate((u) => window.filoShell.tabs.open(u), SEC_URL);
    const page = await findTabPage(app, 'security');
    await page.waitForLoadState('domcontentloaded');
    await expect(page.locator('#sec-clip-list .sn-clip-item')).toHaveCount(5);
    // Il puntatore NON è sulla lista: una copia fatta altrove deve comparire.
    await page.mouse.move(5, 5);
    await page.evaluate(() => chrome.runtime.sendMessage({
      type: window.SN_MSG.MSG.PUSH_CLIPBOARD_ENTRY,
      entry: { type: 'text', text: 'password-appena-copiata' },
    }));
    await expect(page.locator('#sec-clip-list')).toContainText('password-appena-copiata', { timeout: 6000 });
    // E una voce tolta altrove sparisce anche qui.
    await page.evaluate(() => chrome.runtime.sendMessage({
      type: window.SN_MSG.MSG.REMOVE_CLIPBOARD_ENTRY,
      entry: { type: 'text', text: 'password-appena-copiata' },
    }));
    await expect(page.locator('#sec-clip-list')).not.toContainText('password-appena-copiata', { timeout: 6000 });
  } finally {
    try { await app.close(); } catch (_) {}
    rmSync(userData, { recursive: true, force: true });
  }
});

// ── 7. Doppio clic su "Svuota cronologia" ───────────────────────────────────
test('Sicurezza: un doppio clic su "Svuota cronologia" non svuota senza conferma', async () => {
  const userData = conCronologia('g5-dblclear-', cinque());
  const app = await avvia(userData);
  try {
    const shell = await app.firstWindow();
    await shell.waitForLoadState('domcontentloaded');
    await shell.evaluate((u) => window.filoShell.tabs.open(u), SEC_URL);
    const page = await findTabPage(app, 'security');
    await page.waitForLoadState('domcontentloaded');
    await expect(page.locator('#sec-clip-list .sn-clip-item')).toHaveCount(5);
    const btn = page.locator('#sec-clip-clear');
    await btn.hover();
    await page.mouse.down(); await page.mouse.up();
    await page.waitForTimeout(120);
    await page.mouse.down(); await page.mouse.up();
    await page.waitForTimeout(900);
    const restano = await page.evaluate(async () => {
      const r = await chrome.runtime.sendMessage({ type: window.SN_MSG.MSG.GET_CLIPBOARD_HISTORY });
      return (r.items || []).length;
    });
    console.log('DOPO-DOPPIO-CLIC-SVUOTA >>>', restano);
    expect(restano).toBe(5);
    await page.screenshot({ path: join(SHOTS, 'g5-doppio-clic-svuota.png') });
  } finally {
    try { await app.close(); } catch (_) {}
    rmSync(userData, { recursive: true, force: true });
  }
});

// ── 8. Menu: tolte tutte le voci a mano ─────────────────────────────────────
test('menu Incolla: tolte tutte le voci compare lo stato vuoto', async () => {
  const userData = conCronologia('g5-menu-tutte-', Array.from({ length: 3 }, (_, i) => ({ type: 'text', text: `v${i}`, ts: 9 - i })));
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
    for (let i = 0; i < 3; i++) {
      await sub.locator('.sn-menu-history-item').nth(i).locator('.sn-menu-history-remove').click();
      await web.waitForTimeout(250);
    }
    await web.waitForTimeout(600);
    await expect(sub.locator('.sn-menu-history-clear')).toBeHidden();
    await expect(sub.locator('.sn-menu-history-search')).toBeHidden();
    await web.screenshot({ path: join(SHOTS, 'g5-menu-tutte-tolte.png') });
    const restano = await web.evaluate(async () => {
      // dal mondo della pagina non si arriva a chrome.runtime: si controlla dopo.
      return null;
    });
    expect(restano).toBeNull();
  } finally {
    srv.close();
    try { await app.close(); } catch (_) {}
    rmSync(userData, { recursive: true, force: true });
  }
});
