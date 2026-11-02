// Verifica #1434 giro 1, rilievo 4: con tante icone portate nella fila, le icone e il «+» restano dentro il menu.
import { test, expect } from '../../fixtures/electron.mjs';
import { menuDi } from '../../helpers/menuContestuale.mjs';

const SITO = `<!doctype html><html><head><title>Fila</title></head>
  <body style="margin:0;padding:40px;font:16px sans-serif"><p id="testo">Un paragrafo di prova da selezionare.</p></body></html>`;

test('r4 la fila con le icone della pagina riportate dentro resta nel riquadro del menu', async ({ app, openTab, testServer }) => {
  const page = await testServer.openReady(openTab, SITO);
  // Le azioni sulla pagina che la fila aveva prima di #1343, riportate dalla barra nella fila del testo selezionato.
  await app.evaluate(async () => {
    for (const id of ['translate', 'screenshot', 'share', 'saveForLater', 'qrCode', 'newTab', 'back', 'forward', 'reload', 'home']) {
      await globalThis.SN_LAYOUT_ICONE.posa({ id, target: 'fila:testo', beforeId: null });
    }
  });
  await page.evaluate(() => {
    const r = document.createRange();
    r.selectNodeContents(document.getElementById('testo'));
    getSelection().removeAllRanges();
    getSelection().addRange(r);
  });
  const b = await page.locator('#testo').boundingBox();
  await page.mouse.click(b.x + 30, b.y + b.height / 2, { button: 'right' });
  const menu = menuDi(page);
  await expect(menu.locator('.sn-menu-row')).toBeVisible();
  const fuori = await menu.principale.evaluate((m) => {
    const box = m.getBoundingClientRect();
    return [...m.querySelectorAll('.sn-menu-row .sn-menu-row-btn')]
      .filter((e) => { const r = e.getBoundingClientRect(); return r.right > box.right + 0.5 || r.left < box.left - 0.5; })
      .map((e) => e.dataset.snIconId || e.getAttribute('aria-label'));
  });
  expect(fuori, 'icone disegnate fuori dal menu').toEqual([]);
});
