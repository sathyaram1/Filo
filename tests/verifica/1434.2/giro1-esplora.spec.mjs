// Verifica #1434.2, giro 1: esplorazione avversariale di Taglia nella fila, icone della finestra, filmati.

import { test, expect } from '../../fixtures/electron.mjs';
import { menuDi } from '../../helpers/menuContestuale.mjs';

const appunti = (app) => app.evaluate(({ clipboard }) => clipboard.readText());
const appuntiHtml = (app) => app.evaluate(({ clipboard }) => clipboard.readHTML());
const esegui = (app, azione) => app.evaluate((_e, a) => globalThis.SN_EXECUTE_FILO_ACTION(a), azione);
const iconeDellaFila = (menu) => menu.locator('.sn-menu-row .sn-menu-row-btn[data-sn-icon-id]')
  .evaluateAll((els) => els.map((e) => e.dataset.snIconId));

const CAMPO = 'display:block;width:300px;margin-top:16px;font:16px sans-serif';
const CAMPI = `<!doctype html><html><head><title>Campi</title></head><body style="margin:0;padding:40px">
  <input id="mail" type="email" value="mario@posta.it" style="${CAMPO}">
  <input id="numero" type="number" value="12345" style="${CAMPO}">
  <div id="ricco" contenteditable="true" style="${CAMPO};border:1px solid #888"><b>grassetto</b> normale</div>
  <div id="altro" contenteditable="true" style="${CAMPO};border:1px solid #888;min-height:30px">x</div>
  <textarea id="area" style="${CAMPO};height:50px">area di testo</textarea>
  </body></html>`;

test('esplora: Taglia di una parte dell\'email dalla fila, poi Ctrl+Z', async ({ app, openTab, testServer }) => {
  const page = await testServer.openReady(openTab, CAMPI);
  const menu = menuDi(page);
  const fila = menu.locator('.sn-menu-row');
  await app.evaluate(({ clipboard }) => clipboard.writeText('prima'));
  await page.locator('#mail').focus();
  await page.keyboard.press('Home');
  for (let i = 0; i < 5; i++) await page.keyboard.press('Shift+ArrowRight');
  await page.locator('#mail').click({ button: 'right', position: { x: 12, y: 8 } });
  await expect(fila).toBeVisible();
  console.log('icone email parziale', await iconeDellaFila(menu));
  await fila.locator('[data-sn-icon-id="campo:cut"]').click();
  await expect.poll(() => appunti(app)).toBe('mario');
  await expect.poll(() => page.locator('#mail').inputValue()).toBe('@posta.it');
  await page.keyboard.press('Control+z');
  await expect.poll(() => page.locator('#mail').inputValue()).toBe('mario@posta.it');

  await page.locator('#numero').focus();
  await page.keyboard.press('Home');
  for (let i = 0; i < 2; i++) await page.keyboard.press('Shift+ArrowRight');
  await page.locator('#numero').click({ button: 'right', position: { x: 12, y: 8 } });
  await expect(fila).toBeVisible();
  await fila.locator('[data-sn-icon-id="campo:cut"]').click();
  await expect.poll(() => appunti(app)).toBe('45');
  await expect.poll(() => page.locator('#numero').inputValue()).toBe('123');
});

test('esplora: Taglia in un campo ricco tiene il grassetto come Ctrl+X e si annulla', async ({ app, openTab, testServer }) => {
  const page = await testServer.openReady(openTab, CAMPI);
  const menu = menuDi(page);
  // Controllo: il Taglia del sistema tiene il grassetto.
  await page.locator('#ricco').focus();
  await page.evaluate(() => { const b = document.querySelector('#ricco b'); const r = document.createRange(); r.selectNodeContents(b); const s = getSelection(); s.removeAllRanges(); s.addRange(r); });
  await page.keyboard.press('Control+x');
  console.log('chiavi appunti', await app.evaluate(({ clipboard }) => Object.keys(clipboard).join(',')));
  await page.locator('#altro').click();
  await page.keyboard.press('End');
  await page.keyboard.press('Control+v');
  const htmlSistema = await page.locator('#altro').innerHTML();
  console.log('incollato dopo Ctrl+X', JSON.stringify(htmlSistema));
  await page.evaluate(() => { document.getElementById('altro').innerHTML = 'x'; document.getElementById('ricco').innerHTML = '<b>grassetto</b> normale'; });

  await page.evaluate(() => { const b = document.querySelector('#ricco b'); const r = document.createRange(); r.selectNodeContents(b); const s = getSelection(); s.removeAllRanges(); s.addRange(r); });
  await page.locator('#ricco').click({ button: 'right', position: { x: 20, y: 8 } });
  await expect(menu.voce('Taglia')).toBeVisible();
  await menu.voce('Taglia').click();
  await expect.poll(() => appunti(app)).toBe('grassetto');
  await expect.poll(() => page.locator('#ricco').textContent()).toBe(' normale');
  await page.locator('#altro').click();
  await page.keyboard.press('End');
  await page.keyboard.press('Control+v');
  const htmlFilo = await page.locator('#altro').innerHTML();
  console.log('incollato dopo Taglia di Filo', JSON.stringify(htmlFilo));
  expect(htmlSistema).toContain('<b');
  expect(htmlFilo).toContain('<b');
});

test('esplora: Indietro e Avanti nella fila seguono la cronologia', async ({ app, openTab, testServer }) => {
  expect((await esegui(app, { type: 'SPOSTA_ICONA', icona: 'back', dove: 'fila', contesto: 'pagina' })).executed).toBe(true);
  expect((await esegui(app, { type: 'SPOSTA_ICONA', icona: 'forward', dove: 'fila', contesto: 'pagina' })).executed).toBe(true);
  expect((await esegui(app, { type: 'SPOSTA_ICONA', icona: 'reload', dove: 'fila', contesto: 'pagina' })).executed).toBe(true);
  const seconda = testServer.html('<!doctype html><html><head><title>Seconda</title></head><body style="height:900px"><div id="vuoto" style="height:400px"></div></body></html>');
  const page = await testServer.openReady(openTab, `<!doctype html><html><head><title>Prima</title></head>
    <body style="margin:0;padding:40px;height:900px"><a id="vai" href="${seconda}">avanti</a><div id="vuoto" style="height:400px"></div></body></html>`);
  const prima = page.url();
  const menu = menuDi(page);
  const avanti = menu.locator('.sn-menu-row [data-sn-icon-id="forward"]');
  const indietro = menu.locator('.sn-menu-row [data-sn-icon-id="back"]');
  await page.locator('#vuoto').click({ button: 'right' });
  await expect(avanti).toBeVisible();
  await expect(avanti).toHaveAttribute('data-sn-disabled', '1');
  console.log('fila', await iconeDellaFila(menu));
  await page.keyboard.press('Escape');
  await page.locator('#vai').click();
  await page.waitForURL(seconda);
  await page.waitForFunction(() => document.documentElement.dataset.filoReady === '1');
  await page.locator('#vuoto').click({ button: 'right' });
  await indietro.click();
  await expect.poll(() => page.url()).toBe(prima);
  await page.waitForFunction(() => document.documentElement.dataset.filoReady === '1');
  await page.locator('#vuoto').click({ button: 'right' });
  await expect(avanti).toBeVisible();
  await expect(avanti).not.toHaveAttribute('data-sn-disabled', '1');
  await expect(indietro).toHaveAttribute('data-sn-disabled', '1');
  await avanti.click();
  await expect.poll(() => page.url()).toBe(seconda);
  // Ricarica: un segno nella pagina sparisce.
  await page.waitForFunction(() => document.documentElement.dataset.filoReady === '1');
  await page.evaluate(() => { window.__segno = 1; });
  await page.locator('#vuoto').click({ button: 'right' });
  await menu.locator('.sn-menu-row [data-sn-icon-id="reload"]').click();
  await expect.poll(() => page.evaluate(() => window.__segno).catch(() => 1)).toBeUndefined();
});

test.describe('strato', () => {
  test.use({ stratoDelMenu: true });
  test('esplora: Taglia dalla fila col menu nello strato, poi Ctrl+Z', async ({ app, openTab, testServer }) => {
    const page = await testServer.openReady(openTab, CAMPI);
    const menu = menuDi(page);
    await app.evaluate(({ clipboard }) => clipboard.writeText('prima'));
    await page.locator('#area').focus();
    await page.keyboard.press('Control+a');
    await page.locator('#area').click({ button: 'right', position: { x: 12, y: 8 } });
    const fila = menu.locator('.sn-menu-row');
    await expect(fila).toBeVisible();
    console.log('superficie', menu.superficie.url());
    await fila.locator('[data-sn-icon-id="campo:cut"]').click();
    await expect.poll(() => appunti(app)).toBe('area di testo');
    await expect.poll(() => page.locator('#area').inputValue()).toBe('');
    await page.locator('#area').focus();
    await page.keyboard.press('Control+z');
    await expect.poll(() => page.locator('#area').inputValue()).toBe('area di testo');
  });
});
