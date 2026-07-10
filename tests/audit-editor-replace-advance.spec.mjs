// AUDIT prober: il modulo "Cerca e sostituisci" dell'editor. Verifica se
// "Sostituisci" (replace-one) AVANZA alla corrispondenza successiva o se
// torna sempre in cima al documento.

import { test, expect } from './fixtures/electron.mjs';

async function openSearchReplace(page) {
  await page.waitForSelector('.ed-module[data-type="switch"]');
  await page.locator('.ed-switch-icon').nth(1).click(); // pagina 1 (Revisione)
  await page.waitForSelector('.ed-module[data-type="search-replace"]');
}

test('replace-one dovrebbe avanzare alla corrispondenza successiva, non tornare in cima', async ({ openTab }) => {
  const page = await openTab('filo://editor/editor.html');
  await page.waitForSelector('#doc');
  await page.evaluate(() => {
    const doc = document.getElementById('doc');
    doc.innerHTML = '<p>alfa beta alfa gamma alfa delta alfa</p>';
    doc.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await openSearchReplace(page);

  const find = page.locator('[data-sr="find"]');
  const repl = page.locator('[data-sr="repl"]');
  const count = page.locator('[data-sr="count"]');

  await find.fill('alfa');
  await expect(count).toHaveText('1/4');

  // Vado alla 3ª corrispondenza.
  await page.locator('[data-sr="next"]').click();
  await page.locator('[data-sr="next"]').click();
  await expect(count).toHaveText('3/4');

  // Sostituisco la corrispondenza corrente (la 3ª).
  await repl.fill('OMEGA');
  await page.locator('[data-sr="one"]').click();

  // Restano 3 corrispondenze. Un find/replace SANO avanza: la corrispondenza
  // corrente ora dovrebbe essere quella DOPO quella sostituita (indice ~3/3),
  // NON tornare a 1/3 (la prima in cima).
  await expect(count).toHaveText(/\/3$/); // restano 3
  const shown = await count.textContent();
  // ASSERT del comportamento corretto: NON deve essere ripartito da 1/3.
  expect(shown, 'dopo Sostituisci la selezione torna in cima invece di avanzare').not.toBe('1/3');
});

test('replace-one con sostituzione che contiene il termine: non deve re-trovarsi e crescere', async ({ openTab }) => {
  const page = await openTab('filo://editor/editor.html');
  await page.waitForSelector('#doc');
  await page.evaluate(() => {
    const doc = document.getElementById('doc');
    doc.innerHTML = '<p>cat cat cat</p>';
    doc.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await openSearchReplace(page);

  const find = page.locator('[data-sr="find"]');
  const repl = page.locator('[data-sr="repl"]');

  await find.fill('cat');
  await repl.fill('cats');

  // Clicco "Sostituisci" 3 volte: mi aspetto di sostituire le 3 occorrenze →
  // "cats cats cats". Se replace-one si ri-trova dentro la propria
  // sostituzione, il testo cresce sulla stessa parola.
  await page.locator('[data-sr="one"]').click();
  await page.locator('[data-sr="one"]').click();
  await page.locator('[data-sr="one"]').click();

  const text = await page.evaluate(() => document.getElementById('doc').textContent.trim());
  expect(text, `testo risultante: "${text}"`).toBe('cats cats cats');
});
