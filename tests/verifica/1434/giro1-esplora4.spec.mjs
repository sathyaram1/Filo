// Esplorazione del verificatore di #1434 (4): tasto destro su un'icona della fila, home e pagine di Filo.
import { test } from '../../fixtures/electron.mjs';
import { menuDi } from '../../helpers/menuContestuale.mjs';

const log = (...a) => console.log('[ESPLORA]', ...a);
const SITO = `<!doctype html><html><head><title>Esplora</title></head>
  <body style="margin:0;padding:40px;font:16px sans-serif;height:1400px">
  <p id="testo">Good morning my dear friend.</p></body></html>`;
const ids = (menu) => menu.locator('.sn-menu-row [data-sn-icon-id]').evaluateAll((els) => els.map((e) => e.dataset.snIconId));

test('tasto destro su icona della fila', async ({ app, openTab, testServer }) => {
  const page = await testServer.openReady(openTab, SITO);
  const menu = menuDi(page);
  await page.evaluate(() => { const el = document.getElementById('testo'); const r = document.createRange(); r.selectNodeContents(el); getSelection().removeAllRanges(); getSelection().addRange(r); });
  const b = await page.locator('#testo').boundingBox();
  await page.mouse.click(b.x + 30, b.y + b.height / 2, { button: 'right' });
  await page.waitForTimeout(400);
  await menu.locator('.sn-menu-row [data-sn-icon-id="testo:search"]').click({ button: 'right' });
  await page.waitForTimeout(600);
  log('dopo destro su icona: pannelli', await menu.pannelli.count(), 'fila', JSON.stringify(await ids(menu).catch(() => [])));
  log('voci', JSON.stringify((await menu.voci.allInnerTexts().catch(() => [])).map((v) => v.replace(/\s+/g, ' ').slice(0, 40))));
  await page.screenshot({ path: 'tests/.shots/1434-destro-icona.png' });
  log('salvata', JSON.stringify(await app.evaluate(async () => { const l = await globalThis.SN_LAYOUT_ICONE.leggi(); return { f: l['fila:testo'], a: l['altro:testo'] }; })));
});

test('home: testo selezionato nella chat', async ({ app }) => {
  const casa = app.windows().find((w) => w.url().startsWith('filo://newtab'));
  await casa.waitForSelector('#input');
  await casa.locator('#input').fill('una prova di testo');
  await casa.locator('#input').evaluate((e) => { e.focus(); e.setSelectionRange(0, 3); });
  const b = await casa.locator('#input').boundingBox();
  await casa.mouse.click(b.x + 10, b.y + b.height / 2, { button: 'right' });
  await casa.waitForTimeout(600);
  const menu = menuDi(casa);
  log('home input fila', JSON.stringify(await ids(menu)));
  await casa.screenshot({ path: 'tests/.shots/1434-home.png' });
});
