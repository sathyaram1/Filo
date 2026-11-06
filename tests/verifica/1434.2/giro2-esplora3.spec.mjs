// Esplorazione del giro 2 di #1434.2, terza parte: trascinamenti fra fila e barra nei due modi del menu.
import { test, expect } from '../../fixtures/electron.mjs';
import { menuDi } from '../../helpers/menuContestuale.mjs';
import { barraPage, statoBarra, comandaBarra, pannelloFermo } from '../../helpers/barra.mjs';

const pausa = (ms) => new Promise((r) => setTimeout(r, ms));
const ids = (menu, sel) => menu.locator(sel).evaluateAll((els) => els.map((e) => `${e.dataset.snIconId}|${e.dataset.snDisabled || ''}`));
const salvata = (app) => app.evaluate(async () => globalThis.SN_LAYOUT_ICONE.leggi());

async function fermo(loc) {
  let prima = null;
  for (let i = 0; i < 40; i++) {
    const ora = await loc.boundingBox();
    if (ora && prima && ['x', 'y', 'width', 'height'].every((k) => Math.abs(ora[k] - prima[k]) < 0.5)) return ora;
    prima = ora;
    await pausa(120);
  }
  return prima;
}

const SITO = `<!doctype html><html><head><title>T</title></head><body style="margin:0;padding:40px;font:16px sans-serif;height:1200px">
  <p id="testo">Un paragrafo di prova da selezionare col mouse.</p><div id="vuoto" style="height:400px"></div></body></html>`;

async function filaAllaBarra(app, page, menu, id) {
  const barra = await barraPage(app);
  const m = menu.superficie;
  const icona = await fermo(menu.locator(`.sn-menu-row [data-sn-icon-id="${id}"]`));
  await m.mouse.move(icona.x + icona.width / 2, icona.y + icona.height / 2);
  await m.mouse.down();
  await m.mouse.move(icona.x + 12, icona.y + 12, { steps: 3 });
  await m.mouse.move(20, icona.y + 12, { steps: 8 });
  await pausa(800);
  const aperta = (await statoBarra(app)).aperta;
  if (aperta) await pannelloFermo(barra);
  const home = await barra.locator('#nav .ico[data-id="home"]').boundingBox().catch(() => null);
  if (home) await m.mouse.move(30, home.y + 4, { steps: 6 });
  const mira = await barra.locator('#nav').getAttribute('class');
  await m.mouse.up();
  await pausa(800);
  return { aperta, mira, bar: (await statoBarra(app)).bar };
}

async function prova(app, page, etichetta) {
  const menu = menuDi(page);
  // Testo selezionato: Copia del testo trascinato verso la barra.
  await page.evaluate(() => {
    const r = document.createRange(); r.selectNodeContents(document.getElementById('testo').firstChild);
    getSelection().removeAllRanges(); getSelection().addRange(r);
  });
  const t = await page.locator('#testo').boundingBox();
  await page.mouse.click(t.x + 30, t.y + t.height / 2, { button: 'right' });
  await expect(menu.locator('.sn-menu-row')).toBeVisible();
  const esito = await filaAllaBarra(app, page, menu, 'testo:copy');
  console.log(etichetta, 'testo:copy verso la barra', JSON.stringify(esito), JSON.stringify((await salvata(app))['fila:testo']));
  await page.keyboard.press('Escape');
  await comandaBarra(app, 'chiudi').catch(() => {});
  await pausa(300);

  // Home dalla barra alla fila della pagina, a menu aperto.
  const barra = await barraPage(app);
  await page.locator('#vuoto').click({ button: 'right' });
  await expect(menu.principale).toBeVisible();
  await comandaBarra(app, 'clic');
  await pannelloFermo(barra);
  const src = await barra.locator('#nav .ico[data-id="home"]').boundingBox();
  const box = await fermo(menu.principale);
  const s = await statoBarra(app);
  const alto = s.bounds.y - s.alto;
  await barra.mouse.move(src.x + src.width / 2, src.y + src.height / 2);
  await barra.mouse.down();
  await barra.mouse.move(src.x + 30, src.y + 10, { steps: 3 });
  await barra.mouse.move(box.x + 40, box.y + 12 - alto, { steps: 10 });
  await pausa(500);
  const fila = await fermo(menu.locator('.sn-menu-row'));
  if (fila) await barra.mouse.move(fila.x + 20, fila.y + fila.height / 2 - alto, { steps: 4 });
  await barra.mouse.up();
  await pausa(1200);
  console.log(etichetta, 'home nella fila', JSON.stringify((await salvata(app))['fila:pagina']), 'si vede', JSON.stringify(await ids(menu, '.sn-menu-row .sn-menu-row-btn[data-sn-icon-id]')));
}

test('trascinamenti senza strato', async ({ app, openTab, testServer }) => {
  test.setTimeout(90_000);
  const page = await testServer.openReady(openTab, SITO);
  await prova(app, page, 'pagina');
});

test.describe('strato', () => {
  test.use({ stratoDelMenu: true });
  test('trascinamenti con lo strato', async ({ app, openTab, testServer }) => {
    test.setTimeout(90_000);
    const page = await testServer.openReady(openTab, SITO);
    await prova(app, page, 'strato');
  });
});
