// Verifica #1434 giro 3: esplorazione (si cancella prima del verdetto).
import { test, expect } from '../../fixtures/electron.mjs';
import { menuDi } from '../../helpers/menuContestuale.mjs';

const SITO = `<!doctype html><html><head><title>Fila</title></head>
  <body style="margin:0;padding:40px;font:16px sans-serif">
  <input id="txt" type="text" value="tagliami adesso" style="display:block;width:300px">
  <p id="testo">Un paragrafo di prova da selezionare, con <a id="ln" href="https://esempio.it/x">un collegamento qui</a> dentro.</p>
  <iframe id="fr" style="width:400px;height:80px" srcdoc="<div id=ce contenteditable=true>Testo nel riquadro</div>"></iframe>
  </body></html>`;

const ids = (menu) => menu.locator('.sn-menu-row [data-sn-icon-id]').evaluateAll((els) => els.map((e) => e.dataset.snIconId));

test('esplora: taglia in casella', async ({ app, openTab, testServer }) => {
  const page = await testServer.openReady(openTab, SITO);
  const menu = menuDi(page);
  await page.locator('#txt').click();
  await page.locator('#txt').evaluate((e) => e.setSelectionRange(0, 8));
  const b = await page.locator('#txt').boundingBox();
  await page.mouse.click(b.x + 20, b.y + b.height / 2, { button: 'right' });
  await expect(menu.principale).toBeVisible();
  console.log('txt fila', JSON.stringify(await ids(menu)));
  await menu.locator('.sn-menu-row [data-sn-icon-id="campo:cut"]').click();
  await page.waitForTimeout(400);
  console.log('txt dopo taglia', await page.locator('#txt').inputValue(), '| appunti', await app.evaluate(({ clipboard }) => clipboard.readText()));
  await page.keyboard.press('Control+z');
  await page.waitForTimeout(200);
  console.log('txt dopo ctrl+z', await page.locator('#txt').inputValue());
  await page.locator('#txt').click({ button: 'right' });
  await menu.locator('.sn-menu-row [data-sn-icon-id="cursore:paste"]').click();
  await page.waitForTimeout(400);
  console.log('txt dopo incolla', await page.locator('#txt').inputValue());
});

test('esplora: selezione dentro un collegamento', async ({ openTab, testServer }) => {
  const page = await testServer.openReady(openTab, SITO);
  const menu = menuDi(page);
  const p = await page.evaluate(() => {
    const t = document.getElementById('ln').firstChild; const r = document.createRange(); r.setStart(t, 3); r.setEnd(t, 14);
    getSelection().removeAllRanges(); getSelection().addRange(r);
    const b = r.getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
  });
  await page.mouse.click(p.x, p.y, { button: 'right' });
  await expect(menu.principale).toBeVisible();
  console.log('sel-in-link fila', JSON.stringify(await ids(menu)), '| voci', JSON.stringify(await menu.voci.allTextContents()));
  await page.keyboard.press('Escape');
});

test('esplora: riquadro', async ({ openTab, testServer }) => {
  const page = await testServer.openReady(openTab, SITO);
  await page.waitForTimeout(800);
  const box = await page.locator('#fr').boundingBox();
  await page.mouse.click(box.x + 30, box.y + 15, { button: 'right' });
  await page.waitForTimeout(1500);
  const menu = menuDi(page);
  console.log('iframe menu', await menu.principale.count(), page.context().pages().map((x) => x.url()).join(' '));
});

test('esplora: tastiera', async ({ openTab, testServer }) => {
  const page = await testServer.openReady(openTab, SITO);
  const menu = menuDi(page);
  await page.evaluate(() => {
    const r = document.createRange(); r.selectNodeContents(document.getElementById('testo').firstChild);
    getSelection().removeAllRanges(); getSelection().addRange(r);
  });
  const b = await page.locator('#testo').boundingBox();
  await page.mouse.click(b.x + 30, b.y + b.height / 2, { button: 'right' });
  await expect(menu.principale).toBeVisible();
  const fuoco = () => menu.valuta(() => { const a = document.activeElement; return `${a?.tagName}.${a?.className}|${a?.dataset?.snIconId || (a?.textContent || '').slice(0, 20)}`; });
  console.log('fuoco inizio', await fuoco());
  for (const k of ['ArrowDown', 'ArrowUp', 'ArrowUp', 'ArrowRight', 'Tab', 'Shift+Tab']) {
    await menu.superficie.keyboard.press(k);
    console.log('dopo', k, await fuoco());
  }
});

test('esplora: trascina una icona di contesto nella barra', async ({ app, openTab, testServer }) => {
  const page = await testServer.openReady(openTab, SITO);
  const r = await app.evaluate(async () => {
    try { return JSON.stringify(await globalThis.SN_LAYOUT_ICONE.posa({ id: 'testo:copy', target: 'bar', beforeId: null })); } catch (e) { return 'errore ' + e.message; }
  });
  console.log('posa contesto in barra', r);
  void page;
});
