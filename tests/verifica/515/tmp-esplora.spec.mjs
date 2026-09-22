// Esplorazione del giro 3 — NON asserisce niente, si cancella prima di consegnare.

import { test, expect } from '../../fixtures/electron.mjs';

const PAGINA = 'filo://transparency/transparency.html';

test('il link della pagina vuota porta davvero al documento', async ({ app, openTab }) => {
  const page = await openTab(`${PAGINA}?doc=privacy`);
  await expect(page.locator('#title')).toBeVisible({ timeout: 10_000 });
  const prima = await page.evaluate(() => ({
    url: location.href,
    titolo: document.getElementById('title').textContent,
    corpo: document.getElementById('doc-body').textContent,
    link: [...document.querySelectorAll('#doc-body a')].map((a) => a.getAttribute('href')),
  }));
  console.log('PAGINA VUOTA', JSON.stringify(prima, null, 1));

  await page.locator('#doc-body a').first().click();
  await page.waitForTimeout(1200);
  const dopo = await page.evaluate(() => ({
    url: location.href,
    titolo: document.getElementById('title').textContent,
    lung: document.getElementById('doc-body').textContent.length,
  }));
  console.log('DOPO IL CLIC', JSON.stringify(dopo, null, 1));
});

test('avanti e indietro del browser fra due sezioni', async ({ app, openTab }) => {
  const page = await openTab(`${PAGINA}?doc=models`);
  await expect(page.locator('#title')).toBeVisible({ timeout: 10_000 });
  await page.goto(`${PAGINA}?doc=privacy`);
  await page.waitForTimeout(500);
  await page.goBack();
  await page.waitForTimeout(800);
  const t = await page.evaluate(() => ({ url: location.href, titolo: document.getElementById('title').textContent }));
  console.log('INDIETRO', JSON.stringify(t));
});
