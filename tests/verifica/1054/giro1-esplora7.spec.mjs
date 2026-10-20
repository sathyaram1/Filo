// Esplorazione del verificatore (#1054 giro 1): contagocce dallo strato, cronologia in un riquadro di un altro sito.
import { test, expect } from '../../fixtures/electron.mjs';
import { menuDi, paginaDelloStrato, statoDelloStrato, statoCronologia } from '../../helpers/menuContestuale.mjs';

const pausa = (ms) => new Promise((r) => { setTimeout(r, ms); });
test.use({ stratoDelMenu: true });

async function pronto(app) {
  const s = await paginaDelloStrato(app);
  await expect.poll(async () => (await statoDelloStrato(app))?.pronta).toBe(true);
  return s;
}

test('contagocce finto: il colore scelto arriva negli appunti', async ({ app, openTab, testServer }) => {
  test.setTimeout(60_000);
  const strato = await pronto(app);
  const page = await testServer.openReady(openTab, '<!doctype html><body style="margin:0;height:100vh"><p>x</p></body>');
  await page.waitForFunction(() => document.documentElement.dataset.filoContentReady === '1', null, { timeout: 8000 });
  await strato.evaluate(() => {
    window.EyeDropper = class { open() { return new Promise((ok) => setTimeout(() => ok({ sRGBHex: '#12ab34' }), 500)); } };
  });
  await app.evaluate(({ clipboard }) => clipboard.writeText('prima'));
  await page.mouse.click(300, 300, { button: 'right' });
  const menu = menuDi(page);
  await expect(menu.principale).toBeVisible();
  let icona = menu.icona('colorPicker');
  if (!(await icona.count())) { await menu.locator('.sn-menu-row-overflow').hover(); icona = menu.griglia.locator('[data-sn-icon-id="colorPicker"]'); }
  await icona.first().click();
  await pausa(2000);
  const testo = await app.evaluate(({ clipboard }) => clipboard.readText());
  console.log('CONTAGOCCE finto', JSON.stringify({ testo, stato: await statoDelloStrato(app) }));
});

test('contagocce vero: aprirlo non chiude lo strato', async ({ app, openTab, testServer }) => {
  test.setTimeout(60_000);
  await pronto(app);
  const page = await testServer.openReady(openTab, '<!doctype html><body style="margin:0;height:100vh"><p>x</p></body>');
  await page.waitForFunction(() => document.documentElement.dataset.filoContentReady === '1', null, { timeout: 8000 });
  await page.mouse.click(300, 300, { button: 'right' });
  const menu = menuDi(page);
  await expect(menu.principale).toBeVisible();
  let icona = menu.icona('colorPicker');
  if (!(await icona.count())) { await menu.locator('.sn-menu-row-overflow').hover(); icona = menu.griglia.locator('[data-sn-icon-id="colorPicker"]'); }
  await icona.first().click();
  const esiti = [];
  for (let i = 0; i < 6; i++) { await pausa(500); const s = await statoDelloStrato(app); esiti.push({ aperto: s.aperto, visibile: s.visibile, fuoco: await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((w) => w._filoTabs).isFocused()) }); }
  console.log('CONTAGOCCE vero', JSON.stringify(esiti));
});

test('cronologia in un riquadro di un altro sito: si vede nello strato e la scelta va nel riquadro', async ({ app, openTab, testServer }) => {
  test.setTimeout(60_000);
  await pronto(app);
  const dentro = testServer.html('<!doctype html><body style="margin:0"><input id="f" style="position:absolute;left:10px;top:10px;width:200px"></body>', { pubblico: true });
  const page = await testServer.openReady(openTab, `<!doctype html><body style="margin:0"><input id="c" style="position:absolute;left:40px;top:40px;width:200px"><iframe src="${dentro}" style="position:absolute;left:400px;top:200px;width:300px;height:120px;border:0"></iframe></body>`);
  await page.waitForFunction(() => document.documentElement.dataset.filoContentReady === '1', null, { timeout: 8000 });
  const menu = menuDi(page);
  for (const t of ['uno-1054', 'due-1054']) {
    await app.evaluate(({ clipboard }, x) => clipboard.writeText(x), t);
    await page.locator('#c').click({ button: 'right' });
    await menu.locator('.sn-menu-paste-main').click();
    await pausa(400);
  }
  const fr = page.frames().find((f) => f.url().startsWith('http://sito-pubblico.test'));
  await fr.waitForFunction(() => document.documentElement.dataset.filoContentReady === '1', null, { timeout: 8000 }).catch(() => {});
  await page.mouse.click(400 + 60, 200 + 18, { button: 'right' });
  await expect(menu.principale).toBeVisible();
  await menu.locator('.sn-menu-paste-arrow').click();
  await pausa(600);
  const st = await statoCronologia(app, page);
  console.log('RIQUADRO cron', JSON.stringify(st && st.voci.map((v) => v.testo)));
  const voce = st.voci.find((v) => v.testo.includes('uno-1054'));
  await menu.superficie.mouse.click(voce.incolla.x, voce.incolla.y);
  await pausa(800);
  console.log('RIQUADRO valore', await fr.locator('#f').inputValue(), await fr.evaluate(() => document.activeElement && document.activeElement.id));
});

for (const [nome, script] of [
  ['window-cattura', "window.addEventListener('contextmenu', (e) => e.preventDefault(), true);"],
  ['documento', "document.addEventListener('contextmenu', (e) => e.preventDefault());"],
  ['attributo', "document.body.setAttribute('oncontextmenu', 'return false');"],
  ['elemento-stop', "document.getElementById('z').addEventListener('contextmenu', (e) => { e.preventDefault(); e.stopImmediatePropagation(); });"],
]) {
  test(`sito che annulla il tasto destro (${nome}): il menu si apre nello strato`, async ({ app, openTab, testServer }) => {
    await pronto(app);
    const page = await testServer.openReady(openTab, `<!doctype html><body style="margin:0;height:100vh"><div id="z" style="position:absolute;left:100px;top:100px;width:300px;height:200px;background:#eee">zona</div><script>${script}</script></body>`);
    await page.waitForFunction(() => document.documentElement.dataset.filoContentReady === '1', null, { timeout: 8000 });
    await page.mouse.click(200, 200, { button: 'right' });
    await pausa(1500);
    console.log('ANNULLA', nome, JSON.stringify({ aperto: (await statoDelloStrato(app)).aperto, voci: await menuDi(page).principale.count() }));
  });
}

test('icona trascinata dal menu dello strato alla barra laterale', async ({ app, openTab, testServer }) => {
  test.setTimeout(60_000);
  const { barraPage, statoBarra } = await import('../../helpers/barra.mjs');
  await pronto(app);
  const page = await testServer.openReady(openTab, `<!doctype html><html><body style="margin:0;padding:12px 16px;font:16px sans-serif;height:1400px">
    <p id="p">Un paragrafo che comincia vicino al bordo sinistro.</p></body></html>`);
  await page.waitForFunction(() => document.documentElement.dataset.filoContentReady === '1', null, { timeout: 8000 });
  await barraPage(app);
  await page.mouse.click(20, 24, { button: 'right' });
  const menu = menuDi(page);
  const strato = menu.superficie;
  const icona = menu.locator('.sn-menu [data-sn-icon-id="share"]').first();
  await expect(icona).toBeVisible();
  const box = await icona.boundingBox();
  await strato.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await strato.mouse.down();
  await strato.mouse.move(box.x + box.width / 2 + 30, box.y + box.height / 2 + 2, { steps: 4 });
  await pausa(400);
  const sopraMenu = (await statoBarra(app)).aperta;
  await strato.mouse.move(6, 200, { steps: 8 });
  await pausa(1200);
  const alBordo = (await statoBarra(app)).aperta;
  await strato.mouse.up();
  await pausa(1200);
  console.log('BARRA', JSON.stringify({ sopraMenu, alBordo, bar: (await statoBarra(app)).bar }));
});
