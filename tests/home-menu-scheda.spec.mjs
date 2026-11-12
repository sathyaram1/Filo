// #844 — In «Aperti per dopo» il tasto destro su una pagina salvata apre il SUO menu (non quello generale di
// Filo): Apri, Apri e tienila in lista, Copia link, Sposta in… (con le categorie, più «Nuova categoria…»),
// Rimuovi con «Annulla» che la rimette dov'era. Lo stesso menu si apre e si percorre da tastiera.

import { test, expect } from './fixtures/electron.mjs';
import { menuDi } from './helpers/menuContestuale.mjs';

const HOME = 'filo://home/home.html';
const ORA = Date.parse('2026-10-10T10:00:00Z');

function voce(id, url, ore, categoria) {
  return {
    id, url, title: `Pagina ${id.toUpperCase()}`, favicon: '', thumbnail: '',
    savedAt: new Date(ORA - ore * 3600e3).toISOString(),
    categoryId: categoria ? categoria.id : null, category: categoria ? categoria.name : null,
  };
}

async function semina(home, { pagine, categorie = [], categorizza = false, tema = 'light' }) {
  await home.evaluate(async ({ pagine: p, categorie: c, categorizza: k, tema: t }) => {
    await chrome.storage.local.set({ savedPages: p, categories: c });
    await window.SN_STORAGE.updateSettings({ theme: t, featureFlags: { categorize: k } });
  }, { pagine, categorie, categorizza, tema });
  await home.reload();
  await home.waitForLoadState('domcontentloaded');
}

const salvate = (home) => home.evaluate(async () => (await chrome.storage.local.get('savedPages')).savedPages || []);
const vociMenu = (home) => home.locator('.home-ctxmenu .sn-select-option').allTextContents();
const scheda = (home, id) => home.locator(`#grid .sn-card[data-page-id="${id}"]`);
// Un avviso chiuso resta nel documento il tempo della dissolvenza.
const annullaVivo = (home) => home.locator('.home-annulla:not([data-sn-closing]) .home-annulla-btn');
const riquadro = (home, nome) => home.locator('#grid .sn-cat-tile', { hasText: nome });

test('tasto destro con le categorie: copia link, sposta, nuova categoria, rimuovi e Annulla, apri e tienila', async ({ app, shell, openTab, testServer }) => {
  const VIDEO = { id: 'c-video', name: 'Video da guardare' };
  const RICETTE = { id: 'c-ricette', name: 'Ricette' };
  const url = { a: testServer.html('<title>A</title><p>A</p>'), b: testServer.html('<title>B</title><p>B</p>'), c: testServer.html('<title>C</title><p>C</p>') };
  const home = await openTab(HOME);
  // «d» punta a una categoria eliminata: sta fra le non categorizzate invece di sparire.
  await semina(home, {
    pagine: [voce('a', url.a, 1), voce('b', url.b, 2, VIDEO), voce('c', url.c, 3), voce('d', 'https://altro.example/d', 4, { id: 'c-sparita', name: 'Sparita' })],
    categorie: [VIDEO, RICETTE],
    categorizza: true,
  });

  // Fuori da una scheda il tasto destro resta quello di Filo: è la prova che sulla scheda non lo è.
  await home.locator('#title').click({ button: 'right' });
  await expect(menuDi(home).locator('.sn-menu').first()).toBeVisible();
  await home.keyboard.press('Escape');
  await expect(menuDi(home).locator('.sn-menu:visible')).toHaveCount(0);

  await riquadro(home, 'Da vedere').click();
  await expect(home.locator('#grid .sn-card')).toHaveCount(3);

  await scheda(home, 'a').click({ button: 'right' });
  await expect(home.locator('.home-ctxmenu')).toBeVisible();
  expect(await vociMenu(home)).toEqual(['Apri', 'Apri e tienila in lista', 'Copia link', 'Sposta in…', 'Rimuovi']);
  await expect(menuDi(home).locator('.sn-menu:visible')).toHaveCount(0);
  await home.screenshot({ path: 'tests/.shots/home-menu-scheda.png' }).catch(() => {});

  // Copia link → negli appunti c'è l'indirizzo.
  await home.locator('.home-ctxmenu .sn-select-option', { hasText: 'Copia link' }).click();
  await expect.poll(() => app.evaluate(({ clipboard }) => clipboard.readText())).toBe(url.a);
  await expect(home.locator('.home-ctxmenu')).toHaveCount(0);

  // Sposta in… → le categorie che ci sono, più «Nuova categoria…»; la pagina passa nel riquadro nuovo.
  await scheda(home, 'a').click({ button: 'right' });
  await home.locator('.home-ctxmenu .sn-select-option', { hasText: 'Sposta in…' }).click();
  expect(await vociMenu(home)).toEqual(['Ricette', 'Video da guardare', 'Nuova categoria…']);
  await home.screenshot({ path: 'tests/.shots/home-menu-sposta.png' }).catch(() => {});
  await home.locator('.home-ctxmenu .sn-select-option', { hasText: 'Video da guardare' }).click();
  await expect(scheda(home, 'a')).toHaveCount(0);
  await expect(scheda(home, 'c')).toBeVisible();
  await home.locator('#back').click();
  await expect(riquadro(home, 'Video da guardare').locator('.sn-cat-tile-count')).toHaveText('2');
  await expect(riquadro(home, 'Da vedere').locator('.sn-cat-tile-count')).toHaveText('2');

  // Nuova categoria… → si scrive il nome, Invio: nasce il riquadro con la pagina dentro.
  await riquadro(home, 'Video da guardare').click();
  await scheda(home, 'a').click({ button: 'right' });
  await home.locator('.home-ctxmenu .sn-select-option', { hasText: 'Sposta in…' }).click();
  // Da una categoria si può anche tornare fra le non categorizzate.
  expect(await vociMenu(home)).toEqual(['Ricette', 'Da vedere', 'Nuova categoria…']);
  await home.locator('.home-ctxmenu .sn-select-option', { hasText: 'Nuova categoria…' }).click();
  const campo = home.locator('.home-ctxmenu .home-campo');
  await expect(campo).toBeFocused();
  await campo.fill('Da leggere <b>stasera</b>');
  await home.screenshot({ path: 'tests/.shots/home-menu-nuova-categoria.png' }).catch(() => {});
  await campo.press('Enter');
  await expect(scheda(home, 'a')).toHaveCount(0);
  await home.locator('#back').click();
  await expect(riquadro(home, 'Da leggere <b>stasera</b>').locator('.sn-cat-tile-count')).toHaveText('1');
  await expect(home.locator('#grid b')).toHaveCount(0);

  // Rimuovi → la categoria rimasta vuota sparisce; «Annulla» rimette la pagina dov'era, con data e categoria.
  const prima = (await salvate(home)).find((p) => p.id === 'a');
  await riquadro(home, 'Da leggere').click();
  await scheda(home, 'a').click({ button: 'right' });
  await home.locator('.home-ctxmenu .sn-select-option', { hasText: 'Rimuovi' }).click();
  await expect(riquadro(home, 'Da leggere')).toHaveCount(0);
  expect((await salvate(home)).some((p) => p.id === 'a')).toBe(false);
  const annulla = home.locator('.home-annulla');
  await expect(annulla).toBeVisible();
  await expect(annulla).toContainText('«Pagina A» rimossa.');
  await expect(annulla).toHaveCSS('opacity', '1');
  await home.screenshot({ path: 'tests/.shots/home-annulla.png' }).catch(() => {});
  await annulla.locator('.home-annulla-btn').click();
  await expect(riquadro(home, 'Da leggere').locator('.sn-cat-tile-count')).toHaveText('1');
  const rimessa = await salvate(home);
  expect(rimessa.map((p) => p.id)).toEqual(['a', 'b', 'c', 'd']);
  expect(rimessa[0]).toEqual(prima);

  // Una «Nuova categoria…» col nome delle non categorizzate porta lì, senza un secondo riquadro uguale.
  await riquadro(home, 'Video da guardare').click();
  await scheda(home, 'b').click({ button: 'right' });
  await home.locator('.home-ctxmenu .sn-select-option', { hasText: 'Sposta in…' }).click();
  await home.locator('.home-ctxmenu .sn-select-option', { hasText: 'Nuova categoria…' }).click();
  await home.locator('.home-ctxmenu .home-campo').fill('da vedere');
  await home.locator('.home-ctxmenu .home-campo').press('Enter');
  await expect(riquadro(home, 'Video da guardare')).toHaveCount(0);
  await expect(riquadro(home, 'Da vedere')).toHaveCount(1);
  await expect(riquadro(home, 'Da vedere').locator('.sn-cat-tile-count')).toHaveText('3');

  // Apri e tienila in lista → la pagina si apre in una scheda e resta fra le salvate.
  await riquadro(home, 'Da leggere').click();
  await scheda(home, 'a').click({ button: 'right' });
  await home.locator('.home-ctxmenu .sn-select-option', { hasText: 'Apri e tienila in lista' }).click();
  await expect.poll(async () => shell.evaluate(async (u) => {
    const snap = await window.filoShell.tabs.snapshot();
    return snap.tabs.some((t) => t.url === u);
  }, url.a), { timeout: 8_000 }).toBe(true);
  expect((await salvate(home)).some((p) => p.id === 'a')).toBe(true);
  await expect(scheda(home, 'a')).toHaveCount(1);
});

test('da tastiera: Maiusc+F10 e il tasto Menu aprono il menu, le frecce scelgono, Invio esegue, Annulla si raggiunge', async ({ shell, openTab, testServer }) => {
  const url = { a: testServer.html('<title>A</title><p>A</p>'), b: testServer.html('<title>B</title><p>B</p>') };
  const home = await openTab(HOME);
  await semina(home, { pagine: [voce('a', url.a, 1), voce('b', url.b, 2)], tema: 'dark' });
  await expect(home.locator('#grid .sn-card')).toHaveCount(2);

  // Senza categorie «Sposta in…» non c'è.
  await scheda(home, 'a').focus();
  await home.keyboard.press('Shift+F10');
  await expect(home.locator('.home-ctxmenu')).toBeVisible();
  expect(await vociMenu(home)).toEqual(['Apri', 'Apri e tienila in lista', 'Copia link', 'Rimuovi']);
  await home.keyboard.press('ArrowDown');
  await expect(home.locator('.home-ctxmenu .sn-select-option').first()).toBeFocused();
  await home.screenshot({ path: 'tests/.shots/home-menu-scheda-scuro.png' }).catch(() => {});
  await home.keyboard.press('Escape');
  await expect(home.locator('.home-ctxmenu')).toHaveCount(0);
  await expect(scheda(home, 'a')).toBeFocused();

  // Tasto Menu, Fine → «Rimuovi», Invio: la scheda va via e il fuoco passa ad «Annulla».
  await home.keyboard.press('ContextMenu');
  await expect(home.locator('.home-ctxmenu')).toBeVisible();
  await home.keyboard.press('End');
  await expect(home.locator('.home-ctxmenu .sn-select-option', { hasText: 'Rimuovi' })).toBeFocused();
  await home.keyboard.press('Enter');
  await expect(scheda(home, 'a')).toHaveCount(0);
  await expect(annullaVivo(home)).toBeFocused();
  await expect(home.locator('.home-annulla')).toHaveCSS('opacity', '1');
  await home.screenshot({ path: 'tests/.shots/home-annulla-scuro.png' }).catch(() => {});

  // Invio su «Annulla» la rimette e le dà il fuoco.
  await home.keyboard.press('Enter');
  await expect(scheda(home, 'a')).toBeFocused();
  expect((await salvate(home)).map((p) => p.id)).toEqual(['a', 'b']);

  // Invio sul «Rimuovi» della scheda rimuove, non apre; Esc lascia l'avviso e torna all'elenco.
  await scheda(home, 'b').locator('.sn-card-action').focus();
  await home.keyboard.press('Enter');
  await expect(scheda(home, 'b')).toHaveCount(0);
  await expect(annullaVivo(home)).toBeFocused();
  await home.keyboard.press('Escape');
  await expect(scheda(home, 'a')).toBeFocused();
  await expect(home.locator('.home-annulla')).toHaveCount(0);
  expect((await salvate(home)).map((p) => p.id)).toEqual(['a']);
  await expect.poll(async () => shell.evaluate(async (u) => (await window.filoShell.tabs.snapshot()).tabs.some((t) => t.url === u), url.b)).toBe(false);

  // «Apri» dal menu: come il clic, la apre e la toglie dalla lista. La lettera A porta alla prima voce con la A.
  await scheda(home, 'a').focus();
  await home.keyboard.press('Shift+F10');
  await home.keyboard.press('a');
  await expect(home.locator('.home-ctxmenu .sn-select-option', { hasText: /^Apri$/ })).toBeFocused();
  await home.keyboard.press('Enter');
  await expect.poll(async () => shell.evaluate(async (u) => (await window.filoShell.tabs.snapshot()).tabs.some((t) => t.url === u), url.a), { timeout: 8_000 }).toBe(true);
  await expect.poll(async () => (await salvate(home)).length).toBe(0);
});

test('in una lista lunga «Annulla» è sotto le dita di chi usa la tastiera e non scade finché ha il fuoco; col mouse il fuoco resta dov’era', async ({ openTab }) => {
  const home = await openTab(HOME);
  const pagine = Array.from({ length: 12 }, (_, i) => voce(`p${i + 1}`, `https://esempio${i + 1}.example/x`, i + 1));
  await semina(home, { pagine });
  await expect(home.locator('#grid .sn-card')).toHaveCount(12);

  await scheda(home, 'p1').focus();
  await home.keyboard.press('Shift+F10');
  await home.keyboard.press('End');
  await home.keyboard.press('Enter');
  await expect(scheda(home, 'p1')).toHaveCount(0);
  await expect(annullaVivo(home)).toBeFocused();
  // Oltre i sette secondi dell'avviso: col fuoco sopra resta.
  await home.waitForTimeout(8_000);
  await expect(annullaVivo(home)).toBeFocused();
  await home.keyboard.press('Enter');
  await expect(scheda(home, 'p1')).toBeFocused();
  expect((await salvate(home)).map((p) => p.id)).toEqual(pagine.map((p) => p.id));

  await home.locator('#search').focus();
  await scheda(home, 'p3').locator('.sn-card-action').click();
  await expect(scheda(home, 'p3')).toHaveCount(0);
  await expect(home.locator('.home-annulla:not([data-sn-closing])')).toBeVisible();
  await expect(annullaVivo(home)).not.toBeFocused();
});
