// Siti e home partono con meno lavoro (#1093): sulle pagine web i moduli che servono a richiesta arrivano al primo uso e
// funzionano da lì; sulle pagine di Filo il preload non riesegue i moduli che la pagina ha già caricato.
// Elenco e peso dei moduli caricati subito: tests/unit/moduliSubito.test.mjs.

import { test, expect } from './fixtures/electron.mjs';
import { menuDi } from './helpers/menuContestuale.mjs';
import { statoDi } from './helpers/riquadri.mjs';

const inAttesa = (page) => page.evaluate(() => (document.documentElement.dataset.filoSuRichiesta || '').split(',').filter(Boolean));

test('su un sito appena aperto il riquadro della segnalazione arriva alla prima richiesta e si apre', async ({ app, openTab, testServer }) => {
  const page = await testServer.openReady(openTab, '<!doctype html><body style="padding:40px"><p id="p" style="font-size:22px">Una frase sulla pagina.</p></body>');
  await page.waitForFunction(() => document.documentElement.dataset.filoContentReady === '1', null, { timeout: 8000 });
  expect(await inAttesa(page), 'a pagina pronta il riquadro della segnalazione non è ancora caricato')
    .toEqual(expect.arrayContaining(['SN_FEEDBACK_UI', 'SN_QR', 'SN_WALLET']));

  await page.locator('#p').click({ button: 'right' });
  const menu = menuDi(page);
  await expect(menu.principale).toBeVisible({ timeout: 8_000 });
  await menu.voce('Invia feedback').first().click();
  await expect.poll(async () => (await statoDi(app, page, '.sn-fb-text'))?.visibile ?? false, { timeout: 8_000 }).toBe(true);
  expect(await inAttesa(page), 'chiesto, il riquadro è stato caricato').not.toContain('SN_FEEDBACK_UI');
});

test('la home non riesegue i moduli condivisi che ha già caricato coi suoi script', async ({ openTab }) => {
  const page = await openTab('filo://newtab/');
  await page.addInitScript(() => {
    const conte = {};
    for (const nome of ['SN_CONST', 'SN_MSG', 'SN_I18N', 'SN_ICONS_UTIL', 'SN_TASTI', 'SN_ASCOLTO']) {
      let v;
      conte[nome] = 0;
      Object.defineProperty(window, nome, { configurable: true, get: () => v, set: (x) => { conte[nome]++; v = x; } });
    }
    window.__registrazioni = conte;
  });
  await page.reload();
  await page.waitForFunction(() => document.documentElement.dataset.filoContentScripts === '1', null, { timeout: 10_000 });
  const conte = await page.evaluate(() => window.__registrazioni);
  expect(conte).toEqual({ SN_CONST: 1, SN_MSG: 1, SN_I18N: 1, SN_ICONS_UTIL: 1, SN_TASTI: 1, SN_ASCOLTO: 1 });
  // Il tasto destro di Filo c'è ancora: i content script hanno trovato i moduli della pagina.
  await page.locator('body').click({ button: 'right', position: { x: 300, y: 300 } });
  await expect(menuDi(page).principale).toBeVisible({ timeout: 8_000 });
});
