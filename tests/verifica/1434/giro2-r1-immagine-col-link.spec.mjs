// Verifica #1434 giro 2, rilievo 1: su un'immagine o un filmato dentro un collegamento (le anteprime di notizie,
// negozi, ricerche) la fila ha anche le azioni del collegamento, come le voci sotto.
import { test, expect } from '../../fixtures/electron.mjs';
import { menuDi } from '../../helpers/menuContestuale.mjs';

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFklEQVQImWP8z8DwnwEJMDKgAQYGAH8IBAFwbpVFAAAAAElFTkSuQmCC', 'base64');
const SITO = (img) => `<!doctype html><html><head><title>Fila</title></head>
  <body style="margin:0;padding:40px;font:16px sans-serif">
  <a id="scheda" href="https://esempio.it/articolo"><img id="foto" src="${img}" width="160" height="120" alt="anteprima"></a>
  <a id="schedaVid" href="https://esempio.it/filmato" style="display:block;margin-top:20px"><video id="vid" width="200" height="110" style="background:#000"></video></a>
  </body></html>`;
const ids = (menu) => menu.locator('.sn-menu-row [data-sn-icon-id]').evaluateAll((e) => e.map((x) => x.dataset.snIconId));

for (const [nome, sel] of [['un\'immagine', '#foto'], ['un filmato', '#vid']]) {
  test(`r1 su ${nome} dentro un collegamento la fila ha Apri in una nuova scheda`, async ({ openTab, testServer }) => {
    const img = testServer.asset(PNG, 'image/png');
    const page = await testServer.openReady(openTab, SITO(img));
    await page.locator(sel).click({ button: 'right' });
    const menu = menuDi(page);
    await expect(menu.locator('.sn-menu-row')).toBeVisible();
    await expect(menu.voce('Apri in nuova tab')).toBeVisible();
    const fila = await ids(menu);
    expect(fila.some((id) => /openTab$/.test(id)), `fila: ${fila.join(', ')}`).toBe(true);
  });
}
