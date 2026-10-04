// Prova del giro 1 (verifica locale, letture-delta): quando il giro dei cambiati avvisa (lettura interrotta,
// seguiti sopra il tetto, registro illeggibile) l'intestazione della lista deve mostrarlo, non solo nel title.

import { test, expect } from '../../fixtures/electron.mjs';

const URL = 'filo://manage/manage.html';

test('un avviso del giro si vede sull\'intestazione della lista, senza passarci sopra', async ({ openTab }) => {
  const page = await openTab(URL);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__mgTest && window.__mgTest.whenReady);
  await page.evaluate(() => window.__mgTest.whenReady());
  await page.evaluate(() => {
    window.__mgTest.setData([{ _id: 'a1', _updateTime: 't1', name: 'Uno', text: 'x', seq: 1, subSeq: 0, status: 'design', createdAt: '2026-09-01T10:00:00Z' }]);
    window.__mgTest.setTab('inbox');
  });
  const head = page.locator('#mgListHead');
  const prima = await head.evaluate((el) => ({
    testo: el.innerText,
    dopo: getComputedStyle(el, '::after').content,
    colore: getComputedStyle(el).color,
    opacita: getComputedStyle(el).opacity,
  }));
  await page.evaluate(() => window.__mgTest.liveMessage({ kind: 'changed', rows: [], avvisi: ['cambiati: troppe pagine, riallineamento completo al giro dopo'] }));
  await expect(head).toHaveClass(/mg-list-head--avviso/);
  const dopo = await head.evaluate((el) => ({
    testo: el.innerText,
    dopo: getComputedStyle(el, '::after').content,
    colore: getComputedStyle(el).color,
    opacita: getComputedStyle(el).opacity,
  }));
  expect(dopo, 'l\'avviso resta nel solo title: a vista l\'intestazione è identica').not.toEqual(prima);
});
