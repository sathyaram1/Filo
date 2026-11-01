// #1434 — la fila in cima al tasto destro è contestuale: sul testo che si scrive grassetto e corsivo (e il clic li
// mette), su un'immagine le sue azioni, nessuna azione della pagina intera di partenza; il «+» tiene le altre, un'icona
// portata dal «+» alla fila resta dopo il riavvio e «rimetti come prima» la riporta indietro; dalla barra si porta
// un'icona nella fila e dalla fila alla barra.

import { test, expect, argomentiScala, chiudiApp } from './fixtures/electron.mjs';
import { _electron as electron } from '@playwright/test';
import { rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cartellaTemporanea } from './helpers/percorsi.mjs';
import { primaFinestra } from './helpers/primaFinestra.mjs';
import { menuDi } from './helpers/menuContestuale.mjs';
import { barraPage, statoBarra, comandaBarra, pannelloFermo } from './helpers/barra.mjs';
import { home, modelloFinto, chiedi } from './helpers/chatFinta.mjs';

const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const pausa = (ms) => new Promise((r) => setTimeout(r, ms));

// Un'immagine vera, servita dal sito: le sue azioni la scaricano coi byte che ha.
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFklEQVQImWP8z8DwnwEJMDKgAQYGAH8IBAFwbpVFAAAAAElFTkSuQmCC', 'base64');
const SITO = (img) => `<!doctype html><html><head><title>Fila</title></head>
  <body style="margin:0;padding:40px;font:16px sans-serif;height:1200px">
  <p id="testo">Un paragrafo di prova da selezionare col mouse.</p>
  <img id="foto" src="${img}" width="160" height="120" alt="foto">
  <p><a id="vai" href="https://esempio.it/pagina">un collegamento</a></p>
  <div id="vuoto" style="height:200px"></div>
  </body></html>`;

// La disposizione salvata, letta dalla porta del main.
const salvata = (app) => app.evaluate(async () => globalThis.SN_LAYOUT_ICONE.leggi());
const iconeDellaFila = (menu) => menu.locator('.sn-menu-row .sn-menu-row-btn[data-sn-icon-id]')
  .evaluateAll((els) => els.map((e) => e.dataset.snIconId));
// Il registro dei cambi dalla sua porta (#1561).
const registro = (app) => app.evaluate(async () => {
  await globalThis.SN_REGISTRO_CAMBI.attesa();
  return globalThis.SN_REGISTRO_CAMBI.lista();
});

async function selezionaTesto(page, sel) {
  await page.evaluate((s) => {
    const el = document.querySelector(s);
    const r = document.createRange();
    r.selectNodeContents(el.firstChild || el);
    const g = getSelection();
    g.removeAllRanges();
    g.addRange(r);
  }, sel);
}

test('nell\'Editor sul testo selezionato la fila ha grassetto e corsivo, e il clic li mette e restano', async ({ app, openTab }) => {
  const editor = await openTab('filo://editor/editor.html');
  await editor.waitForSelector('#doc');
  await editor.locator('#doc').click();
  await editor.keyboard.type('Parola importante qui');
  await editor.evaluate(() => {
    const doc = document.getElementById('doc');
    const t = [...doc.querySelectorAll('*'), doc].map((n) => [...n.childNodes].find((c) => c.nodeType === 3 && c.nodeValue.includes('importante'))).find(Boolean);
    const i = t.nodeValue.indexOf('importante');
    const r = document.createRange();
    r.setStart(t, i);
    r.setEnd(t, i + 'importante'.length);
    getSelection().removeAllRanges();
    getSelection().addRange(r);
  });
  const box = await editor.evaluate(() => { const r = getSelection().getRangeAt(0).getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
  await editor.mouse.click(box.x, box.y, { button: 'right' });
  const menu = menuDi(editor);
  const fila = menu.locator('.sn-menu-row');
  await expect(fila).toBeVisible();
  const ids = await iconeDellaFila(menu);
  expect(ids.slice(0, 2)).toEqual(['scrivibile:bold', 'scrivibile:italic']);
  expect(ids.every((id) => id.startsWith('scrivibile:')), 'nessuna azione della pagina intera di partenza').toBe(true);
  // La fila sta in cima, sopra le voci di sempre, che restano.
  expect(await menu.principale.evaluate((m) => m.firstElementChild.classList.contains('sn-menu-row'))).toBe(true);
  await expect(menu.voce('Taglia')).toBeVisible();
  await expect(fila.locator('.sn-menu-row-overflow')).toBeVisible();

  await fila.locator('[data-sn-icon-id="scrivibile:bold"]').click();
  await expect(menu.pannelli).toHaveCount(0);
  await expect.poll(() => editor.evaluate(() => !!document.querySelector('#doc b, #doc strong') && document.querySelector('#doc b, #doc strong').textContent)).toBe('importante');

  // Il corsivo sulla stessa selezione, rimasta dov'era.
  await editor.mouse.click(box.x, box.y, { button: 'right' });
  await menuDi(editor).locator('.sn-menu-row [data-sn-icon-id="scrivibile:italic"]').click();
  await expect.poll(() => editor.evaluate(() => document.querySelector('#doc i, #doc em')?.textContent || '')).toBe('importante');
});

test('su un\'immagine la fila ha le sue azioni, e il «+» le altre; sul testo di una pagina copia, traduci e cerca', async ({ openTab, testServer }) => {
  const img = testServer.asset(PNG, 'image/png');
  const page = await testServer.openReady(openTab, SITO(img));
  await page.locator('#foto').click({ button: 'right' });
  const menu = menuDi(page);
  await expect(menu.locator('.sn-menu-row')).toBeVisible();
  expect(await iconeDellaFila(menu)).toEqual(['immagine:save', 'immagine:copy', 'immagine:ask']);
  await expect(menu.locator('.sn-menu-row [data-sn-icon-id="immagine:save"]')).toHaveAttribute('aria-label', /Salva immagine/);
  await menu.locator('.sn-menu-row .sn-menu-row-overflow').click();
  const griglia = menu.locator('.sn-menu-icon-grid');
  await expect(griglia).toBeVisible();
  expect(await griglia.locator('[data-sn-icon-id]').evaluateAll((els) => els.map((e) => e.dataset.snIconId))).toEqual(['immagine:copyLink', 'immagine:search']);
  await page.keyboard.press('Escape');
  await expect(menu.pannelli).toHaveCount(0);

  await selezionaTesto(page, '#testo');
  const r = await page.locator('#testo').boundingBox();
  await page.mouse.click(r.x + 30, r.y + r.height / 2, { button: 'right' });
  await expect(menu.locator('.sn-menu-row')).toBeVisible();
  expect(await iconeDellaFila(menu)).toEqual(['testo:copy', 'testo:translate', 'testo:search']);
  await page.keyboard.press('Escape');

  // Niente sotto il mouse: la fila della pagina è vuota di partenza, e non si vede.
  await page.locator('#vuoto').click({ button: 'right' });
  await expect(menu.principale).toBeVisible();
  await expect(menu.locator('.sn-menu-row')).toBeHidden();
});
