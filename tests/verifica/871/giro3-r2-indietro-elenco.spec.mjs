// #871 giro 3, rilievo 2 — il tasto destro su Indietro della barra mostra le pagine a cui si può tornare, e
// sceglierne una ci porta; su Avanti, quelle davanti.

import { test, expect } from '../../fixtures/electron.mjs';
import { barraPage, comandaBarra, pannelloFermo, menuAperto, vociDelMenu, scegliNelMenu } from '../../helpers/barra.mjs';

test('tasto destro su Indietro e Avanti: le pagine della scheda, e la scelta ci porta', async ({ app, openTab, testServer }) => {
  const a = testServer.html('<!doctype html><title>Pagina Alfa</title><body><h1>A</h1></body>');
  const b = testServer.html('<!doctype html><title>Pagina Beta</title><body><h1>B</h1></body>');
  const c = testServer.html('<!doctype html><title>Pagina Gamma</title><body><h1>C</h1></body>');
  const page = await openTab(a);
  await page.waitForFunction(() => document.documentElement.dataset.filoReady === '1');
  await page.evaluate((u) => { location.href = u; }, b);
  await page.waitForURL(b);
  await page.evaluate((u) => { location.href = u; }, c);
  await page.waitForURL(c);
  const barra = await barraPage(app);
  await comandaBarra(app, 'clic');
  await pannelloFermo(barra);

  await barra.locator('#nav .ico[data-id="back"]').click({ button: 'right' });
  let menu = await menuAperto(app);
  expect(menu, 'il menu di Indietro non si è aperto').toBeTruthy();
  const voci = await vociDelMenu(menu);
  expect(voci.join(' | ')).toContain('Pagina Beta');
  expect(voci.join(' | ')).toContain('Pagina Alfa');
  await scegliNelMenu(menu, 'Pagina Alfa');
  await page.waitForURL(a);

  await comandaBarra(app, 'clic');
  await pannelloFermo(barra);
  await barra.locator('#nav .ico[data-id="forward"]').click({ button: 'right' });
  menu = await menuAperto(app);
  expect(menu, 'il menu di Avanti non si è aperto').toBeTruthy();
  expect((await vociDelMenu(menu)).join(' | ')).toContain('Pagina Gamma');
});
