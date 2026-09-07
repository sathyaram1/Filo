// Verifica avversariale #256, giro 5. Cronologia appunti: togliere una voce e
// svuotare, dalle due strade (freccia «Incolla» del tasto destro e Impostazioni
// → Sicurezza). Qui si riprovano le porte chiuse nei giri 1-4 e se ne cercano
// di nuove.

import { test, expect } from './fixtures/electron.mjs';
import { _electron as electron } from '@playwright/test';
import { mkdtempSync, writeFileSync, readFileSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';
import { confirmText, clickConfirm, CONFIRM_HOST } from './helpers/confirm.mjs';

const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SEC_URL = 'filo://security/security.html';
const PAGE = '<!doctype html><html><body style="padding:40px"><textarea id="ta" rows="4" cols="40"></textarea><p id="p">testo qualunque</p></body></html>';
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

// Porta il puntatore FISICAMENTE dentro la lista e ce lo lascia (senza premere).
async function puntatoreSullaLista(page) {
  const box = await page.locator('#sec-clip-list').boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + Math.min(20, box.height / 2));
  await page.waitForTimeout(150);
}

const etichette = (page) => page.evaluate(() => [...document.querySelectorAll('#sec-clip-list .sn-clip-item')]
  .map((r) => ({
    testo: r.querySelector('.sn-clip-text')?.textContent,
    tolta: r.classList.contains('sn-clip-gone'),
    nascosta: r.style.display === 'none',
  })));

const statoFuoco = (page) => page.evaluate(() => {
  const a = document.activeElement;
  if (!a) return { tag: 'null' };
  return {
    tag: a.tagName,
    classe: a.className,
    dentroLista: !!a.closest('#sec-clip-list'),
    id: a.id || '',
    riga: a.closest('.sn-clip-item')?.querySelector('.sn-clip-text')?.textContent || '',
  };
});

// ── S1 — porta del giro 4: rimozione da TASTIERA col puntatore fermo sulla lista
test('S1 — Sicurezza: Invio sul «Rimuovi» col mouse fermo sulla lista non butta il fuoco fuori', async () => {
  const userData = conCronologia('g5-tastiera-', voci(6));
  const app = await avvia(userData);
  try {
    const page = await apriSicurezza(app);
    await puntatoreSullaLista(page);

    // Fuoco sul "Rimuovi" della terza voce, senza toccare il mouse.
    await page.evaluate(() => {
      const righe = [...document.querySelectorAll('#sec-clip-list .sn-clip-item')];
      righe[2].querySelector('.sn-clip-remove').focus();
    });
    const prima = await statoFuoco(page);
    await page.keyboard.press('Enter');
    await page.waitForTimeout(600);
    const dopo = await statoFuoco(page);
    const righe = await etichette(page);
    console.log('[S1] fuoco prima:', JSON.stringify(prima));
    console.log('[S1] fuoco dopo :', JSON.stringify(dopo));
    console.log('[S1] righe      :', JSON.stringify(righe));
    console.log('[S1] su disco   :', JSON.stringify(suDisco(userData)));

    expect(righe.filter((r) => r.tolta).length, 'una voce sola tolta').toBe(1);
    expect(dopo.dentroLista, 'il fuoco resta nella lista, pronto per la voce dopo').toBe(true);

    // Seconda rimozione di fila, sempre da tastiera e col mouse fermo.
    await page.keyboard.press('Enter');
    await page.waitForTimeout(600);
    const dopo2 = await statoFuoco(page);
    const righe2 = await etichette(page);
    console.log('[S1] fuoco dopo 2:', JSON.stringify(dopo2));
    console.log('[S1] righe 2     :', JSON.stringify(righe2));
    console.log('[S1] su disco 2  :', JSON.stringify(suDisco(userData)));
    expect(righe2.filter((r) => r.tolta).length, 'due voci tolte in tutto').toBe(2);
    expect(dopo2.dentroLista, 'il fuoco resta nella lista anche alla seconda').toBe(true);
  } finally {
    try { await app.close(); } catch (_) {}
    rmSync(userData, { recursive: true, force: true });
  }
});

// ── S2 — porta del giro 4: tolte tutte col mouse senza uscire dalla lista
test('S2 — Sicurezza: tolte tutte le voci col mouse senza uscire, «Svuota cronologia» sparisce', async () => {
  const userData = conCronologia('g5-zero-', voci(3));
  const app = await avvia(userData);
  try {
    const page = await apriSicurezza(app);
    for (let i = 0; i < 3; i++) {
      await page.locator('#sec-clip-list .sn-clip-item:not(.sn-clip-gone) .sn-clip-remove').first().click();
      await page.waitForTimeout(400);
    }
    const stato = await page.evaluate(() => ({
      svuota: getComputedStyle(document.getElementById('sec-clip-clear')).display,
      ricerca: getComputedStyle(document.getElementById('sec-clip-search-row')).display,
      righeTolte: [...document.querySelectorAll('#sec-clip-list .sn-clip-item')].map((r) => r.classList.contains('sn-clip-gone')),
    }));
    console.log('[S2] stato dopo aver tolto tutto senza uscire:', JSON.stringify(stato));
    console.log('[S2] su disco:', JSON.stringify(suDisco(userData)));
    expect(stato.svuota, '«Svuota cronologia» non offre di far sparire zero voci').toBe('none');

    // E se lo si raggiunge lo stesso (via tastiera/programmaticamente)?
    const conferma = await page.evaluate(async () => {
      document.getElementById('sec-clip-clear').click();
      await new Promise((r) => setTimeout(r, 400));
      const s = window.SN_CONFIRM_UI && window.SN_CONFIRM_UI._test.state();
      return s ? `${s.title}\n${s.text}` : 'nessun dialogo';
    });
    console.log('[S2] conferma raggiungendo il tasto nascosto:', JSON.stringify(conferma));
    expect(conferma, 'nessuna frase «tutte e 0 le voci»').not.toContain(' 0 ');
  } finally {
    try { await app.close(); } catch (_) {}
    rmSync(userData, { recursive: true, force: true });
  }
});

// ── S3 — porta del giro 3: la conferma dello svuotamento NEL MENU
test('S3 — menu «Incolla»: la conferma non nomina ricerche mai scritte', async () => {
  const server = createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(PAGE);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${server.address().port}/p`;

  for (const [nome, n, ricerca, attesa] of [
    ['cinque voci, nessuna ricerca', 5, null, /tutte e 5/],
    ['una voce sola, nessuna ricerca', 1, null, /unica voce/],
    ['cinque voci, ricerca senza risultati', 5, 'zzz', /ricerca/i],
  ]) {
    const userData = conCronologia('g5-conf-', voci(n));
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
      if (ricerca) {
        await web.locator('.sn-menu-history-search-input').fill(ricerca);
        await web.waitForTimeout(200);
      }
      await web.locator('.sn-menu-history-clear-btn').click();
      await web.waitForTimeout(500);
      const testo = await app.evaluate(async ({ webContents }, host) => {
        const wc = webContents.getAllWebContents().find((c) => {
          try { return new URL(c.getURL()).hostname === host; } catch (_) { return false; }
        });
        if (!wc) return 'nessun webContents';
        return wc.executeJavaScriptInIsolatedWorld(999, [{
          code: '(() => { try { const s = window.SN_CONFIRM_UI && window.SN_CONFIRM_UI._test.state(); return s ? (s.title + " | " + s.text) : "nessun dialogo"; } catch (e) { return String(e); } })()',
        }]);
      }, '127.0.0.1');
      console.log(`[S3] ${nome}: ${JSON.stringify(testo)}`);
      expect(String(testo), nome).toMatch(attesa);
      if (!ricerca) expect(String(testo), `${nome}: nessuna ricerca nominata`).not.toMatch(/ricerca/i);
    } finally {
      try { await app.close(); } catch (_) {}
      rmSync(userData, { recursive: true, force: true });
    }
  }
  server.close();
});

// ── S4 — due rimozioni sparate insieme: nessuna delle due deve tornare
test('S4 — Sicurezza: due voci tolte nello stesso istante restano tolte tutte e due', async () => {
  const userData = conCronologia('g5-race-', voci(5));
  const app = await avvia(userData);
  try {
    const page = await apriSicurezza(app);
    const esito = await page.evaluate(async () => {
      const MSG = window.SN_MESSAGES.MSG;
      const r = await chrome.runtime.sendMessage({ type: MSG.GET_CLIPBOARD_HISTORY });
      const [a, b] = [r.items[1], r.items[3]];
      const res = await Promise.all([
        chrome.runtime.sendMessage({ type: MSG.REMOVE_CLIPBOARD_ENTRY, entry: a }),
        chrome.runtime.sendMessage({ type: MSG.REMOVE_CLIPBOARD_ENTRY, entry: b }),
      ]);
      const fin = await chrome.runtime.sendMessage({ type: MSG.GET_CLIPBOARD_HISTORY });
      return {
        tolte: [a.text, b.text],
        risposte: res.map((x) => (x.items || []).map((e) => e.text)),
        finale: (fin.items || []).map((e) => e.text),
      };
    });
    console.log('[S4] esito:', JSON.stringify(esito));
    console.log('[S4] su disco:', JSON.stringify(suDisco(userData)));
    expect(esito.finale, 'nessuna delle due voci tolte è tornata').toEqual(['voce-0', 'voce-2', 'voce-4']);
  } finally {
    try { await app.close(); } catch (_) {}
    rmSync(userData, { recursive: true, force: true });
  }
});

// ── S5 — doppio clic su «Svuota cronologia» nella pagina
test('S5 — Sicurezza: doppio clic su «Svuota cronologia» non impila due conferme', async () => {
  const userData = conCronologia('g5-dblclear-', voci(4));
  const app = await avvia(userData);
  try {
    const page = await apriSicurezza(app);
    const btn = page.locator('#sec-clip-clear');
    await btn.dblclick();
    await page.waitForTimeout(600);
    const host = await page.locator(CONFIRM_HOST).count();
    console.log('[S5] host di conferma a schermo dopo il doppio clic:', host);
    // Annulla il primo e guarda cosa resta.
    await page.evaluate(() => window.SN_CONFIRM_UI._test.click('cancel'));
    await page.waitForTimeout(400);
    const dopo = await page.evaluate(() => ({
      host: document.querySelectorAll('.sn-confirm-host').length,
      stato: (window.SN_CONFIRM_UI && window.SN_CONFIRM_UI._test.state()) || null,
      voci: [...document.querySelectorAll('#sec-clip-list .sn-clip-item')].length,
    }));
    console.log('[S5] dopo aver annullato:', JSON.stringify(dopo));
    console.log('[S5] su disco:', JSON.stringify(suDisco(userData)));
    expect(host, 'una conferma sola a schermo').toBe(1);
    expect(dopo.stato, 'annullato una volta, nessun secondo dialogo resta appeso').toBe(null);
    expect(suDisco(userData).length, 'annullare non cancella niente').toBe(4);
  } finally {
    try { await app.close(); } catch (_) {}
    rmSync(userData, { recursive: true, force: true });
  }
});

// ── S6 — tolta l'ultima voce da tastiera: dove va il fuoco
test('S6 — Sicurezza: tolta da tastiera l\'ultima voce rimasta, la pagina resta usabile', async () => {
  const userData = conCronologia('g5-ultima-', voci(1));
  const app = await avvia(userData);
  try {
    const page = await apriSicurezza(app);
    await puntatoreSullaLista(page);
    await page.evaluate(() => document.querySelector('#sec-clip-list .sn-clip-remove').focus());
    await page.keyboard.press('Enter');
    await page.waitForTimeout(700);
    const stato = await page.evaluate(() => ({
      fuoco: document.activeElement ? (document.activeElement.id || document.activeElement.className || document.activeElement.tagName) : 'null',
      svuota: getComputedStyle(document.getElementById('sec-clip-clear')).display,
      ricerca: getComputedStyle(document.getElementById('sec-clip-search-row')).display,
      vuoto: getComputedStyle(document.getElementById('sec-clip-empty')).display,
      righe: document.querySelectorAll('#sec-clip-list .sn-clip-item').length,
    }));
    console.log('[S6] stato:', JSON.stringify(stato));
    console.log('[S6] su disco:', JSON.stringify(suDisco(userData)));
    expect(suDisco(userData), 'la voce è sparita davvero').toEqual([]);
  } finally {
    try { await app.close(); } catch (_) {}
    rmSync(userData, { recursive: true, force: true });
  }
});

// ── S7 — rimozione da tastiera con una ricerca attiva
test('S7 — Sicurezza: con una ricerca attiva la rimozione da tastiera toglie la voce giusta', async () => {
  const userData = conCronologia('g5-cerca-', [
    { type: 'text', text: 'password segreta uno', ts: 5 },
    { type: 'text', text: 'nota qualunque', ts: 4 },
    { type: 'text', text: 'password segreta due', ts: 3 },
    { type: 'text', text: 'altro testo', ts: 2 },
  ]);
  const app = await avvia(userData);
  try {
    const page = await apriSicurezza(app);
    await page.locator('#sec-clip-search').fill('password');
    await page.waitForTimeout(250);
    await puntatoreSullaLista(page);
    const visibili = await page.evaluate(() => [...document.querySelectorAll('#sec-clip-list .sn-clip-item')]
      .filter((r) => r.style.display !== 'none').map((r) => r.querySelector('.sn-clip-text').textContent));
    console.log('[S7] visibili col filtro:', JSON.stringify(visibili));
    await page.evaluate(() => {
      const vis = [...document.querySelectorAll('#sec-clip-list .sn-clip-item')].filter((r) => r.style.display !== 'none');
      vis[0].querySelector('.sn-clip-remove').focus();
    });
    await page.keyboard.press('Enter');
    await page.waitForTimeout(600);
    const fuoco = await statoFuoco(page);
    console.log('[S7] fuoco dopo:', JSON.stringify(fuoco));
    console.log('[S7] su disco:', JSON.stringify(suDisco(userData)));
    expect(suDisco(userData), 'via la prima password, le altre restano').toEqual(['nota qualunque', 'password segreta due', 'altro testo']);
    expect(fuoco.dentroLista, 'il fuoco resta sulla lista filtrata').toBe(true);

    // Ora lo svuotamento col filtro attivo: la conferma deve dire il numero vero.
    await page.locator('#sec-clip-clear').click();
    await page.waitForTimeout(400);
    const testo = await confirmText(page);
    console.log('[S7] conferma col filtro attivo:', JSON.stringify(testo));
    expect(testo, 'dice quante ne spariscono in tutto').toContain('3');
  } finally {
    try { await app.close(); } catch (_) {}
    rmSync(userData, { recursive: true, force: true });
  }
});

// ── S8 — svuotamento da un'altra parte mentre il puntatore è sulla lista
test('S8 — Sicurezza: svuotata da un\'altra scheda col puntatore fermo sulla lista', async () => {
  const userData = conCronologia('g5-altrove-', voci(4));
  const app = await avvia(userData);
  try {
    const page = await apriSicurezza(app);
    await puntatoreSullaLista(page);
    // Lo svuotamento arriva da fuori (il menu «Incolla» di un'altra scheda).
    await app.evaluate(async ({ webContents }) => {
      const wc = webContents.getAllWebContents().find((c) => {
        try { return new URL(c.getURL()).hostname === 'security'; } catch (_) { return false; }
      });
      return null;
    });
    await page.evaluate(async () => {
      // Simula la stessa richiesta che parte dal menu del tasto destro.
      await chrome.runtime.sendMessage({ type: window.SN_MESSAGES.MSG.CLEAR_CLIPBOARD_HISTORY });
    });
    await page.waitForTimeout(600);
    const fermo = await page.evaluate(() => ({
      righe: [...document.querySelectorAll('#sec-clip-list .sn-clip-item')].map((r) => r.classList.contains('sn-clip-gone')),
      svuota: getComputedStyle(document.getElementById('sec-clip-clear')).display,
      ricerca: getComputedStyle(document.getElementById('sec-clip-search-row')).display,
      vuoto: getComputedStyle(document.getElementById('sec-clip-empty')).display,
    }));
    console.log('[S8] col puntatore fermo:', JSON.stringify(fermo));
    // Il puntatore esce: la lista si ricompone.
    await page.mouse.move(5, 5);
    await page.waitForTimeout(500);
    const dopo = await page.evaluate(() => ({
      righe: document.querySelectorAll('#sec-clip-list .sn-clip-item').length,
      vuoto: getComputedStyle(document.getElementById('sec-clip-empty')).display,
    }));
    console.log('[S8] dopo che il puntatore è uscito:', JSON.stringify(dopo));
    expect(dopo.righe, 'la lista si è ricomposta vuota').toBe(0);
    expect(dopo.vuoto, 'compare la riga «non c\'è niente»').not.toBe('none');
  } finally {
    try { await app.close(); } catch (_) {}
    rmSync(userData, { recursive: true, force: true });
  }
});
