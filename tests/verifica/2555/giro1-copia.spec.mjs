// Verifica #2555 giro 1: «copia» con una selezione lontana dal punto del tasto destro.

import { test, expect } from '../../fixtures/electron.mjs';
import { menuDi } from '../../helpers/menuContestuale.mjs';

const SITO = `<!doctype html><html><head><title>Copia</title></head>
  <body style="margin:0;padding:40px;font:16px sans-serif">
  <p id="testo">Un paragrafo di prova da selezionare col mouse.</p>
  <p style="margin-top:200px"><a id="vai" href="https://esempio.it/pagina">un collegamento</a></p>
  </body></html>`;

test('esplora: selezione altrove, tasto destro su un collegamento', async ({ app, openTab, testServer }) => {
  const page = await testServer.openReady(openTab, SITO);
  const menu = menuDi(page);
  await page.evaluate(() => {
    const r = document.createRange();
    r.selectNodeContents(document.getElementById('testo'));
    getSelection().removeAllRanges();
    getSelection().addRange(r);
  });
  await page.locator('#vai').click({ button: 'right' });
  await expect(menu.locator('.sn-menu-griglia')).toBeVisible();
  const sel = await page.evaluate(() => String(getSelection()));
  const copia = menu.locator('.sn-menu-griglia [data-sn-verbo="copy"]');
  await copia.hover();
  const nome = await menu.locator('.sn-menu-nome').textContent();
  const verbi = await menu.valuta(() => [...document.querySelectorAll('.sn-menu-griglia .sn-menu-row-btn')].map((b) => `${b.dataset.snVerbo}:${b.getAttribute('aria-label')}`));
  await copia.click();
  await page.waitForTimeout(500);
  const appunti = await app.evaluate(({ clipboard }) => clipboard.readText());
  console.log(JSON.stringify({ sel, nome, verbi, appunti }));
});
