// Verifica #1434.2, giro 1, rilievo 1: Taglia (e Copia) del tasto destro in un campo con la formattazione devono
// lasciare negli appunti quello che lascia il sistema, così che incollato il grassetto resti.

import { test, expect } from '../../fixtures/electron.mjs';
import { menuDi } from '../../helpers/menuContestuale.mjs';

const CAMPO = 'display:block;width:300px;margin-top:16px;font:16px sans-serif;border:1px solid #888;min-height:30px';
const PAGINA = `<!doctype html><html><head><title>Ricco</title></head><body style="margin:0;padding:40px">
  <div id="ricco" contenteditable="true" style="${CAMPO}"><b>grassetto</b> normale</div>
  <div id="altro" contenteditable="true" style="${CAMPO}">x</div>
  </body></html>`;

async function selezionaIlGrassetto(page) {
  await page.locator('#ricco').focus();
  await page.evaluate(() => {
    const r = document.createRange();
    r.selectNodeContents(document.querySelector('#ricco b'));
    const s = getSelection(); s.removeAllRanges(); s.addRange(r);
  });
}

async function incollaInFondo(page) {
  await page.locator('#altro').click();
  await page.keyboard.press('End');
  await page.keyboard.press('Control+v');
  return page.locator('#altro').innerHTML();
}

test('r1 Taglia del tasto destro su una parola in grassetto: incollata resta in grassetto, come dopo Ctrl+X', async ({ app, openTab, testServer }) => {
  const page = await testServer.openReady(openTab, PAGINA);
  const menu = menuDi(page);

  // Il sistema: Ctrl+X e Ctrl+V tengono il grassetto.
  await selezionaIlGrassetto(page);
  await page.keyboard.press('Control+x');
  expect(await incollaInFondo(page)).toContain('<b>grassetto</b>');
  await page.evaluate(() => {
    document.getElementById('altro').innerHTML = 'x';
    document.getElementById('ricco').innerHTML = '<b>grassetto</b> normale';
  });

  // Filo: Taglia dal tasto destro, poi Ctrl+V.
  await selezionaIlGrassetto(page);
  await page.locator('#ricco').click({ button: 'right', position: { x: 20, y: 8 } });
  await expect(menu.voce('Taglia')).toBeVisible();
  await menu.voce('Taglia').click();
  await expect.poll(() => page.locator('#ricco').textContent()).not.toContain('grassetto');
  expect(await incollaInFondo(page)).toContain('<b>grassetto</b>');
});

test('r1 Copia del tasto destro su una parola in grassetto: incollata resta in grassetto, come dopo Ctrl+C', async ({ app, openTab, testServer }) => {
  const page = await testServer.openReady(openTab, PAGINA);
  const menu = menuDi(page);
  await selezionaIlGrassetto(page);
  await page.locator('#ricco').click({ button: 'right', position: { x: 20, y: 8 } });
  await expect(menu.voce('Copia')).toBeVisible();
  await menu.voce('Copia').click();
  await expect.poll(() => app.evaluate(({ clipboard }) => clipboard.readText())).toBe('grassetto');
  expect(await incollaInFondo(page)).toContain('<b>grassetto</b>');
});
