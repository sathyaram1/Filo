// #2084 — una linguetta trascinata segue il puntatore, e fuori dalla fila si lascia in un campo di testo o in una chat;
// #2085 — lasciata nella chat della home diventa un gettone con anteprima, e Filo ne legge la pagina.
// Il trascinamento passa dal mouse vero della barra (CDP): eventi veri, cattura del puntatore compresa.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, expect } from './fixtures/electron.mjs';
import { home, modelloFinto, chiamateAlModello, ripristina } from './helpers/chatFinta.mjs';
import { paginaDellaScheda } from './helpers/schede.mjs';

const SHOTS = path.join(path.dirname(fileURLToPath(import.meta.url)), '.shots');
const scatta = async (page, nome) => {
  try { fs.mkdirSync(SHOTS, { recursive: true }); await page.screenshot({ path: path.join(SHOTS, `scheda-trascinata-${nome}.png`) }); } catch (_) {}
};

const schede = (shell) => shell.evaluate(async () => (await window.filoShell.tabs.snapshot()).tabs);
const ordine = async (shell) => (await schede(shell)).map((t) => t.id);
const attiva = (shell, id) => shell.evaluate((i) => window.filoShell.tabs.activate(i), id);

async function linguetta(shell, id) {
  return shell.evaluate((i) => {
    const r = document.querySelector(`.tab[data-id="${i}"]`).getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2, left: r.left, right: r.right };
  }, id);
}

// Il punto di un elemento della scheda davanti, nei px della barra.
async function puntoInPagina(app, page, selettore) {
  const r = await page.locator(selettore).first().evaluate((el) => {
    const b = el.getBoundingClientRect();
    return { x: b.left + Math.min(24, b.width / 2), y: b.top + b.height / 2 };
  });
  const v = await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x.isDestroyed() && !x._filoIncognito);
    const tm = w._filoTabs;
    const t = tm.tabs.find((x) => x.id === tm.activeId);
    return { b: t.view.getBounds(), z: t.view.webContents.getZoomFactor() || 1, zs: w.webContents.getZoomFactor() || 1 };
  });
  return { x: (v.b.x + r.x * v.z) / v.zs, y: (v.b.y + r.y * v.z) / v.zs };
}

async function prendi(shell, da) {
  await shell.mouse.move(da.x, da.y);
  await shell.mouse.down();
  await shell.mouse.move(da.x + 8, da.y, { steps: 2 });
}

async function idPerUrl(shell, url) {
  return (await schede(shell)).find((t) => t.url === url)?.id;
}

const cartaVisibile = (app) => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()
  .some((w) => !w.isDestroyed() && w.webContents.getURL().includes('anteprima.html') && w.isVisible()));

test('#2084 la linguetta segue il puntatore e l\'ordine è quello del rilascio', async ({ shell, openTab, testServer }) => {
  await openTab(testServer.html('<title>Uno</title><p>uno'));
  await openTab(testServer.html('<title>Due</title><p>due'));
  await openTab(testServer.html('<title>Tre</title><p>tre'));
  const prima = await ordine(shell);
  expect(prima.length).toBeGreaterThanOrEqual(4);
  const mossa = prima[1];
  const da = await linguetta(shell, mossa);
  const ultima = await linguetta(shell, prima[prima.length - 1]);
  await prendi(shell, da);
  const x = ultima.left + (ultima.right - ultima.left) * 0.8;
  await shell.mouse.move(x, da.y, { steps: 8 });
  // A metà trascinamento: traslata, sotto il puntatore, e i nodi della barra non si sono spostati.
  const meta = await shell.evaluate((i) => {
    const el = document.querySelector(`.tab[data-id="${i}"]`);
    const r = el.getBoundingClientRect();
    return { t: getComputedStyle(el).transform, left: r.left, right: r.right, indice: [...el.parentElement.children].indexOf(el) };
  }, mossa);
  expect(meta.t).not.toBe('none');
  expect(meta.left).toBeLessThanOrEqual(x);
  expect(meta.right).toBeGreaterThanOrEqual(x);
  expect(meta.indice).toBe(1);
  await scatta(shell, 'a-meta');
  await shell.mouse.up();
  await expect.poll(async () => (await ordine(shell)).at(-1), { timeout: 8000 }).toBe(mossa);
  const dopo = await ordine(shell);
  expect([...dopo].sort()).toEqual([...prima].sort());
  // Al rilascio la linguetta si assesta: nessuna traslazione rimasta.
  await expect.poll(() => shell.evaluate((i) => getComputedStyle(document.querySelector(`.tab[data-id="${i}"]`)).transform, mossa),
    { timeout: 3000 }).toMatch(/^(none|matrix\(1, 0, 0, 1, 0, 0\))$/);
});

test('#2084 lasciata sopra la pagina non cambia niente, e uscire e rientrare non interrompe', async ({ shell, openTab, testServer }) => {
  const errori = [];
  shell.on('console', (m) => { if (m.type() === 'error') errori.push(m.text()); });
  shell.on('pageerror', (e) => errori.push(String(e)));
  const pagina = await openTab(testServer.html('<title>Vuota</title><p style="margin:300px">niente qui'));
  await openTab(testServer.html('<title>Altra</title><p>altra'));
  const prima = await ordine(shell);
  const da = await linguetta(shell, prima[1]);
  // Giù sulla pagina, dove non c'è un campo: rilascio.
  await prendi(shell, da);
  await shell.mouse.move(da.x + 40, da.y + 260, { steps: 6 });
  await expect.poll(() => shell.evaluate((i) => document.querySelector(`.tab[data-id="${i}"]`).classList.contains('fuori'), prima[1])).toBe(true);
  await shell.mouse.up();
  await shell.waitForTimeout(400);
  expect(await ordine(shell)).toEqual(prima);
  expect(await pagina.evaluate(() => document.body.innerText.trim())).toBe('niente qui');
  expect(errori).toEqual([]);

  // Fuori dalla fila e di nuovo dentro, fino in fondo: il trascinamento prosegue e il rilascio riordina.
  const ultima = await linguetta(shell, prima.at(-1));
  await prendi(shell, da);
  await shell.mouse.move(da.x + 20, da.y + 200, { steps: 5 });
  await shell.mouse.move(ultima.right - 4, ultima.y, { steps: 6 });
  await expect.poll(() => shell.evaluate((i) => document.querySelector(`.tab[data-id="${i}"]`).classList.contains('dragging'), prima[1])).toBe(true);
  await shell.mouse.up();
  await expect.poll(async () => (await ordine(shell)).at(-1), { timeout: 8000 }).toBe(prima[1]);
});

test('#2084 lasciata su una textarea di un sito ci scrive titolo e indirizzo', async ({ app, shell, openTab, testServer }) => {
  const sorgenteUrl = testServer.html('<title>Ricetta del pane</title><p>farina');
  await openTab(sorgenteUrl);
  const campo = await openTab(testServer.html('<title>Modulo</title><textarea id="t" style="margin:80px;width:400px;height:120px">Guarda:</textarea>'));
  const sorgente = await idPerUrl(shell, sorgenteUrl);
  const verso = await puntoInPagina(app, campo, '#t');
  await prendi(shell, await linguetta(shell, sorgente));
  await shell.mouse.move(verso.x, verso.y, { steps: 8 });
  // La destinazione si illumina mentre ci si passa sopra.
  await expect.poll(() => campo.evaluate(() => !!document.querySelector('filo-luce')), { timeout: 5000 }).toBe(true);
  await shell.mouse.up();
  await expect.poll(() => campo.locator('#t').inputValue(), { timeout: 5000 }).toContain('Ricetta del pane');
  const valore = await campo.locator('#t').inputValue();
  expect(valore).toContain(sorgenteUrl);
  expect(valore.startsWith('Guarda:')).toBe(true);
});

test('#2085 una scheda lasciata nella chat della home: gettone, anteprima, lettura, Backspace e scheda chiusa', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(120_000);
  const url = testServer.html('<title>Articolo sulla Tesla</title><p>La Tesla Roadster è volata nello spazio nel 2018 su un Falcon Heavy.</p>');
  await openTab(url);
  const sorgente = await idPerUrl(shell, url);
  const casa = (await schede(shell)).find((t) => String(t.url).startsWith('filo://newtab'));
  await attiva(shell, casa.id);
  const page = await home(app);

  const lascia = async () => {
    const verso = await puntoInPagina(app, page, '#input');
    await prendi(shell, await linguetta(shell, sorgente));
    await shell.mouse.move(verso.x, verso.y, { steps: 8 });
    await shell.mouse.up();
    await expect(page.locator('.sn-gettoni-fondo .sn-gettone')).toHaveCount(1, { timeout: 5000 });
  };

  // (1) Il gettone, col titolo.
  await lascia();
  await expect(page.locator('#input')).toHaveValue(/⟦ Articolo sulla Tesla⟧/);
  await expect(page.locator('.sn-gettoni-fondo .sn-gettone')).toContainText('Articolo sulla Tesla');
  await scatta(page, 'gettone-nel-campo');

  // (2) Hover sul gettone: la carta dell'anteprima.
  const g = await page.locator('.sn-gettoni-fondo .sn-gettone').boundingBox();
  await page.mouse.move(g.x + g.width / 2, g.y + g.height / 2);
  await expect.poll(() => cartaVisibile(app), { timeout: 5000 }).toBe(true);
  await page.mouse.move(5, 5);

  // (4) Backspace lo toglie intero.
  await page.locator('#input').focus();
  await page.keyboard.press('End');
  await page.keyboard.press('Backspace'); // lo spazio dopo il gettone
  await page.keyboard.press('Backspace');
  await expect(page.locator('#input')).not.toHaveValue(/⟦/);
  await expect(page.locator('.sn-gettoni-fondo')).toHaveCount(0);

  // (3) Invio: il modello riceve titolo, indirizzo e testo della pagina; il filo mostra il gettone.
  await page.locator('#input').fill('come ha fatto a volare?');
  await lascia();
  await modelloFinto(app, [{ text: 'Con un razzo.' }]);
  try {
    await page.locator('#sendBtn').click();
    await expect(page.locator('.dash-bubble-user .sn-bolla-gettone')).toContainText('Articolo sulla Tesla', { timeout: 15_000 });
    await expect.poll(async () => JSON.stringify(await chiamateAlModello(app)), { timeout: 15_000 }).toContain('Falcon Heavy');
    const inviato = JSON.stringify(await chiamateAlModello(app));
    expect(inviato).toContain('Articolo sulla Tesla');
    expect(inviato).toContain(url);
    expect(inviato).toContain('PAGINA_WEB');
    await expect(page.locator('.dash-bubble-user').last()).toContainText('come ha fatto a volare?');
    await scatta(page, 'gettone-nel-filo');
  } finally { await ripristina(app); }

  // (5) Scheda chiusa: il gettone resta, l'hover dà la carta, il clic riapre l'indirizzo.
  await shell.evaluate((i) => window.filoShell.tabs.close(i), sorgente);
  await expect.poll(async () => !(await idPerUrl(shell, url)), { timeout: 5000 }).toBe(true);
  const b = page.locator('.dash-bubble-user .sn-bolla-gettone').last();
  await expect(b).toBeVisible();
  await page.mouse.move(5, 5);
  await expect.poll(() => cartaVisibile(app), { timeout: 5000 }).toBe(false);
  await b.hover();
  await expect.poll(() => cartaVisibile(app), { timeout: 5000 }).toBe(true);
  await b.click();
  await expect.poll(async () => {
    const tutte = await schede(shell);
    const riaperta = tutte.find((t) => t.url === url);
    const attivaOra = await shell.evaluate(async () => (await window.filoShell.tabs.snapshot()).activeId);
    return !!riaperta && riaperta.id === attivaOra;
  }, { timeout: 8000 }).toBe(true);
  expect(await paginaDellaScheda(app, await idPerUrl(shell, url))).toBeTruthy();
});
