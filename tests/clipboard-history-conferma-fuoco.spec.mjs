// Feedback #256, giro 5. Tre cose che la verifica ha trovato rotte:
//
//  1. la conferma dello svuotamento parlava di una ricerca che l'utente non
//     aveva scritto («La ricerca che hai scritto ne mostra 0: spariscono anche
//     le altre»), e con una voce sola si contraddiceva da sé;
//  2. chi toglie una voce con la TASTIERA restava senza niente sotto le dita —
//     il fuoco tornava al corpo della pagina e per la voce dopo bisognava
//     riattraversare col tabulatore tutta la pagina delle impostazioni;
//  3. un'immagine copiata che non si riesce a disegnare lasciava l'iconcina
//     rotta del browser, mentre il menu "Incolla" rimette quella di Filo.
//
// Gli spec asseriscono il SUCCESSO dal punto di vista di chi usa Filo. Senza le
// correzioni sono rossi.
//
// NOTA sul menu del tasto destro: su una pagina web il dialogo di conferma vive
// nel mondo isolato del content script, quindi il suo TESTO non è leggibile da
// uno spec (vedi tests/helpers/confirm.mjs). La regola del testo è la stessa per
// le due strade e sta in un modulo condiviso, coperto da
// tests/unit/clipboardHistory.test.mjs; qui del menu si prova ciò che si vede:
// il fuoco dopo una rimozione da tastiera.

import { test, expect, argomentiScala } from './fixtures/electron.mjs';
import { cartellaTemporanea } from './helpers/percorsi.mjs';
import { apriCronologia, statoCronologia } from './helpers/cronologiaAppunti.mjs';
import { _electron as electron } from '@playwright/test';
import { writeFileSync, rmSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';
import { confirmText, clickConfirm } from './helpers/confirm.mjs';

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
    args: [...argomentiScala, '.'], cwd: APP_ROOT,
    env: { ...process.env, FILO_USER_DATA: userData, NODE_ENV: 'test' },
  });
}

function conCronologia(prefix, items) {
  const userData = cartellaTemporanea(prefix);
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

test('Sicurezza: senza ricerca la conferma dello svuotamento non parla di ricerca', async () => {
  const userData = conCronologia('conf-senza-', voci(5));
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
    expect(testo).toContain('5');
    expect(testo, 'nessuna ricerca scritta: della ricerca non si parla').not.toMatch(/ricerca/i);
    await clickConfirm(page, 'cancel');

    // Con una voce sola la conferma non può dire "spariscono anche le altre".
    await page.evaluate(async () => {
      for (let i = 1; i < 5; i++) {
        await chrome.runtime.sendMessage({
          type: window.SN_MSG.MSG.REMOVE_CLIPBOARD_ENTRY,
          entry: { type: 'text', text: `voce-${i}` },
        });
      }
    });
    await expect(page.locator('#sec-clip-list .sn-clip-item')).toHaveCount(1);
    await page.click('#sec-clip-clear');
    const unaSola = await confirmText(page);
    expect(unaSola).toMatch(/unica/i);
    expect(unaSola, 'con una voce sola non ci sono "altre" che spariscono').not.toMatch(/altre/i);
    await clickConfirm(page, 'cancel');
  } finally {
    try { await app.close(); } catch (_) {}
    rmSync(userData, { recursive: true, force: true });
  }
});

test('Sicurezza: con una ricerca in corso la conferma dichiara quante ne sta mostrando', async () => {
  const items = [
    { type: 'text', text: 'password-Hunter2', ts: 100 },
    ...Array.from({ length: 6 }, (_, i) => ({ type: 'text', text: `nota ${i}`, ts: 50 - i })),
  ];
  const userData = conCronologia('conf-con-', items);
  const app = await avvia(userData);
  try {
    const shell = await app.firstWindow();
    await shell.waitForLoadState('domcontentloaded');
    await shell.evaluate((u) => window.filoShell.tabs.open(u), SEC_URL);
    const page = await findTabPage(app, 'security');
    await page.waitForLoadState('domcontentloaded');
    await expect(page.locator('#sec-clip-list .sn-clip-item')).toHaveCount(7);
    await page.fill('#sec-clip-search', 'password');
    await expect(page.locator('#sec-clip-list .sn-clip-item:visible')).toHaveCount(1);
    await page.click('#sec-clip-clear');
    const testo = await confirmText(page);
    expect(testo).toContain('7');
    expect(testo).toMatch(/ricerca/i);
    await clickConfirm(page, 'cancel');

    // Ricerca svuotata: la frase sulla ricerca se ne va con lei.
    await page.fill('#sec-clip-search', '');
    await expect(page.locator('#sec-clip-list .sn-clip-item:visible')).toHaveCount(7);
    await page.click('#sec-clip-clear');
    expect(await confirmText(page)).not.toMatch(/ricerca/i);
    await clickConfirm(page, 'cancel');
  } finally {
    try { await app.close(); } catch (_) {}
    rmSync(userData, { recursive: true, force: true });
  }
});

test('Sicurezza: da tastiera, tolta una voce resta qualcosa sotto le dita', async () => {
  const userData = conCronologia('fuoco-sec-', voci(5));
  const app = await avvia(userData);
  try {
    const shell = await app.firstWindow();
    await shell.waitForLoadState('domcontentloaded');
    await shell.evaluate((u) => window.filoShell.tabs.open(u), SEC_URL);
    const page = await findTabPage(app, 'security');
    await page.waitForLoadState('domcontentloaded');
    await expect(page.locator('#sec-clip-list .sn-clip-item')).toHaveCount(5);
    // Il mouse sta lontano: qui comanda la tastiera.
    await page.mouse.move(4, 4);
    await page.locator('#sec-clip-list .sn-clip-item').nth(2).locator('.sn-clip-remove').focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('#sec-clip-list .sn-clip-item')).toHaveCount(4);

    // Il fuoco è sul "Rimuovi" della voce che ha preso quel posto: premendo
    // ancora Invio si continua a togliere, senza rifare il giro col tabulatore.
    const dove = await page.evaluate(() => {
      const a = document.activeElement;
      if (!a) return null;
      const row = a.closest && a.closest('.sn-clip-item');
      return { classe: a.className, testoRiga: row ? row.textContent : null };
    });
    expect(dove && dove.classe).toContain('sn-clip-remove');
    expect(dove.testoRiga).toContain('voce-3');

    await page.keyboard.press('Enter');
    await expect(page.locator('#sec-clip-list .sn-clip-item')).toHaveCount(3);
    const testi = await page.evaluate(async () => {
      const r = await chrome.runtime.sendMessage({ type: window.SN_MSG.MSG.GET_CLIPBOARD_HISTORY });
      return (r.items || []).map((x) => x.text);
    });
    expect(testi).toEqual(['voce-0', 'voce-1', 'voce-4']);

    // Tolta l'ultima voce rimasta, il fuoco non cade nel vuoto.
    await page.keyboard.press('Enter');
    await page.waitForTimeout(400);
    await page.keyboard.press('Enter');
    await page.waitForTimeout(400);
    await page.keyboard.press('Enter');
    await page.waitForTimeout(600);
    await expect(page.locator('#sec-clip-empty')).toBeVisible();
    const finale = await page.evaluate(() => (document.activeElement || {}).tagName);
    console.log('[#256] fuoco a cronologia vuota:', finale);
  } finally {
    try { await app.close(); } catch (_) {}
    rmSync(userData, { recursive: true, force: true });
  }
});

test('menu Incolla: da tastiera, tolta una voce il fuoco passa alla "x" successiva', async () => {
  const userData = conCronologia('fuoco-menu-', voci(4));
  const srv = await serviPagina();
  const app = await avvia(userData);
  try {
    const shell = await app.firstWindow();
    await shell.waitForLoadState('domcontentloaded');
    await shell.evaluate((u) => window.filoShell.tabs.open(u), srv.url);
    const web = await findTabPage(app, '127.0.0.1');
    await web.waitForFunction(() => document.documentElement.dataset.filoReady === '1', null, { timeout: 15000 });
    const stato = await apriCronologia(app, web, '#ta');
    expect(stato.voci).toHaveLength(4);
    const voci = async () => (await statoCronologia(app, web)).voci;

    // Il pannello sta in uno shadow root chiuso: dalla ricerca, che ha il fuoco ed è dopo la lista, si risale col tabulatore.
    for (let i = 0; i < 12 && !(await voci())[1].fuocoRimuovi; i++) await web.keyboard.press('Shift+Tab');
    expect((await voci())[1].fuocoRimuovi).toBe(true);
    await web.keyboard.press('Enter');
    await expect.poll(async () => (await voci())[1].tolta).toBe(true);
    // Il fuoco è sulla "x" della voce dopo: un altro Invio toglie quella, non
    // niente. (Prima il bottone disabilitato buttava fuori il fuoco.)
    await web.keyboard.press('Enter');
    await expect.poll(async () => (await voci())[2].tolta).toBe(true);
    await expect.poll(async () => (await voci()).filter((v) => !v.tolta).length).toBe(2);

    // E sul disco sono sparite proprio quelle due: riaperto il menu ne restano
    // due, la prima e l'ultima.
    await web.keyboard.press('Escape');
    const dopo = await apriCronologia(app, web, '#ta');
    expect(dopo.voci.map((v) => v.testo)).toEqual(['voce-0', 'voce-3']);
  } finally {
    srv.close();
    try { await app.close(); } catch (_) {}
    rmSync(userData, { recursive: true, force: true });
  }
});

test('Sicurezza: un\'immagine che non si disegna mostra l\'icona di Filo, non quella rotta del browser', async () => {
  const userData = conCronologia('img-rotta-', [
    { type: 'image', dataUrl: 'data:image/png;base64,NONVALIDO', ts: 5 },
    { type: 'text', text: 'testo qualsiasi', ts: 4 },
  ]);
  const app = await avvia(userData);
  try {
    const shell = await app.firstWindow();
    await shell.waitForLoadState('domcontentloaded');
    await shell.evaluate((u) => window.filoShell.tabs.open(u), SEC_URL);
    const page = await findTabPage(app, 'security');
    await page.waitForLoadState('domcontentloaded');
    await expect(page.locator('#sec-clip-list .sn-clip-item')).toHaveCount(2);
    // L'<img> rotta se ne va e al suo posto c'è l'iconcina di Filo.
    await expect(page.locator('#sec-clip-list img.sn-clip-thumb')).toHaveCount(0);
    const ripiego = page.locator('#sec-clip-list .sn-clip-thumb-fallback');
    await expect(ripiego).toHaveCount(1);
    await expect(ripiego.locator('svg')).toHaveCount(1);
  } finally {
    try { await app.close(); } catch (_) {}
    rmSync(userData, { recursive: true, force: true });
  }
});
