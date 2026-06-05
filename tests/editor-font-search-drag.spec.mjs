// Feedback alpha (riapertura): nell'editor 1) si deve poter afferrare un modulo
// da QUALSIASI punto tenendo premuto (non solo dalla maniglia); 2) il picker del
// font deve avere una ricerca per scrivere e filtrare, con molti font (incl.
// Garamond) e uno stile coerente con gli altri menu a tendina di Filo.

import { test, expect } from './fixtures/electron.mjs';

async function addFontModule(page) {
  await page.locator('.ed-cell-empty').first().click();
  await expect(page.locator('.ed-overlay [data-add="font"]')).toHaveCount(1);
  await page.locator('.ed-overlay [data-add="font"]').click();
  await page.waitForSelector('.ed-module[data-type="font"]');
}

function selectParagraph(page) {
  return page.evaluate(() => {
    const doc = document.getElementById('doc');
    doc.innerHTML = '<p>cambia font</p>';
    doc.dispatchEvent(new Event('input', { bubbles: true }));
    const range = document.createRange();
    range.selectNodeContents(doc.querySelector('p'));
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
  });
}

test('il picker del font ha una ricerca, filtra mentre scrivi e applica il font cercato (Garamond)', async ({ openTab }) => {
  const page = await openTab('filo://editor/editor.html');
  await page.waitForSelector('.ed-grid');
  await addFontModule(page);

  const mod = page.locator('.ed-module[data-type="font"]');
  // Il dropdown custom (stile Filo) è presente: bottone + popup con campo ricerca.
  const button = mod.locator('.ed-font-button');
  await expect(button).toHaveCount(1);

  // Molti font disponibili, incluso Garamond.
  const total = await mod.locator('.ed-font-list .sn-select-option').count();
  expect(total).toBeGreaterThanOrEqual(30);
  await expect(mod.locator('.ed-font-list .sn-select-option', { hasText: 'Garamond' })).toHaveCount(1);

  await selectParagraph(page);

  // Apri il dropdown e cerca "garam": deve restare solo l'opzione Garamond visibile.
  await button.click();
  await expect(mod.locator('.ed-font-search')).toBeVisible();
  await mod.locator('.ed-font-search').fill('garam');
  const visible = mod.locator('.ed-font-list .sn-select-option:visible');
  await expect(visible).toHaveCount(1);
  await expect(visible.first()).toHaveText(/Garamond/);

  // Cliccando l'opzione filtrata il font viene applicato al testo selezionato.
  await visible.first().click();
  const html = await page.locator('#doc').innerHTML();
  expect(html).toMatch(/font-family\s*:\s*[^;"']*Garamond/i);
});

test('il dropdown del font si chiude con un click fuori da esso', async ({ openTab }) => {
  const page = await openTab('filo://editor/editor.html');
  await page.waitForSelector('.ed-grid');
  await addFontModule(page);

  const mod = page.locator('.ed-module[data-type="font"]');
  const button = mod.locator('.ed-font-button');
  const pop = mod.locator('.ed-font-pop');

  // Click sul documento → si chiude.
  await button.click();
  await expect(pop).toBeVisible();
  await page.locator('#doc').click({ position: { x: 5, y: 5 } });
  await expect(pop).toBeHidden();

  // Click sulla topbar → si chiude.
  await button.click();
  await expect(pop).toBeVisible();
  await page.locator('.ed-topbar').click({ position: { x: 5, y: 5 } });
  await expect(pop).toBeHidden();

  // Click in un angolo lontano della pagina → si chiude.
  await button.click();
  await expect(pop).toBeVisible();
  await page.mouse.click(2, 2);
  await expect(pop).toBeHidden();
});

test('un modulo si può afferrare da qualsiasi punto tenendo premuto (non solo dalla maniglia)', async ({ openTab }) => {
  const page = await openTab('filo://editor/editor.html');
  await page.waitForSelector('.ed-grid');

  const mod = page.locator('.ed-module[data-type="word-count"]');
  await expect(mod).toHaveCount(1);
  const before = await mod.evaluate((el) => `${el.style.gridColumn}|${el.style.gridRow}`);
  const box = await mod.boundingBox();

  const empties = page.locator('.ed-cell-empty');
  const ebox = await empties.nth((await empties.count()) - 1).boundingBox();

  // Premo al CENTRO del modulo (non sulla maniglia ⠿), tengo premuto oltre la
  // soglia di hold, poi trascino: il drag deve partire da qui.
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(320);
  await page.mouse.move(ebox.x + ebox.width / 2, ebox.y + ebox.height / 2, { steps: 10 });
  expect(await page.evaluate(() => document.body.classList.contains('ed-dragging'))).toBe(true);
  await page.mouse.up();

  const after = await page
    .locator('.ed-module[data-type="word-count"]')
    .evaluate((el) => `${el.style.gridColumn}|${el.style.gridRow}`);
  expect(after).not.toBe(before);
});

test('un click rapido sul modulo NON avvia un trascinamento (i click restano click)', async ({ openTab }) => {
  const page = await openTab('filo://editor/editor.html');
  await page.waitForSelector('.ed-grid');

  const mod = page.locator('.ed-module[data-type="word-count"]');
  const box = await mod.boundingBox();
  // Press + rilascio rapido (sotto la soglia di hold): niente drag.
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.up();
  expect(await page.evaluate(() => document.body.classList.contains('ed-dragging'))).toBe(false);
});
