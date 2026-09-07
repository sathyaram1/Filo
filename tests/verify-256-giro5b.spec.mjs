// Verifica avversariale #256, giro 5 — seconda tornata: il congelamento della
// lista sotto il puntatore, visto dalle strade meno battute.

import { test, expect } from './fixtures/electron.mjs';
import { _electron as electron } from '@playwright/test';
import { mkdtempSync, writeFileSync, readFileSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';

const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SEC_URL = 'filo://security/security.html';
const PAGE = '<!doctype html><html><body style="padding:40px"><textarea id="ta" rows="4" cols="40"></textarea></body></html>';
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

function suDisco(userData) {
  try {
    const j = JSON.parse(readFileSync(join(userData, 'storage.json'), 'utf8'));
    return (j.clipboardHistory || []).map((e) => e.text || '[img]');
  } catch (_) { return null; }
}

const voci = (n) => Array.from({ length: n }, (_, i) => ({ type: 'text', text: `voce-${i}`, ts: 1000 - i }));

async function apriSicurezza(app) {
  const shell = await app.firstWindow();
  await shell.waitForLoadState('domcontentloaded');
  await shell.evaluate((u) => window.filoShell.tabs.open(u), SEC_URL);
  const page = await findTabPage(app, 'security');
  await page.waitForLoadState('domcontentloaded');
  await page.locator('#sec-clip-list .sn-clip-item').first().waitFor({ timeout: 10000 });
  return page;
}

async function puntatoreSullaLista(page) {
  await page.locator('#sec-clip-list').scrollIntoViewIfNeeded();
  await page.waitForTimeout(200);
  const box = await page.locator('#sec-clip-list .sn-clip-item').first().boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.waitForTimeout(120);
  await page.mouse.move(box.x + box.width / 2 + 3, box.y + box.height / 2 + 1);
  await page.waitForTimeout(250);
  return page.evaluate(() => ({ hover: document.getElementById('sec-clip-list').matches(':hover') }));
}

const fotoLista = (page) => page.evaluate(() => ({
  righe: [...document.querySelectorAll('#sec-clip-list .sn-clip-item')].map((r) => ({
    t: r.querySelector('.sn-clip-text')?.textContent,
    tolta: r.classList.contains('sn-clip-gone'),
  })),
  svuota: getComputedStyle(document.getElementById('sec-clip-clear')).display,
  attesa: document.getElementById('sec-clip-pending').textContent,
  vuoto: getComputedStyle(document.getElementById('sec-clip-empty')).display,
}));

// T1 — arriva una copia nuova mentre il puntatore è sulla lista: la lista non si
// muove e una riga sotto lo dice. Poi arriva uno SVUOTAMENTO da fuori.
test('T1 — col puntatore sulla lista: copia nuova da fuori, poi svuotamento da fuori', async () => {
  const userData = conCronologia('g5b-fuori-', voci(4));
  const app = await avvia(userData);
  try {
    const page = await apriSicurezza(app);
    const hov = await puntatoreSullaLista(page);
    console.log('[T1] puntatore sulla lista:', JSON.stringify(hov));

    // Copia nuova arrivata da un'altra parte.
    await page.evaluate(async () => {
      await chrome.runtime.sendMessage({
        type: window.SN_MSG.MSG.PUSH_CLIPBOARD_ENTRY,
        entry: { type: 'text', text: 'PASSWORD-NUOVA' },
      });
    });
    await page.waitForTimeout(600);
    console.log('[T1] dopo la copia nuova:', JSON.stringify(await fotoLista(page)));

    // Svuotamento arrivato da un'altra parte (il menu «Incolla» di un'altra scheda).
    await page.evaluate(async () => {
      await chrome.runtime.sendMessage({ type: window.SN_MSG.MSG.CLEAR_CLIPBOARD_HISTORY });
    });
    await page.waitForTimeout(600);
    const dopo = await fotoLista(page);
    console.log('[T1] dopo lo svuotamento da fuori, puntatore ancora fermo:', JSON.stringify(dopo));
    console.log('[T1] su disco:', JSON.stringify(suDisco(userData)));
  } finally {
    try { await app.close(); } catch (_) {}
    rmSync(userData, { recursive: true, force: true });
  }
});

// T2 — il puntatore è sulla riga; la voce sotto il puntatore viene tolta DA
// FUORI (dal menu «Incolla» di un'altra scheda) e poi si clicca dove si era.
test('T2 — la voce sotto il puntatore sparisce da fuori: cosa colpisce il clic', async () => {
  const userData = conCronologia('g5b-sotto-', voci(6));
  const app = await avvia(userData);
  try {
    const page = await apriSicurezza(app);
    await page.locator('#sec-clip-list').scrollIntoViewIfNeeded();
    await page.waitForTimeout(200);
    // Puntatore sul «Rimuovi» della terza voce.
    const btn = page.locator('#sec-clip-list .sn-clip-item').nth(2).locator('.sn-clip-remove');
    const box = await btn.boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.waitForTimeout(300);
    // Da fuori sparisce proprio quella voce.
    await page.evaluate(async () => {
      const MSG = window.SN_MSG.MSG;
      const r = await chrome.runtime.sendMessage({ type: MSG.GET_CLIPBOARD_HISTORY });
      await chrome.runtime.sendMessage({ type: MSG.REMOVE_CLIPBOARD_ENTRY, entry: r.items[2] });
    });
    await page.waitForTimeout(600);
    console.log('[T2] dopo la sparizione da fuori:', JSON.stringify(await fotoLista(page)));
    // L'utente clicca dove stava mirando.
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await page.waitForTimeout(600);
    console.log('[T2] dopo il clic:', JSON.stringify(await fotoLista(page)));
    console.log('[T2] su disco:', JSON.stringify(suDisco(userData)));
    expect(suDisco(userData), 'il clic non ha portato via una voce che non era quella mirata')
      .toEqual(['voce-0', 'voce-1', 'voce-3', 'voce-4', 'voce-5']);
  } finally {
    try { await app.close(); } catch (_) {}
    rmSync(userData, { recursive: true, force: true });
  }
});

// T3 — la voce tolta resta barrata sotto il puntatore. Cliccarla di nuovo?
// E cliccare la ZONA COPIA di una riga barrata?
test('T3 — riga barrata: né il «Rimuovi» né la zona copia devono fare qualcosa', async () => {
  const userData = conCronologia('g5b-barrata-', voci(4));
  const app = await avvia(userData);
  try {
    const page = await apriSicurezza(app);
    await page.locator('#sec-clip-list').scrollIntoViewIfNeeded();
    await page.waitForTimeout(200);
    const riga = page.locator('#sec-clip-list .sn-clip-item').nth(1);
    await riga.locator('.sn-clip-remove').click();
    await page.waitForTimeout(500);
    console.log('[T3] dopo la rimozione:', JSON.stringify(await fotoLista(page)));
    // Riclic sul «Rimuovi» barrato e sulla zona copia della stessa riga.
    const stato = await page.evaluate(async () => {
      const r = document.querySelectorAll('#sec-clip-list .sn-clip-item')[1];
      const rm = r.querySelector('.sn-clip-remove');
      const cp = r.querySelector('.sn-clip-copy');
      const out = { rmDisabled: rm.disabled, rmTesto: rm.textContent, cpDisabled: cp.disabled, cpTitolo: cp.title };
      cp.click();
      await new Promise((x) => setTimeout(x, 400));
      out.avviso = document.getElementById('sec-clip-hint').textContent;
      return out;
    });
    console.log('[T3] riga barrata:', JSON.stringify(stato));
    console.log('[T3] su disco:', JSON.stringify(suDisco(userData)));
  } finally {
    try { await app.close(); } catch (_) {}
    rmSync(userData, { recursive: true, force: true });
  }
});

// T4 — schermate: tema chiaro e tema scuro della sezione.
test('T4 — schermate della sezione in tema chiaro e scuro', async () => {
  mkdirSync(SHOTS, { recursive: true });
  for (const tema of ['light', 'dark']) {
    const userData = mkdtempSync(join(tmpdir(), 'g5b-shot-'));
    writeFileSync(join(userData, 'storage.json'), JSON.stringify({
      clipboardHistory: [
        { type: 'text', text: 'una password copiata per sbaglio' },
        { type: 'text', text: '   \n\t  ' },
        { type: 'text', text: 'https://esempio.it/pagina-lunghissima?x=1&y=2' },
        { type: 'image', dataUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', description: 'Schermata del grafico' },
      ],
      settings: { theme: tema },
    }), 'utf8');
    const app = await avvia(userData);
    try {
      const page = await apriSicurezza(app);
      await page.locator('#sec-clip-list').scrollIntoViewIfNeeded();
      await page.waitForTimeout(700);
      const box = await page.locator('#sec-clipboard').boundingBox();
      await page.screenshot({ path: join(SHOTS, `256-g5-sicurezza-${tema}.png`), clip: box });
      // Con la conferma aperta.
      await page.locator('#sec-clip-clear').click();
      await page.waitForTimeout(500);
      await page.screenshot({ path: join(SHOTS, `256-g5-conferma-${tema}.png`) });
      console.log(`[T4] schermate ${tema} salvate`);
    } finally {
      try { await app.close(); } catch (_) {}
      rmSync(userData, { recursive: true, force: true });
    }
  }
});

// T5 — il menu «Incolla»: la voce tolta non deve tornare riaprendo il menu del
// tasto destro (non solo il sotto-menu), e lo svuotamento deve valere davvero.
test('T5 — menu «Incolla»: tolta una voce, riapro il menu del tasto destro da capo', async () => {
  const userData = conCronologia('g5b-menu-', voci(5));
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
    await web.locator('.sn-menu-history-item').nth(1).locator('.sn-menu-history-remove').click();
    await web.waitForTimeout(400);
    await web.keyboard.press('Escape');
    await web.waitForTimeout(300);

    // Menu del tasto destro riaperto DA CAPO: la cronologia si rilegge.
    await web.locator('#ta').click({ button: 'right' });
    await web.locator('.sn-menu-paste-arrow').click();
    await expect(web.locator('.sn-menu-history-sub')).toBeVisible();
    const voci2 = await web.evaluate(() => [...document.querySelectorAll('.sn-menu-history-sub .sn-menu-label')].map((s) => s.textContent));
    console.log('[T5] voci al secondo giro:', JSON.stringify(voci2));
    console.log('[T5] su disco:', JSON.stringify(suDisco(userData)));
    expect(suDisco(userData)).toEqual(['voce-0', 'voce-2', 'voce-3', 'voce-4']);

    // Adesso una voce viene incollata dalla cronologia: torna in cima?
    await web.locator('.sn-menu-history-item').last().locator('.sn-menu-history-paste').click();
    await web.waitForTimeout(700);
    console.log('[T5] su disco dopo aver incollato l\'ultima:', JSON.stringify(suDisco(userData)));
  } finally {
    server.close();
    try { await app.close(); } catch (_) {}
    rmSync(userData, { recursive: true, force: true });
  }
});
