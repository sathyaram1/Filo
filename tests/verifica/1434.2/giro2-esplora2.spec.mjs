// Esplorazione del giro 2 di #1434.2, seconda parte: strato, campo ricco dal «+», pagine di Filo.
import { test, expect } from '../../fixtures/electron.mjs';
import { menuDi } from '../../helpers/menuContestuale.mjs';

const pausa = (ms) => new Promise((r) => setTimeout(r, ms));
const ids = (menu, sel) => menu.locator(sel).evaluateAll((els) => els.map((e) => `${e.dataset.snIconId}|${e.getAttribute('aria-label')}|${e.dataset.snDisabled || ''}`));
const appunti = (app) => app.evaluate(({ clipboard }) => clipboard.readText());
const esegui = (app, azione) => app.evaluate((_e, a) => globalThis.SN_EXECUTE_FILO_ACTION(a), azione);

const CAMPO = 'display:block;width:300px;margin-top:16px;font:16px sans-serif';
const CAMPI = `<!doctype html><html><head><title>Campi</title></head><body style="margin:0;padding:40px">
  <input id="testo" type="text" value="una parola qui" style="${CAMPO}">
  <input id="mail" type="email" value="mario@posta.it" style="${CAMPO}">
  <input id="segreta" type="password" value="segreta123" style="${CAMPO}">
  <div id="ricco" contenteditable="true" style="${CAMPO};border:1px solid #888"><b>grassetto</b> normale</div>
  <div id="altro" contenteditable="true" style="${CAMPO};border:1px solid #888">x</div>
  <div id="vuoto" style="height:300px"></div>
  </body></html>`;

async function giro(app, page, menu, etichetta) {
  await app.evaluate(({ clipboard }) => clipboard.writeText('prima'));
  await page.locator('#testo').focus();
  await page.evaluate(() => document.getElementById('testo').setSelectionRange(0, 3));
  await page.locator('#testo').click({ button: 'right', position: { x: 8, y: 8 } });
  await expect(menu.locator('.sn-menu-row')).toBeVisible();
  await menu.locator('.sn-menu-row [data-sn-icon-id="campo:cut"]').click();
  await pausa(600);
  console.log(etichetta, 'testo taglia', JSON.stringify(await page.locator('#testo').inputValue()), JSON.stringify(await appunti(app)));
  await page.keyboard.press('Control+z');
  await pausa(300);
  console.log(etichetta, 'testo dopo z', JSON.stringify(await page.locator('#testo').inputValue()));

  await page.locator('#segreta').focus();
  await page.keyboard.press('Control+a');
  await page.locator('#segreta').click({ button: 'right', position: { x: 12, y: 8 } });
  await expect(menu.principale).toBeVisible();
  console.log(etichetta, 'password fila', JSON.stringify(await ids(menu, '.sn-menu-row .sn-menu-row-btn[data-sn-icon-id]')));
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await pausa(200);

  // Campo ricco: Taglia dal «+» della fila, incollato altrove.
  await page.locator('#ricco').focus();
  await page.evaluate(() => {
    const r = document.createRange();
    r.selectNodeContents(document.querySelector('#ricco b'));
    const s = getSelection(); s.removeAllRanges(); s.addRange(r);
  });
  await page.locator('#ricco').click({ button: 'right', position: { x: 20, y: 8 } });
  await expect(menu.locator('.sn-menu-row')).toBeVisible();
  await menu.locator('.sn-menu-row .sn-menu-row-overflow').click();
  await menu.locator('.sn-menu-icon-grid [data-sn-icon-id="scrivibile:cut"]').click();
  await pausa(600);
  console.log(etichetta, 'ricco dopo taglia +', JSON.stringify(await page.locator('#ricco').innerHTML()), JSON.stringify(await appunti(app)));
  await page.locator('#altro').click();
  await page.keyboard.press('End');
  await page.keyboard.press('Control+v');
  await pausa(300);
  console.log(etichetta, 'incollato', JSON.stringify(await page.locator('#altro').innerHTML()));
  await page.locator('#ricco').click();
  await page.keyboard.press('Control+z');
  await pausa(300);
  console.log(etichetta, 'ricco dopo z', JSON.stringify(await page.locator('#ricco').innerHTML()));
}

test('esplora senza strato', async ({ app, openTab, testServer }) => {
  test.setTimeout(90_000);
  const page = await testServer.openReady(openTab, CAMPI);
  await giro(app, page, menuDi(page), 'pagina');
});

test.describe('strato', () => {
  test.use({ stratoDelMenu: true });
  test('esplora con lo strato', async ({ app, openTab, testServer }) => {
    test.setTimeout(120_000);
    const page = await testServer.openReady(openTab, CAMPI);
    const menu = menuDi(page);
    await giro(app, page, menu, 'strato');
    // Icona della finestra nella fila, a menu aperto nello strato.
    await page.keyboard.press('Escape');
    await page.locator('#vuoto').click({ button: 'right' });
    await expect(menu.principale).toBeVisible();
    console.log('superficie', menu.superficie.url());
    console.log('sposta', JSON.stringify((await esegui(app, { type: 'SPOSTA_ICONA', icona: 'back', dove: 'fila', contesto: 'pagina' })).executed));
    await pausa(1500);
    console.log('strato fila dopo parole', JSON.stringify(await ids(menu, '.sn-menu-row .sn-menu-row-btn[data-sn-icon-id]')));
    await page.keyboard.press('Escape');
    await pausa(300);
    await page.locator('#vuoto').click({ button: 'right' });
    await expect(menu.principale).toBeVisible();
    console.log('strato fila riaperto', JSON.stringify(await ids(menu, '.sn-menu-row .sn-menu-row-btn[data-sn-icon-id]')));
  });
});

test('pagina di Filo: taglia in un campo e Ctrl+Z', async ({ app, openTab }) => {
  const pg = await openTab('filo://editor/editor.html');
  await pg.waitForSelector('#doc');
  const campo = await pg.evaluate(() => {
    const el = [...document.querySelectorAll('input[type=text],input[type=search],input:not([type]),textarea')].find((e) => e.offsetParent);
    if (!el) return null;
    el.id = el.id || 'cercato';
    el.value = 'una parola qui';
    return '#' + el.id;
  });
  console.log('campo nella pagina di Filo', campo);
  if (!campo) return;
  const menu = menuDi(pg);
  await pg.locator(campo).focus();
  await pg.evaluate((s) => document.querySelector(s).setSelectionRange(0, 3), campo);
  await pg.locator(campo).click({ button: 'right', position: { x: 8, y: 8 } });
  await expect(menu.principale).toBeVisible();
  console.log('filo fila', JSON.stringify(await ids(menu, '.sn-menu-row .sn-menu-row-btn[data-sn-icon-id]')));
  const cut = menu.locator('.sn-menu-row [data-sn-icon-id="campo:cut"]');
  if (await cut.count()) {
    await cut.click();
    await pausa(500);
    console.log('filo taglia', JSON.stringify(await pg.locator(campo).inputValue()), JSON.stringify(await appunti(app)));
    await pg.keyboard.press('Control+z');
    await pausa(300);
    console.log('filo dopo z', JSON.stringify(await pg.locator(campo).inputValue()));
  }
});
