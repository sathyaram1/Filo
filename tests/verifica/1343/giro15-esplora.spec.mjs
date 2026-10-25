// Verifica #1343 giro 15: esplorazione di porte nuove (cambio di scheda a fila scoperta, uscita, incognito, annullo).

import { test, expect } from '../../fixtures/electron.mjs';
import { barraPage, comandaBarra, pannelloFermo, statoBarra } from '../../helpers/barra.mjs';

const pausa = (ms) => new Promise((r) => setTimeout(r, ms));
const sito = (t) => `<!doctype html><html><head><title>${t}</title></head><body style="margin:0;padding:40px;font:16px sans-serif;height:1400px"><h1>${t}</h1></body></html>`;
const tmEval = (app, fn, arg) => app.evaluate(({ BrowserWindow }, a) => {
  const tm = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito)._filoTabs;
  // eslint-disable-next-line no-new-func
  return new Function('tm', 'arg', a.fn)(tm, a.arg);
}, { fn, arg });
const stato = (app) => tmEval(app, `const t = tm.tabs.find((x) => x.id === tm.activeId);
  return { id: tm.activeId, y: t.view.getBounds().y, h: t.view.getBounds().height, fila: tm.tabRowHeight, vis: !!tm.schedeInAlto.visibili, fs: !!tm.contentFullscreen,
    tutte: tm.tabs.map((x) => ({ id: x.id, y: x.view.getBounds().y, att: x.view.getVisible ? x.view.getVisible() : null })) };`);

async function scopri(app, page) {
  await page.mouse.move(400, 200);
  await page.mouse.move(400, 0, { steps: 4 });
  await expect.poll(async () => (await stato(app)).vis, { timeout: 4000 }).toBe(true);
}

test('esplora: clic su un\'altra scheda nella fila scoperta, poi giù sulla pagina', async ({ app, shell, openTab, testServer }) => {
  const prima = await testServer.openReady(openTab, sito('Prima'));
  const seconda = await testServer.openReady(openTab, sito('Seconda'));
  await tmEval(app, 'tm.setContentFullscreen(true)');
  await pausa(600);
  await scopri(app, seconda);
  const tab = shell.locator('.tab:has-text("Prima")').first();
  const b = await tab.boundingBox();
  await shell.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
  await tab.click();
  await pausa(400);
  const s1 = await stato(app);
  console.log('dopo clic', JSON.stringify(s1));
  expect(s1.y, 'la scheda scelta sta sotto la fila').toBe(s1.fila);
  await prima.mouse.move(400, 300);
  await prima.mouse.move(400, 320, { steps: 3 });
  await expect.poll(async () => (await stato(app)).y, { timeout: 4000 }).toBe(0);
  const s2 = await stato(app);
  console.log('dopo pagina', JSON.stringify(s2));
  expect(s2.vis).toBe(false);
  expect(s2.fs).toBe(true);
});

test('esplora: uscendo dallo schermo intero con le schede scoperte, e rientrando', async ({ app, openTab, testServer }) => {
  const page = await testServer.openReady(openTab, sito('Uscita'));
  await tmEval(app, 'tm.setContentFullscreen(true)');
  await pausa(600);
  await scopri(app, page);
  await tmEval(app, 'tm.setContentFullscreen(false)');
  await pausa(800);
  const fuori = await stato(app);
  console.log('fuori', JSON.stringify(fuori));
  expect(fuori.fs).toBe(false);
  expect(fuori.vis).toBe(false);
  await tmEval(app, 'tm.setContentFullscreen(true)');
  await pausa(800);
  const dentro = await stato(app);
  console.log('dentro', JSON.stringify(dentro));
  expect(dentro.y, 'rientrando le schede non sono già giù').toBe(0);
  expect(dentro.vis).toBe(false);
});

test('esplora: Ctrl+T a fila scoperta, e la scheda nuova', async ({ app, openTab, testServer }) => {
  const page = await testServer.openReady(openTab, sito('Base'));
  await tmEval(app, 'tm.setContentFullscreen(true)');
  await pausa(600);
  await scopri(app, page);
  const prima = (await stato(app)).id;
  await tmEval(app, 'tm.createTab()');
  await pausa(1500);
  const s = await stato(app);
  console.log('nuova', JSON.stringify(s));
  expect(s.id).not.toBe(prima);
  expect(s.fs).toBe(true);
  expect([0, s.fila]).toContain(s.y);
});

test('esplora: due icone spostate, annullo senza id: torna solo l\'ultima', async ({ app }) => {
  const L = (op) => app.evaluate(async (_e, o) => globalThis.SN_LAYOUT_ICONE.posa(o), op);
  const prima = (await statoBarra(app)).bar;
  await L({ id: 'home', target: 'bar', beforeId: 'back' });
  await pausa(300);
  await L({ id: 'qrCode', target: 'bar', beforeId: 'back' });
  await pausa(300);
  const dopo = (await statoBarra(app)).bar;
  console.log('prima', prima.join(','), 'dopo', dopo.join(','));
  const r = await app.evaluate(async () => globalThis.SN_REGISTRO_CAMBI.annulla(null, { via: 'filo' }));
  console.log('annullo', JSON.stringify(r));
  await pausa(500);
  const fine = (await statoBarra(app)).bar;
  console.log('fine', fine.join(','));
  expect(fine.indexOf('home')).toBe(dopo.indexOf('home') - (dopo.indexOf('qrCode') < dopo.indexOf('home') ? 1 : 0));
  expect(fine).not.toContain(undefined);
  expect(fine.indexOf('qrCode')).toBe(prima.indexOf('qrCode'));
});

test('esplora: in incognito le azioni della barra agiscono sulla scheda incognito', async ({ app, testServer }) => {
  const url = testServer.html(sito('Segreta'));
  await app.evaluate(({ clipboard }) => clipboard.writeText('niente'));
  const r = await app.evaluate(async ({ BrowserWindow }, u) => {
    const wm = require('./src/main/window.js');
    return Object.keys(wm);
  }, url).catch((e) => String(e));
  console.log('window exports', JSON.stringify(r));
});
