// Verifica #1434 giro 1, rilievo 3: con del testo selezionato altrove, il tasto destro su un'immagine o su un
// collegamento apre il menu di quell'elemento (fila compresa), non quello del testo selezionato.
import { test, expect } from '../../fixtures/electron.mjs';
import { menuDi } from '../../helpers/menuContestuale.mjs';

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFklEQVQImWP8z8DwnwEJMDKgAQYGAH8IBAFwbpVFAAAAAElFTkSuQmCC', 'base64');
const SITO = (img) => `<!doctype html><html><head><title>Fila</title></head>
  <body style="margin:0;padding:40px;font:16px sans-serif">
  <p id="testo">Un paragrafo di prova da selezionare col mouse.</p>
  <img id="foto" src="${img}" width="160" height="120" alt="foto">
  <p><a id="vai" href="https://esempio.it/pagina">un collegamento</a></p>
  </body></html>`;

for (const [nome, sel, attesa] of [
  ['su un\'immagine', '#foto', 'immagine:save'],
  ['su un collegamento', '#vai', 'link:openTab'],
]) {
  test(`r3 col testo selezionato altrove, ${nome} la fila è la sua`, async ({ openTab, testServer }) => {
    const img = testServer.asset(PNG, 'image/png');
    const page = await testServer.openReady(openTab, SITO(img));
    await page.evaluate(() => {
      const r = document.createRange();
      r.selectNodeContents(document.getElementById('testo'));
      getSelection().removeAllRanges();
      getSelection().addRange(r);
    });
    await page.locator(sel).click({ button: 'right' });
    const menu = menuDi(page);
    await expect(menu.locator('.sn-menu-row')).toBeVisible();
    const ids = await menu.locator('.sn-menu-row [data-sn-icon-id]').evaluateAll((e) => e.map((x) => x.dataset.snIconId));
    expect(ids[0]).toBe(attesa);
  });
}
