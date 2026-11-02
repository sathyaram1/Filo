// Esplorazione del riallineamento: il conteggio del contesto (da main) segue la selezione scelta sotto il mouse (ramo).
import { test, expect } from '../../fixtures/electron.mjs';
import { menuDi } from '../../helpers/menuContestuale.mjs';

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFklEQVQImWP8z8DwnwEJMDKgAQYGAH8IBAFwbpVFAAAAAElFTkSuQmCC', 'base64');
const SITO = (img) => `<!doctype html><html><head><title>Fila</title></head>
  <body style="margin:0;padding:40px;font:16px sans-serif;height:1200px">
  <p id="testo">Un paragrafo di prova da selezionare col mouse.</p>
  <img id="foto" src="${img}" width="160" height="120" alt="foto">
  <p><a id="vai" href="https://esempio.it/pagina">un collegamento</a></p>
  </body></html>`;

async function selezionaTesto(page, sel) {
  await page.evaluate((s) => {
    const el = document.querySelector(s);
    const r = document.createRange();
    r.selectNodeContents(el.firstChild || el);
    const g = getSelection();
    g.removeAllRanges();
    g.addRange(r);
  }, sel);
}

test('conteggio del contesto dopo la scelta della selezione', async ({ app, openTab, testServer }) => {
  await app.evaluate(() => {
    const s = globalThis.SN_CONTATORI_STRADE_MAIN;
    globalThis.__contesti = [];
    const orig = s.contesto.bind(s);
    s.contesto = (b, o) => { globalThis.__contesti.push(b); return orig(b, o); };
  });
  const page = await testServer.openReady(openTab, SITO(testServer.asset(PNG, 'image/png')));
  const menu = menuDi(page);
  const casi = [];
  for (const sel of ['#foto', '#vai']) {
    await selezionaTesto(page, sel === '#foto' ? '#testo' : '#testo');
    await page.locator(sel).click({ button: 'right' });
    await expect(menu.locator('.sn-menu-row')).toBeVisible();
    casi.push(await menu.locator('.sn-menu-row .sn-menu-row-btn[data-sn-icon-id]').first().getAttribute('data-sn-icon-id'));
    await page.keyboard.press('Escape');
  }
  await selezionaTesto(page, '#testo');
  const r = await page.locator('#testo').boundingBox();
  await page.mouse.click(r.x + 30, r.y + r.height / 2, { button: 'right' });
  await expect(menu.locator('.sn-menu-row')).toBeVisible();
  casi.push(await menu.locator('.sn-menu-row .sn-menu-row-btn[data-sn-icon-id]').first().getAttribute('data-sn-icon-id'));
  await expect.poll(() => app.evaluate(() => globalThis.__contesti.length)).toBeGreaterThanOrEqual(3);
  const contesti = await app.evaluate(() => globalThis.__contesti);
  console.log('FILA', JSON.stringify(casi), 'CONTESTI', JSON.stringify(contesti));
  expect(casi).toEqual(['immagine:save', 'link:openTab', 'testo:copy']);
  expect(contesti[0]).toEqual(['immagine']);
  expect(contesti[1]).toEqual(['collegamento']);
  expect(contesti[2]).toContain('selezione');
});
