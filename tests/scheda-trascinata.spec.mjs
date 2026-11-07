// #2084 — una linguetta trascinata segue il puntatore, e fuori dalla fila si lascia in un campo di testo o in una chat;
// #2085 — lasciata nella chat della home diventa un gettone con anteprima, e Filo ne legge la pagina.
// Il trascinamento passa dal mouse vero della barra (CDP): eventi veri, cattura del puntatore compresa.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, expect } from './fixtures/electron.mjs';
import { home, modelloFinto, chiamateAlModello, ripristina } from './helpers/chatFinta.mjs';
import { paginaDellAiuto } from './helpers/riquadri.mjs';
import * as Gesti from './helpers/gestiVeri.mjs';

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

// Il punto di un elemento dell'Aiuto nello strato sopra la scheda davanti, nei px della barra.
async function puntoNelloStrato(app, aiuto, selettore) {
  const r = await aiuto.locator(selettore).first().evaluate((el) => {
    const b = el.getBoundingClientRect();
    return { x: b.left + Math.min(24, b.width / 2), y: b.top + b.height / 2 };
  });
  const v = await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x.isDestroyed() && !x._filoIncognito);
    const tm = w._filoTabs;
    const t = tm.tabs.find((x) => x.id === tm.activeId);
    const s = tm.riquadri.strati.get(t.view.webContents);
    return { b: s.perIlVuoto.getBounds(), z: s.vista.webContents.getZoomFactor() || 1, zs: w.webContents.getZoomFactor() || 1 };
  });
  return { x: (v.b.x + r.x * v.z) / v.zs, y: (v.b.y + r.y * v.z) / v.zs };
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
});

test('#2085 nell\'Aiuto sopra un sito: gettone nel campo, pagina letta all\'invio, gettone nella bolla', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(90_000);
  const url = testServer.html('<title>Articolo sulla Tesla</title><p>La Tesla Roadster è volata nello spazio nel 2018 su un Falcon Heavy.</p>');
  await openTab(url);
  const sorgente = await idPerUrl(shell, url);
  const sito = await openTab(testServer.html('<title>Un sito</title><p>un sito qualunque'));
  const id = await shell.evaluate(async () => (await window.filoShell.tabs.snapshot()).activeId);
  await shell.evaluate((tabId) => window.filoShell.tabs.help(tabId), id);
  const aiuto = await paginaDellAiuto(app, sito);
  await aiuto.waitForSelector('.sn-sidebar-input textarea', { timeout: 8000 });

  const verso = await puntoNelloStrato(app, aiuto, '.sn-sidebar-input textarea');
  await prendi(shell, await linguetta(shell, sorgente));
  await shell.mouse.move(verso.x, verso.y, { steps: 8 });
  await shell.mouse.up();
  await expect(aiuto.locator('.sn-gettoni-fondo .sn-gettone')).toContainText('Articolo sulla Tesla', { timeout: 5000 });
  // Il campo del sito sotto non ha ricevuto niente.
  expect(await sito.evaluate(() => document.body.innerText.trim())).toBe('un sito qualunque');

  await app.evaluate(async () => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'k-test' },
      models: { [C.ACTIONS.HELP]: 'deepseek-flash' },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
    });
    const P = globalThis.SN_PROVIDERS;
    globalThis.__visti = [];
    const risposta = ({ attempts, messages }) => {
      globalThis.__visti.push(JSON.parse(JSON.stringify(messages)));
      return { text: '{"message":"Con un razzo.","suggestions":[],"issues":[]}', model: attempts[0].model, provider: attempts[0].provider, usage: {} };
    };
    P.completeWithFallback = async (o) => risposta(o);
    P.streamCompleteWithFallback = async (o) => risposta(o);
  });
  await aiuto.locator('.sn-sidebar-input textarea').focus();
  await aiuto.keyboard.press('End');
  await aiuto.keyboard.type('come ha fatto a volare?');
  await aiuto.keyboard.press('Enter');
  await expect(aiuto.locator('.sn-sidebar-msg-user .sn-bolla-gettone')).toContainText('Articolo sulla Tesla', { timeout: 15_000 });
  await expect.poll(() => app.evaluate(() => JSON.stringify(globalThis.__visti || [])), { timeout: 15_000 }).toContain('Falcon Heavy');
  await scatta(aiuto, 'gettone-aiuto');
});

// Una scheda lasciata nel campo della home dalla fila, con la home davanti: torna la Page della home e l'id della scheda.
async function gettoneNellaHome(app, shell, openTab, testServer, titolo = 'Articolo sulla Tesla') {
  const url = testServer.html(`<title>${titolo}</title><p>La Tesla Roadster è volata nello spazio su un Falcon Heavy.</p>`);
  await openTab(url);
  const sorgente = await idPerUrl(shell, url);
  const casa = (await schede(shell)).find((t) => String(t.url).startsWith('filo://newtab'));
  await attiva(shell, casa.id);
  const page = await home(app);
  const verso = await puntoInPagina(app, page, '#input');
  await prendi(shell, await linguetta(shell, sorgente));
  await shell.mouse.move(verso.x, verso.y, { steps: 8 });
  await shell.mouse.up();
  await expect(page.locator('.sn-gettoni-fondo .sn-gettone')).toHaveCount(1, { timeout: 5000 });
  return { page, sorgente, url, casa: casa.id };
}

const davanti = (shell) => shell.evaluate(async () => (await window.filoShell.tabs.snapshot()).activeId);
const statoDelCampo = (page) => page.evaluate(() => ({ v: document.getElementById('input').value, n: document.getElementById('input')._snGettoni.schede().length }));

test('#2085 il clic su un gettone di una scheda aperta la porta davanti, dal campo e dal filo', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(90_000);
  const { page, sorgente, casa } = await gettoneNellaHome(app, shell, openTab, testServer);
  const g = await page.locator('.sn-gettoni-fondo .sn-gettone').boundingBox();
  await page.mouse.click(g.x + g.width / 2, g.y + g.height / 2);
  await expect.poll(() => davanti(shell), { timeout: 5000 }).toBe(sorgente);
  const quante = (await schede(shell)).length;

  await attiva(shell, casa);
  await modelloFinto(app, [{ text: 'Con un razzo.' }]);
  try {
    await page.locator('#sendBtn').click();
    const b = page.locator('.dash-bubble-user .sn-bolla-gettone').last();
    await expect(b).toBeVisible({ timeout: 15_000 });
    await b.click();
    await expect.poll(() => davanti(shell), { timeout: 5000 }).toBe(sorgente);
    // Davanti quella che c'era: nessuna scheda nuova.
    expect((await schede(shell)).length).toBe(quante);
  } finally { await ripristina(app); }
});

test('#2085 nell\'Aiuto sopra un sito: la carta sta sotto il gettone, e il clic porta davanti la scheda', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(90_000);
  const url = testServer.html('<title>Articolo sulla Tesla</title><p>Falcon Heavy</p>');
  await openTab(url);
  const sorgente = await idPerUrl(shell, url);
  const sito = await openTab(testServer.html('<title>Un sito</title><p>un sito qualunque'));
  const id = await davanti(shell);
  await shell.evaluate((tabId) => window.filoShell.tabs.help(tabId), id);
  const aiuto = await paginaDellAiuto(app, sito);
  await aiuto.waitForSelector('.sn-sidebar-input textarea', { timeout: 8000 });
  const verso = await puntoNelloStrato(app, aiuto, '.sn-sidebar-input textarea');
  await prendi(shell, await linguetta(shell, sorgente));
  await shell.mouse.move(verso.x, verso.y, { steps: 8 });
  await shell.mouse.up();
  const gettone = aiuto.locator('.sn-gettoni-fondo .sn-gettone');
  await expect(gettone).toHaveCount(1, { timeout: 5000 });

  const g = await gettone.boundingBox();
  await aiuto.mouse.move(g.x + g.width / 2, g.y + g.height / 2);
  await aiuto.mouse.move(g.x + g.width / 2 + 1, g.y + g.height / 2);
  await expect.poll(() => cartaVisibile(app), { timeout: 5000 }).toBe(true);
  // La carta appena sotto il gettone, nei px della barra: il conto passa dallo strato, non dalla scheda.
  const sotto = await puntoNelloStrato(app, aiuto, '.sn-gettoni-fondo .sn-gettone');
  const carta = await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x.isDestroyed() && !x._filoIncognito);
    const c = BrowserWindow.getAllWindows().find((x) => !x.isDestroyed() && x.webContents.getURL().includes('anteprima.html') && x.isVisible());
    const cb = w.getContentBounds();
    const b = c.getBounds();
    return { x: b.x - cb.x, y: b.y - cb.y, zs: w.webContents.getZoomFactor() || 1 };
  });
  expect(Math.abs(carta.x / carta.zs - (sotto.x - Math.min(24, g.width / 2)))).toBeLessThan(40);
  expect(carta.y / carta.zs).toBeGreaterThan(sotto.y - 4);
  expect(carta.y / carta.zs).toBeLessThan(sotto.y + 60);

  await aiuto.mouse.click(g.x + g.width / 2, g.y + g.height / 2);
  await expect.poll(() => davanti(shell), { timeout: 5000 }).toBe(sorgente);
});

test('#2084 lasciata su un campo modificabile ci scrive titolo e indirizzo, su un campo per indirizzi solo l\'indirizzo', async ({ app, shell, openTab, testServer }) => {
  const sorgenteUrl = testServer.html('<title>Ricetta del pane</title><p>farina');
  await openTab(sorgenteUrl);
  const sorgente = await idPerUrl(shell, sorgenteUrl);
  const campo = await openTab(testServer.html(`<title>Posta</title>
    <div id="ce" contenteditable="true" style="margin:40px;width:400px;height:100px;border:1px solid">Ciao, </div>
    <input id="u" type="url" style="margin:40px;width:400px">`));
  for (const [sel, leggi] of [['#ce', (p) => p.locator('#ce').innerText()], ['#u', (p) => p.locator('#u').inputValue()]]) {
    const verso = await puntoInPagina(app, campo, sel);
    await prendi(shell, await linguetta(shell, sorgente));
    await shell.mouse.move(verso.x, verso.y, { steps: 8 });
    await shell.mouse.up();
    await expect.poll(() => leggi(campo), { timeout: 5000 }).toContain(sorgenteUrl);
  }
  const testo = await campo.locator('#ce').innerText();
  expect(testo.startsWith('Ciao,')).toBe(true);
  expect(testo).toContain('Ricetta del pane');
  expect(await campo.locator('#u').inputValue()).toBe(sorgenteUrl);
});

test('#2085 un messaggio con una scheda, riletto da una home nuova o ricaricata, tiene il gettone', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(90_000);
  const { page } = await gettoneNellaHome(app, shell, openTab, testServer);
  await page.locator('#input').focus();
  await page.keyboard.press('Home');
  await page.keyboard.type('di cosa parla ');
  await modelloFinto(app, [{ text: 'Con un razzo.' }]);
  try {
    await page.locator('#sendBtn').click();
    await expect(page.getByText('Con un razzo.')).toBeVisible({ timeout: 15_000 });
  } finally { await ripristina(app); }
  const nuova = await shell.evaluate(() => window.filoShell.tabs.open('filo://newtab'));
  const altra = await home(app, { scheda: nuova?.id });
  const bolla = (p) => p.locator('.dash-bubble-user').filter({ hasText: 'di cosa parla' });
  await expect(bolla(altra).locator('.sn-bolla-gettone')).toContainText('Articolo sulla Tesla', { timeout: 10_000 });
  await expect(bolla(altra)).not.toContainText('⟦');
  await page.reload();
  await expect(bolla(page).locator('.sn-bolla-gettone')).toContainText('Articolo sulla Tesla', { timeout: 10_000 });
  await expect(bolla(page)).not.toContainText('⟦');
});

test('#2085 un gettone tolto e rimesso (Annulla, Taglia e Incolla) torna gettone con la sua scheda', async ({ app, shell, openTab, testServer }) => {
  const { page } = await gettoneNellaHome(app, shell, openTab, testServer);
  await page.locator('#input').focus();
  await page.keyboard.press('End');
  await page.keyboard.press('Backspace');
  await page.keyboard.press('Backspace');
  await expect.poll(async () => (await statoDelCampo(page)).n).toBe(0);
  await page.keyboard.press('ControlOrMeta+z');
  await expect.poll(async () => (await statoDelCampo(page)).v).toContain('⟦');
  expect((await statoDelCampo(page)).n).toBe(1);

  await page.evaluate(() => { const t = document.getElementById('input'); t.setSelectionRange(t.value.indexOf('⟦'), t.value.indexOf('⟧') + 1); });
  await page.keyboard.press('ControlOrMeta+x');
  await expect.poll(async () => (await statoDelCampo(page)).n).toBe(0);
  await page.keyboard.type('vedi ');
  await page.keyboard.press('ControlOrMeta+v');
  await expect.poll(async () => (await statoDelCampo(page)).n).toBe(1);
  await expect(page.locator('.sn-gettoni-fondo .sn-gettone')).toContainText('Articolo sulla Tesla');
});

test('#2084 a metà trascinamento sopra una vicina la linguetta la copre del tutto', async ({ shell, openTab, testServer }) => {
  await openTab(testServer.html('<title>Articolo sulla Tesla volante</title><p>x'));
  await openTab(testServer.html('<title>Modulo</title><p>y'));
  const prima = await ordine(shell);
  const mossa = prima.at(-2);
  const da = await linguetta(shell, mossa);
  await prendi(shell, da);
  await shell.mouse.move(da.x + 90, da.y, { steps: 6 });
  const copre = await shell.evaluate((i) => {
    const el = document.querySelector(`.tab[data-id="${i}"]`);
    const cs = getComputedStyle(el);
    const m = cs.backgroundColor.match(/rgba?\(([^)]+)\)/);
    const p = m ? m[1].split(',').map(parseFloat) : [];
    return { trascinata: el.classList.contains('dragging'), visibile: Number(cs.opacity) * (p.length > 3 ? p[3] : 1) };
  }, mossa);
  await shell.mouse.up();
  expect(copre.trascinata).toBe(true);
  expect(copre.visibile).toBeGreaterThanOrEqual(0.99);
});

// Il modello finto dell'Aiuto: risponde sempre uguale e tiene i messaggi che riceve.
async function aiutoFinto(app) {
  await app.evaluate(async () => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false, apiKeys: { openrouter: 'k-test' }, models: { [C.ACTIONS.HELP]: 'deepseek-flash' },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
    });
    const P = globalThis.SN_PROVIDERS;
    globalThis.__visti = [];
    const risposta = ({ attempts, messages }) => {
      globalThis.__visti.push(JSON.parse(JSON.stringify(messages)));
      return { text: '{"message":"Con un razzo.","suggestions":[],"issues":[]}', model: attempts[0].model, provider: attempts[0].provider, usage: {} };
    };
    P.completeWithFallback = async (o) => risposta(o);
    P.streamCompleteWithFallback = async (o) => risposta(o);
  });
}

// L'Aiuto aperto sopra un sito, con una scheda dell'articolo lasciata nella sua casella.
async function gettoneNellAiuto(app, shell, openTab, testServer) {
  const url = testServer.html('<title>Articolo sulla Tesla</title><p>La Tesla Roadster è volata nello spazio su un Falcon Heavy.</p>');
  await openTab(url);
  const sorgente = await idPerUrl(shell, url);
  const sito = await openTab(testServer.html('<title>Un sito</title><p>un sito qualunque'));
  await shell.evaluate((tabId) => window.filoShell.tabs.help(tabId), await davanti(shell));
  const aiuto = await paginaDellAiuto(app, sito);
  await aiuto.waitForSelector('.sn-sidebar-input textarea', { timeout: 8000 });
  const verso = await puntoNelloStrato(app, aiuto, '.sn-sidebar-input textarea');
  await prendi(shell, await linguetta(shell, sorgente));
  await shell.mouse.move(verso.x, verso.y, { steps: 8 });
  await shell.mouse.up();
  await expect(aiuto.locator('.sn-gettoni-fondo .sn-gettone')).toHaveCount(1, { timeout: 5000 });
  return { aiuto, sito, url };
}
async function chiediAllAiuto(aiuto, testo) {
  await aiuto.locator('.sn-sidebar-input textarea').focus();
  await aiuto.keyboard.press('End');
  await aiuto.keyboard.type(testo);
  await aiuto.keyboard.press('Enter');
}

test('#2085 lo scambio dell\'Aiuto, riaperto dalla sua riga nella home, mostra il gettone e non i segni', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(120_000);
  const { aiuto } = await gettoneNellAiuto(app, shell, openTab, testServer);
  await aiutoFinto(app);
  await chiediAllAiuto(aiuto, 'come ha fatto?');
  await expect(aiuto.locator('.sn-sidebar-msg-user .sn-bolla-gettone')).toHaveCount(1, { timeout: 15_000 });
  const nuova = await shell.evaluate(() => window.filoShell.tabs.open('filo://newtab'));
  const casa = await home(app, { scheda: nuova?.id });
  const riga = casa.locator('.dash-riga-app').first();
  await expect(riga).toBeVisible({ timeout: 15_000 });
  await riga.locator('.dash-riga-app-testa').click();
  const domanda = riga.locator('.dash-riga-app-msg-user').filter({ hasText: 'come ha fatto?' });
  await expect(domanda).toBeVisible({ timeout: 10_000 });
  await expect(domanda).not.toContainText('⟦');
  await expect(domanda.locator('.sn-bolla-gettone')).toContainText('Articolo sulla Tesla');
});

test('#2085 nell\'Aiuto la pagina di una scheda lasciata resta nella conversazione anche alla domanda dopo', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(120_000);
  const { aiuto } = await gettoneNellAiuto(app, shell, openTab, testServer);
  await aiutoFinto(app);
  await chiediAllAiuto(aiuto, 'come ha fatto a volare?');
  await expect.poll(() => app.evaluate(() => (globalThis.__visti || []).length), { timeout: 15_000 }).toBeGreaterThan(0);
  await expect(aiuto.getByText('Con un razzo.').first()).toBeVisible({ timeout: 15_000 });
  const prima = await app.evaluate(() => globalThis.__visti.length);
  await chiediAllAiuto(aiuto, 'e chi la ha lanciata?');
  await expect.poll(() => app.evaluate(() => globalThis.__visti.length), { timeout: 15_000 }).toBeGreaterThan(prima);
  const seconda = await app.evaluate(() => JSON.stringify(globalThis.__visti.at(-1)));
  expect(seconda).toContain('e chi la ha lanciata?');
  expect(seconda).toContain('Falcon Heavy');
  // Una volta sola: la cronologia la porta, il messaggio nuovo non la ripete.
  expect(seconda.split('Falcon Heavy').length - 1).toBe(1);
});

test('#2084 lasciata sul campo di un riquadro incorporato, di un altro sito o dello stesso, ci scrive titolo e indirizzo', async ({ app, shell, openTab, testServer }) => {
  const sorgenteUrl = testServer.html('<title>Ricetta del pane</title><p>farina');
  await openTab(sorgenteUrl);
  const sorgente = await idPerUrl(shell, sorgenteUrl);
  for (const pubblico of [true, false]) {
    const dentro = testServer.html('<title>commenti</title><textarea id="t" style="width:300px;height:80px">Commento:</textarea>', { pubblico });
    const pagina = await openTab(testServer.html(`<title>Blog</title><p>articolo</p><iframe src="${dentro}" style="margin:40px;width:400px;height:150px;border:3px solid"></iframe>`));
    let frame = null;
    await expect.poll(async () => {
      frame = pagina.frames().find((f) => f.url() === dentro) || null;
      return frame ? frame.locator('#t').count() : 0;
    }, { timeout: 8000 }).toBe(1);
    const r = await frame.locator('#t').evaluate((el) => { const b = el.getBoundingClientRect(); return { x: b.left + 24, y: b.top + b.height / 2 }; });
    const off = await pagina.locator('iframe').evaluate((f) => { const b = f.getBoundingClientRect(); return { x: b.left + f.clientLeft, y: b.top + f.clientTop }; });
    const base = await puntoInPagina(app, pagina, 'body');
    const corpo = await pagina.locator('body').evaluate((el) => { const b = el.getBoundingClientRect(); return { x: b.left + Math.min(24, b.width / 2), y: b.top + b.height / 2 }; });
    const verso = { x: base.x - corpo.x + off.x + r.x, y: base.y - corpo.y + off.y + r.y };
    await prendi(shell, await linguetta(shell, sorgente));
    await shell.mouse.move(verso.x, verso.y, { steps: 8 });
    await shell.mouse.up();
    await expect.poll(() => frame.locator('#t').inputValue(), { timeout: 5000 }).toContain(sorgenteUrl);
    const valore = await frame.locator('#t').inputValue();
    expect(valore).toContain('Ricetta del pane');
    expect(valore.startsWith('Commento:')).toBe(true);
  }
});

test('#2085 due gettoni con lo stesso nome visibile restano ognuno della sua scheda, anche togliendo il primo', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(90_000);
  const a = testServer.html('<title>Amazon.it: Apple iPhone 15 (128 GB) - Nero</title><p>prodotto A');
  const b = testServer.html('<title>Amazon.it: Apple iPhone 15 Pro (256 GB) - Titanio</title><p>prodotto B');
  await openTab(a);
  await openTab(b);
  const ia = await idPerUrl(shell, a);
  const ib = await idPerUrl(shell, b);
  const casa = (await schede(shell)).find((t) => String(t.url).startsWith('filo://newtab'));
  await attiva(shell, casa.id);
  const page = await home(app);
  await page.locator('#input').fill('confronta');
  for (const [k, id] of [[1, ia], [2, ib]]) {
    const verso = await puntoInPagina(app, page, '#input');
    await prendi(shell, await linguetta(shell, id));
    await shell.mouse.move(verso.x, verso.y, { steps: 8 });
    await shell.mouse.up();
    await expect.poll(async () => (await statoDelCampo(page)).n, { timeout: 5000 }).toBe(k);
  }
  const urls = () => page.evaluate(() => document.getElementById('input')._snGettoni.schede().map((x) => x.url));
  expect(await urls()).toEqual([a, b]);
  await page.evaluate(() => { const t = document.getElementById('input'); const i = t.value.indexOf('⟧') + 1; t.focus(); t.setSelectionRange(i, i); });
  await page.keyboard.press('Backspace');
  await expect.poll(async () => (await urls()).length, { timeout: 5000 }).toBe(1);
  expect(await urls()).toEqual([b]);
});

test('#2084 Esc a metà trascinamento, o la finestra che perde il fuoco, rimettono tutto com\'era', async ({ shell, openTab, testServer }) => {
  await openTab(testServer.html('<title>Uno</title><p>uno'));
  await openTab(testServer.html('<title>Due</title><p>due'));
  const prima = await ordine(shell);
  const mossa = prima[1];
  for (const annulla of [
    () => shell.keyboard.press('Escape'),
    () => shell.evaluate(() => window.dispatchEvent(new Event('blur'))),
  ]) {
    const da = await linguetta(shell, mossa);
    const ultima = await linguetta(shell, prima.at(-1));
    await prendi(shell, da);
    await shell.mouse.move(ultima.right - 4, da.y, { steps: 6 });
    await expect.poll(() => shell.evaluate((i) => document.querySelector(`.tab[data-id="${i}"]`).classList.contains('dragging'), mossa)).toBe(true);
    await annulla();
    expect(await shell.evaluate((i) => document.querySelector(`.tab[data-id="${i}"]`).classList.contains('dragging'), mossa)).toBe(false);
    await shell.mouse.up();
    await shell.waitForTimeout(400);
    expect(await ordine(shell)).toEqual(prima);
  }
});

test('#2085 la tredicesima scheda in un messaggio resta fuori e lo si dice', async ({ app, shell, openTab, testServer }) => {
  const { page, sorgente } = await gettoneNellaHome(app, shell, openTab, testServer);
  await page.evaluate(() => {
    const G = document.getElementById('input')._snGettoni;
    for (let i = 0; i < 11; i++) G.aggiungi({ id: `x${i}`, titolo: `Pagina ${i}`, url: `https://esempio.it/${i}` });
    globalThis.__avvisi = [];
    const mostra = globalThis.SN_POPUP.showToast;
    globalThis.SN_POPUP.showToast = (t, ...r) => { globalThis.__avvisi.push(String(t)); return mostra.call(globalThis.SN_POPUP, t, ...r); };
  });
  expect((await statoDelCampo(page)).n).toBe(12);
  const verso = await puntoInPagina(app, page, '#input');
  await prendi(shell, await linguetta(shell, sorgente));
  await shell.mouse.move(verso.x, verso.y, { steps: 8 });
  await shell.mouse.up();
  await expect.poll(() => page.evaluate(() => globalThis.__avvisi.join(' ')), { timeout: 5000 }).toContain('al massimo 12 schede');
  expect((await statoDelCampo(page)).n).toBe(12);
});

// Col mouse vero del sistema: il puntatore passa sopra la pagina (un'altra vista) e la barra deve seguirlo lo stesso.
test.describe('col mouse vero', () => {
  test.skip(!Gesti.disponibili(), 'servono un display X e XTest (lo schermo virtuale delle prove su Linux)');

  async function sulloSchermoLaLinguetta(app, shell, id) {
    const r = await linguetta(shell, id);
    const o = await app.evaluate(({ BrowserWindow }) => {
      const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x.isDestroyed() && !x._filoIncognito);
      const cb = w.getContentBounds();
      return { x: cb.x, y: cb.y, z: w.webContents.getZoomFactor() || 1 };
    });
    return { x: Math.round(o.x + r.x * o.z), y: Math.round(o.y + r.y * o.z), right: Math.round(o.x + r.right * o.z) };
  }

  test('#2084 una scheda portata col mouse vero nel campo della home diventa un gettone', async ({ app, shell, openTab, testServer }) => {
    const url = testServer.html('<title>Articolo sulla Tesla</title><p>Falcon Heavy</p>');
    await openTab(url);
    const sorgente = await idPerUrl(shell, url);
    const casa = (await schede(shell)).find((t) => String(t.url).startsWith('filo://newtab'));
    await attiva(shell, casa.id);
    const page = await home(app);
    await Gesti.finestraASchermo(app);
    const campo = await Gesti.sulloSchermo(app, page, page, '#input');
    Gesti.trascina(await sulloSchermoLaLinguetta(app, shell, sorgente), campo);
    await expect(page.locator('.sn-gettoni-fondo .sn-gettone')).toContainText('Articolo sulla Tesla', { timeout: 5000 });
  });

  test('#2084 col mouse vero: sopra la pagina e di nuovo nella fila il trascinamento continua, e un campo del sito riceve il link', async ({ app, shell, openTab, testServer }) => {
    const sorgenteUrl = testServer.html('<title>Ricetta del pane</title><p>farina');
    await openTab(sorgenteUrl);
    const sito = await openTab(testServer.html('<title>Modulo</title><textarea id="t" style="margin:120px 80px;width:400px;height:120px">Guarda:</textarea>'));
    const prima = await ordine(shell);
    const sorgente = await idPerUrl(shell, sorgenteUrl);
    await Gesti.finestraASchermo(app);
    const da = await sulloSchermoLaLinguetta(app, shell, sorgente);
    const ultima = await sulloSchermoLaLinguetta(app, shell, prima.at(-1));
    // Giù sopra la pagina, poi in fondo alla fila: la scheda finisce ultima.
    Gesti.trascina(da, { x: da.x + 40, y: da.y + 300 }, { x: ultima.right - 6, y: da.y });
    await expect.poll(async () => (await ordine(shell)).at(-1), { timeout: 8000 }).toBe(sorgente);
    // Fino al campo del sito: ci scrive titolo e indirizzo.
    const campo = await Gesti.sulloSchermo(app, sito, sito, '#t');
    Gesti.trascina(await sulloSchermoLaLinguetta(app, shell, sorgente), campo);
    await expect.poll(() => sito.locator('#t').inputValue(), { timeout: 5000 }).toContain(sorgenteUrl);
    expect(await sito.locator('#t').inputValue()).toContain('Ricetta del pane');
  });
});
