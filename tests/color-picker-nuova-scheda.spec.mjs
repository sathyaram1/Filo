// #2651 — il contagocce della barra laterale preso sulla nuova scheda.

import { test, expect } from './fixtures/electron.mjs';
import { barraPage, premiNellaBarra } from './helpers/barra.mjs';
import { home } from './helpers/chatFinta.mjs';

test('sonda', async ({ app }) => {
  const pagina = await home(app);
  const barra = await barraPage(app);
  const prova = (p) => p.evaluate(async () => {
    if (typeof window.EyeDropper !== 'function') return 'manca';
    const t = new Promise((r) => setTimeout(() => r('pendente dopo 3s'), 3000));
    try {
      const r = await Promise.race([new window.EyeDropper().open().then((x) => 'ok ' + JSON.stringify(x), (e) => 'rifiuto ' + e.name + ': ' + e.message), t]);
      return r;
    } catch (e) { return 'eccezione ' + e.name + ': ' + e.message; }
  });
  console.log('barra', await prova(barra));
  console.log('newtab', await prova(pagina));
});

test('Color picker dalla barra sulla nuova scheda copia il colore negli appunti', async ({ app }) => {
  const pagina = await home(app);
  await app.evaluate(({ clipboard }) => clipboard.writeText('prima'));
  const barra = await barraPage(app);
  await barra.evaluate(() => { window.EyeDropper = class { open() { return Promise.resolve({ sRGBHex: '#12ab34' }); } }; });
  const ico = barra.locator('#nav .ico[data-id="colorPicker"]');
  await premiNellaBarra(app, 'colorPicker');
  console.log('spenta', await ico.getAttribute('aria-disabled'), await ico.getAttribute('title'));
  await expect.poll(() => app.evaluate(({ clipboard }) => clipboard.readText()), { timeout: 10_000 }).toBe('#12AB34');
  await expect(pagina.locator('body')).toBeVisible();
});
