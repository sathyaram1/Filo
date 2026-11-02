// Verifica #1434 giro 3, rilievo 1: Taglia della fila in una casella fa quello che fa il sistema. Si annulla con
// Ctrl+Z, toglie il testo anche da una casella email o numero, e su una password non c'è (come nel menu di sistema).
import { test, expect } from '../../fixtures/electron.mjs';
import { menuDi } from '../../helpers/menuContestuale.mjs';

const SITO = `<!doctype html><html><head><title>Fila</title></head>
  <body style="margin:0;padding:40px;font:16px sans-serif">
  <input id="txt" type="text" value="tagliami adesso" style="display:block;width:300px">
  <input id="em" type="email" value="nome@esempio.it" style="display:block;width:300px;margin-top:20px">
  <input id="pw" type="password" value="segretissima" style="display:block;width:300px;margin-top:20px">
  </body></html>`;

// Seleziona tutto il valore (o i primi `n` caratteri) e apre il tasto destro sopra la selezione.
async function destroSullaSelezione(page, sel, n) {
  await page.locator(sel).click();
  await page.locator(sel).evaluate((e, k) => { e.focus(); if (k) e.setSelectionRange(0, k); else e.select(); }, n);
  const b = await page.locator(sel).boundingBox();
  await page.mouse.click(b.x + 12, b.y + b.height / 2, { button: 'right' });
  const menu = menuDi(page);
  await expect(menu.locator('.sn-menu-row')).toBeVisible();
  return menu;
}

test('r1 Taglia dalla fila in una casella si annulla con Ctrl+Z', async ({ openTab, testServer }) => {
  const page = await testServer.openReady(openTab, SITO);
  const menu = await destroSullaSelezione(page, '#txt', 8);
  await menu.locator('.sn-menu-row [data-sn-icon-id="campo:cut"]').click();
  await expect(page.locator('#txt')).toHaveValue(' adesso');
  await page.locator('#txt').focus();
  await page.keyboard.press('Control+z');
  await expect(page.locator('#txt')).toHaveValue('tagliami adesso');
});

test('r1 Taglia dalla fila in una casella email toglie il testo', async ({ app, openTab, testServer }) => {
  const page = await testServer.openReady(openTab, SITO);
  await app.evaluate(({ clipboard }) => clipboard.writeText('vuoto'));
  const menu = await destroSullaSelezione(page, '#em');
  await menu.locator('.sn-menu-row [data-sn-icon-id="campo:cut"]').click();
  await expect.poll(() => app.evaluate(({ clipboard }) => clipboard.readText())).toBe('nome@esempio.it');
  await expect(page.locator('#em')).toHaveValue('');
});

test('r1 su una password la fila non offre Taglia e Copia, che metterebbero negli appunti solo pallini', async ({ openTab, testServer }) => {
  const page = await testServer.openReady(openTab, SITO);
  const menu = await destroSullaSelezione(page, '#pw');
  const fila = await menu.locator('.sn-menu-row [data-sn-icon-id]').evaluateAll((els) => els.map((e) => e.dataset.snIconId));
  expect(fila).not.toContain('campo:cut');
  expect(fila).not.toContain('campo:copy');
});
