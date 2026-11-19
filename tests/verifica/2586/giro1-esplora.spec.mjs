// #2586 giro 1 — esplorazione: menu della home con gesti veri (rotella poi tasto destro), elenco lungo, campo lungo.

import { test, expect } from '../../fixtures/electron.mjs';

const fotogrammi = (page) => page.evaluate(() => new Promise((ok) => {
  requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(ok, 150)));
}));

async function homeCon(openTab, { schede = 1, categorie = 0 } = {}) {
  const page = await openTab('filo://home/home.html');
  await page.evaluate(async ({ schede, categorie }) => {
    const ora = new Date().toISOString();
    const savedPages = Array.from({ length: schede }, (_, i) => ({ id: `p${i}`, url: `https://example.com/${i}`, title: `Pagina ${i}`, favicon: '', thumbnail: '', savedAt: ora, categoryId: null, category: null }));
    const categories = Array.from({ length: categorie }, (_, i) => ({ id: `c${i}`, name: `Categoria ${String(i).padStart(2, '0')}`, createdAt: ora }));
    await chrome.storage.local.set({ savedPages, categories });
    await window.SN_STORAGE.updateSettings({ featureFlags: { categorize: false } });
  }, { schede, categorie });
  await page.reload();
  await expect(page.locator('#grid .sn-card[data-page-id="p0"]')).toBeVisible();
  return page;
}

test('rotella e subito tasto destro su una scheda: il menu resta aperto', async ({ openTab }) => {
  const page = await homeCon(openTab, { schede: 60 });
  await page.evaluate(() => {
    const s = document.createElement('div'); s.style.height = '4000px'; document.body.appendChild(s);
  });
  const prima = await page.evaluate(() => [window.scrollY, ...[...document.querySelectorAll('*')].filter((e) => e.scrollHeight > e.clientHeight + 10 && /(auto|scroll)/.test(getComputedStyle(e).overflowY)).map((e) => `${e.id || e.className}:${e.scrollTop}`)]);
  const card = page.locator('#grid .sn-card').nth(2);
  const b = await card.boundingBox();
  await page.mouse.move(b.x + 20, b.y + 20);
  await page.mouse.wheel(0, 300);
  await page.mouse.click(b.x + 20, b.y + 20, { button: 'right' });
  await fotogrammi(page);
  const dopo = await page.evaluate(() => [window.scrollY, ...[...document.querySelectorAll('*')].filter((e) => e.scrollHeight > e.clientHeight + 10 && /(auto|scroll)/.test(getComputedStyle(e).overflowY)).map((e) => `${e.id || e.className}:${e.scrollTop}`)]);
  console.log('scorrimento prima/dopo', JSON.stringify(prima), JSON.stringify(dopo));
  await expect(page.locator('.home-ctxmenu')).toBeVisible();
});

test('Sposta in categoria con tante categorie: si scorre l\'elenco e il menu resta', async ({ openTab }) => {
  const page = await homeCon(openTab, { schede: 1, categorie: 15 });
  const card = page.locator('#grid .sn-card[data-page-id="p0"]');
  await card.click({ button: 'right' });
  const menu = page.locator('.home-ctxmenu');
  await expect(menu).toBeVisible();
  await menu.locator('.sn-select-option').filter({ hasText: /Sposta/i }).click();
  await expect(menu.locator('.sn-select-option', { hasText: 'Categoria 14' })).toHaveCount(1);
  const misure = await menu.evaluate((m) => [m.scrollHeight, m.clientHeight]);
  console.log('menu sposta', JSON.stringify(misure));
  const mb = await menu.boundingBox();
  await page.mouse.move(mb.x + mb.width / 2, mb.y + mb.height / 2);
  await page.mouse.wheel(0, 200);
  await fotogrammi(page);
  await expect(menu, 'rotella dentro il menu').toBeVisible();
  await menu.locator('.sn-select-option', { hasText: 'Categoria 14' }).click();
  await expect(menu).toHaveCount(0);
});

test('nome lungo per una categoria nuova: il campo resta e la categoria nasce', async ({ openTab }) => {
  const page = await homeCon(openTab, { schede: 1, categorie: 1 });
  const card = page.locator('#grid .sn-card[data-page-id="p0"]');
  await card.click({ button: 'right' });
  const menu = page.locator('.home-ctxmenu');
  await menu.locator('.sn-select-option').filter({ hasText: /Sposta/i }).click();
  await menu.locator('.sn-select-option').last().click();
  const campo = page.locator('.home-ctxmenu .home-campo');
  await expect(campo).toBeVisible();
  const nome = 'Ricette della nonna da provare nel fine settimana con gli amici';
  await campo.pressSequentially(nome, { delay: 10 });
  await fotogrammi(page);
  await expect(campo, 'il campo è ancora aperto dopo un nome lungo').toBeVisible();
  await expect(campo).toHaveValue(nome);
});

test('nome corto per una categoria nuova: il campo resta', async ({ openTab }) => {
  const page = await homeCon(openTab, { schede: 1, categorie: 1 });
  const card = page.locator('#grid .sn-card[data-page-id="p0"]');
  await card.click({ button: 'right' });
  const menu = page.locator('.home-ctxmenu');
  await menu.locator('.sn-select-option').filter({ hasText: /Sposta/i }).click();
  await menu.locator('.sn-select-option').last().click();
  const campo = page.locator('.home-ctxmenu .home-campo');
  await expect(campo).toBeVisible();
  await page.evaluate(() => { window.__scroll = []; window.addEventListener('scroll', (e) => window.__scroll.push(e.target.className || e.target.nodeName), true); });
  await campo.pressSequentially('Ricette', { delay: 10 });
  await fotogrammi(page);
  await expect(campo).toBeVisible();
  await campo.pressSequentially(' della nonna da provare nel fine settimana con gli amici', { delay: 10 });
  await fotogrammi(page);
  console.log('scroll visti', JSON.stringify(await page.evaluate(() => window.__scroll)));
});
