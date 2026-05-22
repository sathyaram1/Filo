// Verifica l'app Editor: launcher nella shell, render della griglia moduli,
// editor di testo contenteditable e conteggio parole live.

import { test, expect } from './fixtures/electron.mjs';

test('il launcher app apre l\'editor', async ({ shell, openTab }) => {
  // Il bottone app è presente nella barra indirizzi.
  await expect(shell.locator('#nav-apps')).toHaveCount(1);
  // Apre il menu e contiene la voce Editor.
  await shell.click('#nav-apps');
  await expect(shell.locator('#apps-menu .apps-item')).toContainText(['Editor']);

  const page = await openTab('filo://editor/editor.html');
  await page.waitForSelector('#doc');
  await expect(page.locator('#doc')).toHaveAttribute('contenteditable', 'true');
});

test('la griglia moduli renderizza switch + moduli e celle vuote', async ({ openTab }) => {
  const page = await openTab('filo://editor/editor.html');
  await page.waitForSelector('.ed-grid');
  // Almeno lo switch + il word-count sono sulla pagina iniziale (z=0).
  await expect(page.locator('.ed-module[data-type="switch"]')).toHaveCount(1);
  await expect(page.locator('.ed-module[data-type="word-count"]')).toHaveCount(1);
  // Celle vuote presenti (slot disponibili).
  expect(await page.locator('.ed-cell-empty').count()).toBeGreaterThan(0);
});

test('conteggio parole si aggiorna in tempo reale', async ({ openTab }) => {
  const page = await openTab('filo://editor/editor.html');
  await page.waitForSelector('.ed-module[data-type="word-count"] .wc-num');
  await page.click('#doc');
  await page.evaluate(() => {
    const doc = document.getElementById('doc');
    doc.innerHTML = '<p>uno due tre quattro</p>';
    doc.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await expect(page.locator('.ed-module[data-type="word-count"] .wc-num')).toHaveText('4');
});

test('cambio pagina via switch mostra moduli della pagina 1', async ({ openTab }) => {
  const page = await openTab('filo://editor/editor.html');
  await page.waitForSelector('.ed-module[data-type="switch"]');
  // pagina 0 attiva: niente chat
  await expect(page.locator('.ed-module[data-type="chat"]')).toHaveCount(0);
  // clic sulla seconda icona dello switch → pagina 1 (Revisione)
  await page.locator('.ed-switch-icon').nth(1).click();
  await expect(page.locator('.ed-module[data-type="chat"]')).toHaveCount(1);
  await expect(page.locator('.ed-module[data-type="search-replace"]')).toHaveCount(1);
});
