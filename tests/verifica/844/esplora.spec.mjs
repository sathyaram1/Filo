import { test, expect } from '../../fixtures/electron.mjs';

const HOME = 'filo://home/home.html';
const ORA = Date.parse('2026-10-10T10:00:00Z');
const voce = (i, cat) => ({
  id: `p${i}`, url: `https://esempio${i}.example/x`, title: `Pagina ${i}`, favicon: '', thumbnail: '',
  savedAt: new Date(ORA - i * 3600e3).toISOString(), categoryId: cat ? cat.id : null, category: cat ? cat.name : null,
});
async function semina(home, { pagine, categorie = [], categorizza = false, tema = 'light' }) {
  await home.evaluate(async ({ p, c, k, t }) => {
    await chrome.storage.local.set({ savedPages: p, categories: c });
    await window.SN_STORAGE.updateSettings({ theme: t, featureFlags: { categorize: k } });
  }, { p: pagine, c: categorie, k: categorizza, t: tema });
  await home.reload();
  await home.waitForLoadState('domcontentloaded');
}
const ids = (home) => home.evaluate(async () => ((await chrome.storage.local.get('savedPages')).savedPages || []).map((p) => p.id));
const scheda = (home, id) => home.locator(`#grid .sn-card[data-page-id="${id}"]`);

test('cinque rimozioni di fila, cinque Annulla: tornano tutte in ordine', async ({ openTab }) => {
  const home = await openTab(HOME);
  const pagine = Array.from({ length: 6 }, (_, i) => voce(i + 1));
  await semina(home, { pagine });
  for (const i of [1, 2, 3, 4, 5]) await scheda(home, `p${i}`).locator('.sn-card-action').click();
  await expect(home.locator('#grid .sn-card')).toHaveCount(1);
  const n = await home.locator('.home-annulla').count();
  await home.screenshot({ path: 'tests/.shots/v844-cinque-annulla.png' });
  console.log('avvisi Annulla visibili', n);
  for (const b of await home.locator('.home-annulla-btn').all()) await b.click();
  await expect.poll(() => ids(home)).toEqual(['p1', 'p2', 'p3', 'p4', 'p5', 'p6']);
});

test('da tastiera, in una lista normale, Annulla si raggiunge prima che sparisca', async ({ openTab }) => {
  const home = await openTab(HOME);
  await semina(home, { pagine: Array.from({ length: 12 }, (_, i) => voce(i + 1)) });
  await scheda(home, 'p1').focus();
  await home.keyboard.press('Shift+F10');
  await expect(home.locator('.home-ctxmenu')).toBeVisible();
  expect(await home.locator('.sn-menu:visible').count()).toBe(0);
  await home.keyboard.press('End');
  await home.keyboard.press('Enter');
  await expect(scheda(home, 'p1')).toHaveCount(0);
  let tab = 0;
  for (; tab < 40; tab++) {
    if (await home.evaluate(() => document.activeElement?.classList.contains('home-annulla-btn'))) break;
    await home.keyboard.press('Tab');
  }
  console.log('Tab per arrivare ad Annulla', tab);
  // Ctrl+Z come strada corta?
  await scheda(home, 'p2').focus();
  await home.keyboard.press('Control+z');
  await home.waitForTimeout(500);
  console.log('dopo Ctrl+Z', (await ids(home)).includes('p1'));
  expect(tab).toBeLessThan(6);
});

test('Maiusc+F10 sul Rimuovi della scheda', async ({ openTab }) => {
  const home = await openTab(HOME);
  await semina(home, { pagine: [voce(1), voce(2)] });
  await scheda(home, 'p1').locator('.sn-card-action').focus();
  await home.keyboard.press('Shift+F10');
  await home.waitForTimeout(400);
  console.log('menu scheda', await home.locator('.home-ctxmenu').count(), 'menu Filo', await home.locator('.sn-menu:visible').count());
});

test('ricerca attiva: rimuovi e Annulla, nomi lunghi nel Sposta in, tema scuro', async ({ openTab }) => {
  const home = await openTab(HOME);
  const LUNGA = { id: 'c-l', name: 'Una categoria dal nome lunghissimo 🍕🍕 che non finisce mai e poi mai davvero no' };
  const B = { id: 'c-b', name: '<img src=x onerror=alert(1)>' };
  await semina(home, { pagine: [voce(1), voce(2), voce(3)], categorie: [LUNGA, B], tema: 'dark' });
  await home.locator('#search').fill('Pagina 2');
  await expect(home.locator('#grid .sn-card')).toHaveCount(1);
  await scheda(home, 'p2').click({ button: 'right' });
  await home.locator('.home-ctxmenu .sn-select-option', { hasText: 'Sposta in…' }).click();
  await home.screenshot({ path: 'tests/.shots/v844-sposta-lunga-scuro.png' });
  await home.keyboard.press('Escape');
  await scheda(home, 'p2').click({ button: 'right' });
  await home.locator('.home-ctxmenu .sn-select-option', { hasText: 'Rimuovi' }).click();
  await expect(home.locator('#empty')).toBeVisible();
  await home.locator('.home-annulla-btn').click();
  await expect(scheda(home, 'p2')).toBeVisible();
  await expect(home.locator('#search')).toHaveValue('Pagina 2');
  // Sposta nella vista a lista (categorie spente): la pagina finisce lì e lo si dice.
  await scheda(home, 'p2').click({ button: 'right' });
  await home.locator('.home-ctxmenu .sn-select-option', { hasText: 'Sposta in…' }).click();
  await home.locator('.home-ctxmenu .sn-select-option').first().click();
  await expect.poll(async () => (await home.evaluate(async () => (await chrome.storage.local.get('savedPages')).savedPages.find((p) => p.id === 'p2').categoryId))).toBeTruthy();
  await home.screenshot({ path: 'tests/.shots/v844-spostata-lista.png' });
});
