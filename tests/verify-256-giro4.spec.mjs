// Verifica avversariale #256, giro 4. Cronologia appunti: togliere una voce e
// svuotare, dalle due strade (freccia «Incolla» del tasto destro e Impostazioni
// → Sicurezza). Qui si prova a ROMPERE quello che i giri passati hanno chiuso.

import { test, expect } from './fixtures/electron.mjs';
import { _electron as electron } from '@playwright/test';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';
import { confirmText, clickConfirm, CONFIRM_HOST } from './helpers/confirm.mjs';

const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SEC_URL = 'filo://security/security.html';
const PAGE = '<!doctype html><html><body style="padding:40px"><textarea id="ta" rows="4" cols="40"></textarea><p id="p">testo qualunque da copiare</p></body></html>';
const SHOTS = join(APP_ROOT, 'tests', '.shots');

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

const voci = (n) => Array.from({ length: n }, (_, i) => ({ type: 'text', text: `voce-${i}`, ts: 100 - i }));

// Il dialogo di conferma del content script vive nel mondo isolato del preload:
// dalla pagina non si legge. Ci si arriva dal main.
async function confermaNelMondoIsolato(app, hostname) {
  return app.evaluate(async ({ webContents }, host) => {
    const wc = webContents.getAllWebContents().find((c) => {
      try { return new URL(c.getURL()).hostname === host; } catch (_) { return false; }
    });
    if (!wc) return { errore: 'nessun webContents' };
    try {
      return await wc.executeJavaScriptInIsolatedWorld(999, [{
        code: '(() => { try { const s = window.SN_CONFIRM_UI && window.SN_CONFIRM_UI._test.state(); return s ? { title: s.title, text: s.text } : null; } catch (e) { return { errore: String(e) }; } })()',
      }]);
    } catch (e) { return { errore: String(e) }; }
  }, hostname);
}

async function cliccaConfermaIsolata(app, hostname, quale) {
  return app.evaluate(async ({ webContents }, [host, w]) => {
    const wc = webContents.getAllWebContents().find((c) => {
      try { return new URL(c.getURL()).hostname === host; } catch (_) { return false; }
    });
    if (!wc) return false;
    return wc.executeJavaScriptInIsolatedWorld(999, [{
      code: `(() => { try { return window.SN_CONFIRM_UI._test.click(${JSON.stringify(w)}); } catch (e) { return false; } })()`,
    }]);
  }, [hostname, quale]);
}

// ── A. La strada della pagina Sicurezza ────────────────────────────────────

test('A1 — tolte tutte le voci col mouse fermo sulla lista, «Svuota cronologia» non offre di svuotare zero voci', async () => {
  const userData = conCronologia('g4-zero-', voci(3));
  const app = await avvia(userData);
  try {
    const shell = await app.firstWindow();
    await shell.waitForLoadState('domcontentloaded');
    await shell.evaluate((u) => window.filoShell.tabs.open(u), SEC_URL);
    const page = await findTabPage(app, 'security');
    await page.waitForLoadState('domcontentloaded');
    await expect(page.locator('#sec-clip-list .sn-clip-item')).toHaveCount(3);

    // Il puntatore entra nella lista e NON esce più: è il caso che il giro
    // scorso ha introdotto (la lista non si muove sotto la mano).
    const righe = page.locator('#sec-clip-list .sn-clip-item');
    for (let i = 0; i < 3; i++) {
      await righe.nth(i).locator('.sn-clip-remove').click();
      await page.waitForTimeout(250);
    }
    await expect(page.locator('#sec-clip-list .sn-clip-gone')).toHaveCount(3);

    const clearVisibile = await page.locator('#sec-clip-clear').isVisible();
    console.log('[A1] «Svuota cronologia» ancora visibile a cronologia vuota:', clearVisibile);
    if (clearVisibile) {
      await page.click('#sec-clip-clear');
      const testo = await confirmText(page);
      console.log('[A1] testo della conferma:', JSON.stringify(testo));
      await clickConfirm(page, 'cancel');
      expect(testo, 'la conferma non deve offrire di far sparire 0 voci').not.toMatch(/\b0\b/);
    }
  } finally {
    try { await app.close(); } catch (_) {}
    rmSync(userData, { recursive: true, force: true });
  }
});

test('A2 — cliccando una riga la voce torna DAVVERO negli appunti di sistema', async () => {
  const userData = conCronologia('g4-copia-', [
    { type: 'text', text: 'PAROLA-SEGRETA-42', ts: 100 },
    { type: 'text', text: 'altra cosa', ts: 99 },
  ]);
  const app = await avvia(userData);
  try {
    await app.evaluate(({ clipboard }) => clipboard.writeText('PRIMA'));
    const shell = await app.firstWindow();
    await shell.waitForLoadState('domcontentloaded');
    await shell.evaluate((u) => window.filoShell.tabs.open(u), SEC_URL);
    const page = await findTabPage(app, 'security');
    await page.waitForLoadState('domcontentloaded');
    await expect(page.locator('#sec-clip-list .sn-clip-item')).toHaveCount(2);
    await page.locator('#sec-clip-list .sn-clip-item').first().locator('.sn-clip-copy').click();
    await page.waitForTimeout(600);
    const hint = await page.locator('#sec-clip-hint').textContent();
    const negliAppunti = await app.evaluate(({ clipboard }) => clipboard.readText());
    console.log('[A2] avviso:', JSON.stringify(hint), '| appunti:', JSON.stringify(negliAppunti));
    expect(negliAppunti, 'la voce cliccata deve essere davvero negli appunti').toBe('PAROLA-SEGRETA-42');
  } finally {
    try { await app.close(); } catch (_) {}
    rmSync(userData, { recursive: true, force: true });
  }
});

test('A3 — la ricerca che non trova niente non fa sparire il tasto per svuotare, e la conferma resta onesta', async () => {
  const userData = conCronologia('g4-ricerca-', voci(6));
  const app = await avvia(userData);
  try {
    const shell = await app.firstWindow();
    await shell.waitForLoadState('domcontentloaded');
    await shell.evaluate((u) => window.filoShell.tabs.open(u), SEC_URL);
    const page = await findTabPage(app, 'security');
    await page.waitForLoadState('domcontentloaded');
    await page.fill('#sec-clip-search', 'zzzz-non-esiste');
    await expect(page.locator('#sec-clip-noresults')).toBeVisible();
    await page.click('#sec-clip-clear');
    const testo = await confirmText(page);
    console.log('[A3] conferma con ricerca senza risultati:', JSON.stringify(testo));
    await clickConfirm(page, 'cancel');
    expect(testo).toContain('6');
    expect(testo, 'una ricerca che non mostra niente va dichiarata').toMatch(/ricerca/i);
  } finally {
    try { await app.close(); } catch (_) {}
    rmSync(userData, { recursive: true, force: true });
  }
});

test('A4 — voci limite: 10.000 caratteri, soli spazi, emoji, HTML e javascript: restano testo', async () => {
  const lungo = 'L'.repeat(10000);
  const userData = conCronologia('g4-limite-', [
    { type: 'text', text: lungo, ts: 10 },
    { type: 'text', text: '   \n\t  ', ts: 9 },
    { type: 'text', text: '🙂 àèìòù 中文', ts: 8 },
    { type: 'text', text: '<script>window.__bucato = 1;</script><img src=x onerror="window.__bucato=2">', ts: 7 },
    { type: 'text', text: 'javascript:alert(1)', ts: 6 },
  ]);
  const app = await avvia(userData);
  try {
    const shell = await app.firstWindow();
    await shell.waitForLoadState('domcontentloaded');
    await shell.evaluate((u) => window.filoShell.tabs.open(u), SEC_URL);
    const page = await findTabPage(app, 'security');
    await page.waitForLoadState('domcontentloaded');
    await expect(page.locator('#sec-clip-list .sn-clip-item')).toHaveCount(5);
    expect(await page.evaluate(() => window.__bucato)).toBeUndefined();
    expect(await page.evaluate(() => document.querySelectorAll('#sec-clip-list script, #sec-clip-list img[src="x"]').length)).toBe(0);
    // La voce di soli spazi si legge invece di essere una riga muta.
    await expect(page.locator('#sec-clip-list .sn-clip-item').nth(1)).toContainText(/spazi/i);
    // Niente scorrimento orizzontale della pagina per via della voce lunga.
    const sborda = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
    expect(sborda, 'una voce lunghissima non deve far scorrere la pagina di lato').toBe(false);
    mkdirSync(SHOTS, { recursive: true });
    await page.screenshot({ path: join(SHOTS, '256-g4-limite.png'), fullPage: false });
  } finally {
    try { await app.close(); } catch (_) {}
    rmSync(userData, { recursive: true, force: true });
  }
});

// ── B. La strada del menu «Incolla» ────────────────────────────────────────

test('B1 — menu «Incolla»: la conferma dello svuotamento senza ricerca non parla di ricerca', async () => {
  const userData = conCronologia('g4-menu-conf-', voci(5));
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
    await expect(sub).toBeVisible();
    await expect(sub.locator('.sn-menu-history-item')).toHaveCount(5);
    await sub.locator('.sn-menu-history-clear-btn').click();
    await expect(web.locator(CONFIRM_HOST)).toBeVisible();
    const stato = await confermaNelMondoIsolato(app, '127.0.0.1');
    console.log('[B1] conferma del menu senza ricerca:', JSON.stringify(stato));
    expect(stato && typeof stato.text === 'string', 'il testo della conferma dev\'essere leggibile dal mondo isolato').toBe(true);
    expect(stato.text).toContain('5');
    expect(stato.text, 'nessuna ricerca scritta: della ricerca non si parla').not.toMatch(/ricerca/i);
    await cliccaConfermaIsolata(app, '127.0.0.1', 'cancel');
  } finally {
    srv.close();
    try { await app.close(); } catch (_) {}
    rmSync(userData, { recursive: true, force: true });
  }
});

test('B2 — menu «Incolla»: con una ricerca in corso la conferma dichiara quante ne mostra, e dopo una rimozione il conto resta giusto', async () => {
  const items = [
    { type: 'text', text: 'password-Hunter2', ts: 100 },
    ...Array.from({ length: 5 }, (_, i) => ({ type: 'text', text: `nota ${i}`, ts: 50 - i })),
  ];
  const userData = conCronologia('g4-menu-filtro-', items);
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
    await sub.locator('.sn-menu-history-search-input').fill('password');
    await expect(sub.locator('.sn-menu-history-item:visible')).toHaveCount(1);
    await sub.locator('.sn-menu-history-clear-btn').click();
    const stato = await confermaNelMondoIsolato(app, '127.0.0.1');
    console.log('[B2] conferma con filtro:', JSON.stringify(stato));
    expect(stato.text).toContain('6');
    expect(stato.text).toMatch(/ricerca/i);
    expect(stato.text).toMatch(/\b1\b/);
    await cliccaConfermaIsolata(app, '127.0.0.1', 'cancel');

    // Ricerca tolta: la frase sulla ricerca se ne va con lei.
    await sub.locator('.sn-menu-history-search-input').fill('');
    await expect(sub.locator('.sn-menu-history-item:visible')).toHaveCount(6);
    await sub.locator('.sn-menu-history-clear-btn').click();
    const stato2 = await confermaNelMondoIsolato(app, '127.0.0.1');
    console.log('[B2] conferma senza filtro:', JSON.stringify(stato2));
    expect(stato2.text).not.toMatch(/ricerca/i);
    await cliccaConfermaIsolata(app, '127.0.0.1', 'cancel');

    // Tolta una voce a mano, il totale della conferma scende.
    await sub.locator('.sn-menu-history-item').nth(2).locator('.sn-menu-history-remove').click();
    await web.waitForTimeout(300);
    await sub.locator('.sn-menu-history-clear-btn').click();
    const stato3 = await confermaNelMondoIsolato(app, '127.0.0.1');
    console.log('[B2] conferma dopo una rimozione:', JSON.stringify(stato3));
    expect(stato3.text, 'la conferma deve contare le voci rimaste, non quelle di partenza').toContain('5');
    expect(stato3.text).not.toMatch(/ricerca/i);
    await cliccaConfermaIsolata(app, '127.0.0.1', 'cancel');
  } finally {
    srv.close();
    try { await app.close(); } catch (_) {}
    rmSync(userData, { recursive: true, force: true });
  }
});

test('B3 — menu «Incolla»: doppio clic sulla × porta via UNA voce sola', async () => {
  const userData = conCronologia('g4-menu-dblclick-', voci(6));
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
    await sub.locator('.sn-menu-history-item').nth(2).locator('.sn-menu-history-remove').dblclick();
    await web.waitForTimeout(500);
    const rimaste = await web.evaluate(async () => {
      const r = await new Promise((res) => {
        // La pagina non ha chrome.runtime: si chiede al menu quante righe vive restano.
        res(null);
      });
      return r;
    });
    const vive = await sub.locator('.sn-menu-history-item:not(.sn-menu-history-gone)').count();
    console.log('[B3] righe vive dopo il doppio clic:', vive, rimaste);
    expect(vive, 'un doppio clic non deve portare via due voci').toBe(5);

    // E sul disco: riaperto il menu ne restano cinque, e voce-3 c\'è ancora.
    await web.keyboard.press('Escape');
    await web.locator('#ta').click({ button: 'right' });
    await web.locator('.sn-menu-paste-arrow').click();
    const sub2 = web.locator('.sn-menu-history-sub');
    await expect(sub2.locator('.sn-menu-history-item')).toHaveCount(5);
    await expect(sub2).toContainText('voce-3');
  } finally {
    srv.close();
    try { await app.close(); } catch (_) {}
    rmSync(userData, { recursive: true, force: true });
  }
});

test('B4 — menu «Incolla»: incollare una voce ancora funziona, e una voce tolta non si incolla più', async () => {
  const userData = conCronologia('g4-menu-incolla-', voci(4));
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
    await expect(sub.locator('.sn-menu-history-item')).toHaveCount(4);
    // Tolgo la voce 1, poi provo a incollare la riga barrata: non deve incollare.
    await sub.locator('.sn-menu-history-item').nth(1).locator('.sn-menu-history-remove').click();
    await web.waitForTimeout(200);
    await sub.locator('.sn-menu-history-item').nth(1).locator('.sn-menu-history-paste').click({ force: true });
    await web.waitForTimeout(400);
    const dopoTolta = await web.locator('#ta').inputValue();
    console.log('[B4] campo dopo il clic sulla riga barrata:', JSON.stringify(dopoTolta));
    expect(dopoTolta, 'una voce già tolta non si incolla').toBe('');

    // Una voce viva invece si incolla.
    await web.locator('#ta').click({ button: 'right' });
    await web.locator('.sn-menu-paste-arrow').click();
    const sub2 = web.locator('.sn-menu-history-sub');
    await expect(sub2.locator('.sn-menu-history-item')).toHaveCount(3);
    await sub2.locator('.sn-menu-history-item').nth(0).locator('.sn-menu-history-paste').click();
    await web.waitForTimeout(600);
    const dopo = await web.locator('#ta').inputValue();
    console.log('[B4] campo dopo il clic su una voce viva:', JSON.stringify(dopo));
    expect(dopo).toContain('voce-0');
  } finally {
    srv.close();
    try { await app.close(); } catch (_) {}
    rmSync(userData, { recursive: true, force: true });
  }
});

// ── C. Le due viste devono restare d'accordo ───────────────────────────────

test('C1 — la pagina lasciata aperta si riallinea quando la cronologia cambia altrove, nelle due direzioni', async () => {
  const userData = conCronologia('g4-live-', voci(3));
  const srv = await serviPagina();
  const app = await avvia(userData);
  try {
    const shell = await app.firstWindow();
    await shell.waitForLoadState('domcontentloaded');
    await shell.evaluate((u) => window.filoShell.tabs.open(u), SEC_URL);
    const page = await findTabPage(app, 'security');
    await page.waitForLoadState('domcontentloaded');
    await expect(page.locator('#sec-clip-list .sn-clip-item')).toHaveCount(3);

    // Un'altra scheda copia qualcosa: la pagina aperta lo mostra da sola.
    await shell.evaluate((u) => window.filoShell.tabs.open(u), srv.url);
    const web = await findTabPage(app, '127.0.0.1');
    await web.waitForFunction(() => document.documentElement.dataset.filoReady === '1', null, { timeout: 20000 });
    await web.evaluate(() => {
      const r = document.createRange();
      r.selectNodeContents(document.getElementById('p'));
      const s = window.getSelection(); s.removeAllRanges(); s.addRange(r);
    });
    await web.locator('#p').click({ button: 'right' });
    const copia = web.locator('.sn-menu-item', { hasText: /^Copia$/ }).first();
    if (await copia.count()) {
      await copia.click();
    } else {
      await web.keyboard.press('Escape');
      await web.evaluate(() => document.execCommand('copy'));
    }
    await page.waitForTimeout(1500);
    const conteggio = await page.locator('#sec-clip-list .sn-clip-item').count();
    console.log('[C1] righe nella pagina dopo la copia altrove:', conteggio);
    expect(conteggio, 'la pagina lasciata aperta deve mostrare la copia appena fatta').toBeGreaterThan(3);
  } finally {
    srv.close();
    try { await app.close(); } catch (_) {}
    rmSync(userData, { recursive: true, force: true });
  }
});

test('C2 — tema scuro: i tasti della cronologia hanno i colori di Filo, non quelli di serie', async () => {
  const userData = conCronologia('g4-scuro-', voci(4));
  writeFileSync(join(userData, 'storage.json'), JSON.stringify({
    clipboardHistory: voci(4),
    settings: { theme: 'dark' },
  }), 'utf8');
  const app = await avvia(userData);
  try {
    const shell = await app.firstWindow();
    await shell.waitForLoadState('domcontentloaded');
    await shell.evaluate((u) => window.filoShell.tabs.open(u), SEC_URL);
    const page = await findTabPage(app, 'security');
    await page.waitForLoadState('domcontentloaded');
    await expect(page.locator('#sec-clip-list .sn-clip-item')).toHaveCount(4);
    await page.waitForTimeout(500);
    const colori = await page.evaluate(() => {
      const leggi = (el) => {
        if (!el) return null;
        const s = getComputedStyle(el);
        return { bg: s.backgroundColor, fg: s.color, bordo: s.borderTopColor };
      };
      return {
        tema: document.documentElement.dataset.snTheme || document.documentElement.getAttribute('data-theme') || '',
        rimuovi: leggi(document.querySelector('.sn-clip-remove')),
        svuota: leggi(document.getElementById('sec-clip-clear')),
        esporta: leggi(document.getElementById('sec-export-btn')),
        importa: leggi(document.getElementById('sec-import-btn')),
        corpo: leggi(document.body),
      };
    });
    console.log('[C2] colori in tema scuro:', JSON.stringify(colori, null, 2));
    mkdirSync(SHOTS, { recursive: true });
    await page.screenshot({ path: join(SHOTS, '256-g4-scuro.png'), fullPage: false });
    for (const nome of ['rimuovi', 'svuota', 'esporta', 'importa']) {
      const c = colori[nome];
      expect(c, `${nome} presente`).toBeTruthy();
      expect(c.bg, `${nome} non deve avere il fondo bianco di serie del browser`).not.toBe('rgb(255, 255, 255)');
    }
  } finally {
    try { await app.close(); } catch (_) {}
    rmSync(userData, { recursive: true, force: true });
  }
});
