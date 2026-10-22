// Verifica #1343 giro 6: esplorazione delle porte dei giri passati e di quelle nuove.

import { test, expect } from '../../fixtures/electron.mjs';
import { readFileSync } from 'node:fs';
import { barraPage, statoBarra, comandaBarra, iconaDellaBarra, menuAperto } from '../../helpers/barra.mjs';

const pausa = (ms) => new Promise((r) => setTimeout(r, ms));
const sito = (titolo) => `<!doctype html><html><head><title>${titolo}</title></head>
<body style="margin:0;padding:40px;font:16px sans-serif;height:1400px"><h1>${titolo}</h1></body></html>`;

const vista = (app) => app.evaluate(({ BrowserWindow }) => {
  const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito);
  const tm = w._filoTabs;
  const t = tm.tabs.find((x) => x.id === tm.activeId);
  const b = t.view.getBounds();
  return { y: b.y, fila: tm.tabRowHeight, id: tm.activeId, premuto: tm.schedeInAlto.premuto, visibili: tm.schedeInAlto.visibili };
});
const schermoIntero = (app, on) => app.evaluate(({ BrowserWindow }, v) => {
  const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito);
  w._filoTabs.setContentFullscreen(v);
}, on);
const allaShell = (app, ev) => app.evaluate(({ BrowserWindow }, e) => {
  const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito);
  w.webContents.sendInputEvent(e);
}, ev);

test('esplora: menu della scheda a schermo intero, il puntatore entra nel menu', async ({ app, shell, openTab, testServer }) => {
  await testServer.openReady(openTab, sito('Prima'));
  const page = await testServer.openReady(openTab, sito('Seconda'));
  await schermoIntero(app, true);
  await expect.poll(async () => (await vista(app)).y).toBe(0);
  await page.mouse.move(400, 200);
  await page.mouse.move(400, 0, { steps: 4 });
  await expect.poll(async () => (await vista(app)).visibili).toBe(true);
  const tab = shell.locator('.tab', { hasText: 'Prima' });
  const box = await tab.boundingBox();
  await shell.mouse.move(box.x + 20, box.y + box.height / 2);
  await tab.click({ button: 'right' });
  const menu = await menuAperto(app);
  expect(menu, 'il menu della scheda si apre').not.toBeNull();
  // Il puntatore lascia la shell ed entra nel menu, come col mouse vero.
  await allaShell(app, { type: 'mouseLeave', x: Math.round(box.x + 20), y: Math.round(box.y + 40) });
  await menu.mouse.move(20, 20);
  await menu.mouse.move(30, 40, { steps: 3 });
  await pausa(1200);
  console.log('dopo menu', JSON.stringify(await vista(app)));
  expect((await vista(app)).visibili, 'col menu aperto le schede restano').toBe(true);
});

test('esplora: dopo il menu della scheda, tornati sulla pagina le schede se ne vanno', async ({ app, shell, openTab, testServer }) => {
  await testServer.openReady(openTab, sito('Prima'));
  const page = await testServer.openReady(openTab, sito('Seconda'));
  await schermoIntero(app, true);
  await page.mouse.move(400, 200);
  await page.mouse.move(400, 0, { steps: 4 });
  await expect.poll(async () => (await vista(app)).visibili).toBe(true);
  const tab = shell.locator('.tab', { hasText: 'Prima' });
  const box = await tab.boundingBox();
  // Il tasto premuto sulla scheda, e il menu che arriva prima del rilascio (Linux, Mac): il rilascio va al menu.
  await allaShell(app, { type: 'mouseDown', x: Math.round(box.x + 20), y: Math.round(box.y + 10), button: 'right', clickCount: 1 });
  await pausa(300);
  console.log('premuto', JSON.stringify(await vista(app)));
  await app.evaluate(({ BrowserWindow }) => {
    for (const w of BrowserWindow.getAllWindows()) if (!w.isDestroyed() && /^data:text\/html/.test(w.webContents.getURL())) w.hide();
  });
  await page.mouse.move(400, 300, { steps: 3 });
  await page.mouse.move(420, 320, { steps: 3 });
  await pausa(1500);
  console.log('dopo', JSON.stringify(await vista(app)));
  expect((await vista(app)).visibili, 'sulla pagina le schede se ne vanno').toBe(false);
});

test('esplora: un PDF e le azioni sulla pagina della barra', async ({ app, openTab, testServer }) => {
  await testServer.openReady(openTab, sito('Prima'));
  const url = testServer.asset(readFileSync('tests/fixtures/documenti/documento-con-testo.pdf'), 'application/pdf');
  await app.evaluate(({ BrowserWindow }, u) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito);
    w._filoTabs.navigate(w._filoTabs.activeId, u);
  }, url);
  await pausa(3000);
  const barra = await barraPage(app);
  const share = await iconaDellaBarra(app, 'share');
  console.log('share pdf', await share.getAttribute('aria-disabled'), await share.getAttribute('data-sugg'));
  const qr = barra.locator('#nav .ico[data-id="qrCode"]');
  console.log('qr pdf', await qr.getAttribute('aria-disabled'), await qr.getAttribute('data-sugg'));
  const aiuto = barra.locator('#nav .ico[data-id="help"]');
  console.log('aiuto pdf', await aiuto.getAttribute('aria-disabled'), await aiuto.getAttribute('data-sugg'));
  await app.evaluate(({ clipboard }) => clipboard.writeText('niente'));
  await share.click();
  await pausa(1500);
  const appunti = await app.evaluate(({ clipboard }) => clipboard.readText());
  console.log('appunti dopo Condividi sul PDF:', appunti, 'voluto', url);
  expect(appunti === url || (await share.getAttribute('aria-disabled')) === 'true', 'Condividi sul PDF funziona o si mostra spento').toBe(true);
});

test('esplora: le azioni sulla pagina dalla home di Filo', async ({ app, openTab }) => {
  const home = await openTab('filo://newtab/');
  await pausa(1500);
  console.log('filoReady home', await home.evaluate(() => document.documentElement.dataset.filoReady));
  const barra = await barraPage(app);
  const qr = await iconaDellaBarra(app, 'qrCode');
  console.log('qr home', await qr.getAttribute('aria-disabled'), await qr.getAttribute('data-sugg'));
  await qr.click();
  await pausa(1500);
  console.log('overlay qr home', await home.locator('.sn-qr-overlay').count());
  const s = await iconaDellaBarra(app, 'saveForLater');
  console.log('save home', await s.getAttribute('aria-disabled'));
  void barra;
});
