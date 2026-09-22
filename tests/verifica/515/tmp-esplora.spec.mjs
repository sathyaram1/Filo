// Esplorazione del giro 3 — NON asserisce niente, si cancella prima di consegnare.

import { test, expect } from '../../fixtures/electron.mjs';

const PAGINA = 'filo://transparency/transparency.html';

test('guarda la barra e il documento', async ({ app, openTab }) => {
  const page = await openTab(PAGINA);
  await expect(page.locator('#title')).toBeVisible({ timeout: 10_000 });

  const barra = await page.evaluate(() => {
    const out = [];
    for (const el of document.querySelectorAll('#nav > *')) {
      out.push({
        tag: el.tagName,
        testo: el.textContent,
        cls: el.className,
        href: el.getAttribute('href') || '',
        title: el.getAttribute('title') || '',
        tabindex: el.tabIndex,
      });
    }
    return out;
  });
  console.log('BARRA', JSON.stringify(barra, null, 1));

  const prima = await page.evaluate(() => ({ url: location.href, titolo: document.getElementById('title').textContent }));
  await page.locator('#nav .is-soon').first().click();
  await page.waitForTimeout(500);
  const dopo = await page.evaluate(() => ({ url: location.href, titolo: document.getElementById('title').textContent, sub: document.getElementById('subtitle').textContent }));
  console.log('CLIC SU SEZIONE IN ARRIVO', JSON.stringify({ prima, dopo }, null, 1));

  const misure = await page.evaluate(() => ({
    docScroll: document.documentElement.scrollWidth,
    docClient: document.documentElement.clientWidth,
    bodyScroll: document.body.scrollWidth,
    innerW: window.innerWidth,
  }));
  console.log('MISURE', JSON.stringify(misure));

  await page.screenshot({ path: 'tests/.shots/515-g3-doc-chiaro.png', fullPage: false });
});

test('tema scuro e finestra stretta', async ({ app, openTab }) => {
  const page = await openTab(PAGINA);
  await expect(page.locator('#title')).toBeVisible({ timeout: 10_000 });
  await page.evaluate(() => { document.documentElement.setAttribute('data-theme', 'dark'); });
  await page.waitForTimeout(300);
  await page.screenshot({ path: 'tests/.shots/515-g3-doc-scuro.png' });
  await page.setViewportSize({ width: 420, height: 800 });
  await page.waitForTimeout(300);
  const misure = await page.evaluate(() => ({
    scroll: document.documentElement.scrollWidth,
    client: document.documentElement.clientWidth,
  }));
  console.log('STRETTA', JSON.stringify(misure));
  await page.screenshot({ path: 'tests/.shots/515-g3-doc-stretto.png' });
});
