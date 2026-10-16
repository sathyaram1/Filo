// #844 giro 2 — esplorazione: due rimozioni annullate in ordine inverso, l'ultima pagina, la ricerca, titoli strani.

import { test, expect } from '../../fixtures/electron.mjs';

const HOME = 'filo://home/home.html';
const ORA = Date.parse('2026-10-10T10:00:00Z');

function voce(id, ore, extra = {}) {
  return {
    id, url: `https://esempio-${id}.example/x`, title: `Pagina ${id.toUpperCase()}`, favicon: '', thumbnail: '',
    savedAt: new Date(ORA - ore * 3600e3).toISOString(), categoryId: null, category: null, ...extra,
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
const scheda = (home, id) => home.locator(`#grid .sn-card[data-page-id="${id}"]`);
const avvisi = (home) => home.locator('.home-annulla:not([data-sn-closing])');

test('due rimozioni, annullate al contrario, rimettono ordine e date', async ({ openTab }) => {
  const home = await openTab(HOME);
  const pagine = [voce('a', 1), voce('b', 2), voce('c', 3), voce('d', 4)];
  await semina(home, { pagine });
  await scheda(home, 'b').locator('.sn-card-action').click();
  await scheda(home, 'c').locator('.sn-card-action').click();
  await expect(avvisi(home)).toHaveCount(2);
  await home.screenshot({ path: 'tests/.shots/v844-due-avvisi.png' });
  await avvisi(home).filter({ hasText: 'Pagina B' }).locator('.home-annulla-btn').click();
  await avvisi(home).filter({ hasText: 'Pagina C' }).locator('.home-annulla-btn').click();
  await expect.poll(async () => (await salvate(home)).map((p) => p.id)).toEqual(['a', 'b', 'c', 'd']);
  expect(await salvate(home)).toEqual(pagine);
  await expect(home.locator('#grid .sn-card')).toHaveCount(4);
});

test('l\'ultima pagina tolta e rimessa, con la ricerca attiva', async ({ openTab }) => {
  const home = await openTab(HOME);
  await semina(home, { pagine: [voce('a', 1), voce('b', 2)], tema: 'dark' });
  await home.locator('#search').fill('pagina b');
  await expect(home.locator('#grid .sn-card')).toHaveCount(1);
  await scheda(home, 'b').click({ button: 'right' });
  await home.locator('.home-ctxmenu .sn-select-option', { hasText: 'Rimuovi' }).click();
  await expect(home.locator('#empty')).toBeVisible();
  await avvisi(home).locator('.home-annulla-btn').click();
  await expect(scheda(home, 'b')).toBeVisible();
  await expect(home.locator('#empty')).toBeHidden();
});

test('titolo lunghissimo con markup ed emoji nell\'avviso e nel menu', async ({ openTab }) => {
  const home = await openTab(HOME);
  const lungo = '<img src=x onerror="window.__rotto=1"> 🍕🍕 ' + 'parola '.repeat(80);
  const CAT = { id: 'c1', name: '🍕 ' + 'categoria lunghissima '.repeat(10) };
  await semina(home, { pagine: [voce('a', 1, { title: lungo }), voce('b', 2)], categorie: [CAT], categorizza: true, tema: 'dark' });
  await home.locator('#grid .sn-cat-tile').first().click();
  await scheda(home, 'a').click({ button: 'right' });
  await home.locator('.home-ctxmenu .sn-select-option', { hasText: 'Sposta in…' }).click();
  await home.screenshot({ path: 'tests/.shots/v844-sposta-lungo-scuro.png' });
  const box = await home.locator('.home-ctxmenu').boundingBox();
  const vw = home.viewportSize()?.width ?? (await home.evaluate(() => innerWidth));
  expect(box.x + box.width).toBeLessThanOrEqual(vw);
  await home.keyboard.press('Escape');
  await scheda(home, 'a').locator('.sn-card-action').click();
  await expect(avvisi(home)).toBeVisible();
  await home.screenshot({ path: 'tests/.shots/v844-avviso-lungo-scuro.png' });
  expect(await home.evaluate(() => window.__rotto)).toBeUndefined();
  const ab = await avvisi(home).boundingBox();
  expect(ab.x).toBeGreaterThanOrEqual(0);
});
