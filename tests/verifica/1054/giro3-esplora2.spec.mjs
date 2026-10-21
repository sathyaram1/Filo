// Esplorazione del giro 3 di #1054, seconda parte: altre strade del menu con lo strato acceso.
import { test, expect } from '../../fixtures/electron.mjs';
import { menuDi, paginaDelloStrato, statoDelloStrato } from '../../helpers/menuContestuale.mjs';

const pausa = (ms) => new Promise((r) => { setTimeout(r, ms); });

async function pronto(app) {
  await paginaDelloStrato(app);
  await expect.poll(async () => (await statoDelloStrato(app))?.pronta).toBe(true);
}

async function apriPagina(openTab, testServer, html, opts) {
  const page = await testServer.openReady(openTab, html, opts);
  await page.waitForFunction(() => document.documentElement.dataset.filoContentReady === '1', null, { timeout: 8000 });
  return page;
}

const schede = (shell) => shell.evaluate(() => document.querySelectorAll('.tab').length);

test.use({ stratoDelMenu: true });

test('Apri in nuova tab da un collegamento', async ({ app, shell, openTab, testServer }) => {
  await pronto(app);
  const dest = testServer.html('<!doctype html><title>Dest</title>ok');
  const page = await apriPagina(openTab, testServer, `<!doctype html><body style="margin:40px"><a id="l" href="${dest}">vai di qua</a></body>`);
  await page.locator('#l').click({ button: 'right' });
  await expect(menuDi(page).principale).toBeVisible();
  const prima = await schede(shell);
  await menuDi(page).voce('Apri in nuova tab').click();
  await expect.poll(() => schede(shell), { timeout: 8000 }).toBeGreaterThan(prima);
});

test('Taglia in un campo toglie il testo e lo mette negli appunti', async ({ app, openTab, testServer }) => {
  await pronto(app);
  await app.evaluate(({ clipboard }) => clipboard.writeText('vecchio'));
  const page = await apriPagina(openTab, testServer, '<!doctype html><body style="margin:40px"><input id="c" value="ciao mondo" style="width:300px"></body>');
  await page.locator('#c').click();
  await page.evaluate(() => { const c = document.getElementById('c'); c.setSelectionRange(0, 4); });
  const b = await page.locator('#c').boundingBox();
  await page.mouse.click(b.x + 15, b.y + b.height / 2, { button: 'right' });
  await expect(menuDi(page).principale).toBeVisible();
  await menuDi(page).voce('Taglia').click();
  await expect.poll(() => page.locator('#c').inputValue()).toBe(' mondo');
  await expect.poll(() => app.evaluate(({ clipboard }) => clipboard.readText())).toBe('ciao');
});

test('Shift+F10 in un campo apre il menu nello strato', async ({ app, openTab, testServer }) => {
  await pronto(app);
  const page = await apriPagina(openTab, testServer, '<!doctype html><body style="margin:40px"><textarea id="c">testo</textarea></body>');
  await page.locator('#c').click();
  await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito);
    const t = w._filoTabs.tabs.find((x) => x.id === w._filoTabs.activeId);
    t.view.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'F10', modifiers: ['shift'] });
    t.view.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'F10', modifiers: ['shift'] });
  });
  await expect.poll(async () => (await statoDelloStrato(app))?.aperto, { timeout: 5000 }).toBe(true);
  await expect(menuDi(page).voce('Incolla')).toBeVisible();
});

test('pagina ingrandita: il menu si apre sul punto del clic', async ({ app, openTab, testServer }) => {
  await pronto(app);
  const page = await apriPagina(openTab, testServer, '<!doctype html><body style="margin:0"><p id="p" style="position:absolute;left:300px;top:200px">qui</p></body>');
  await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito);
    const t = w._filoTabs.tabs.find((x) => x.id === w._filoTabs.activeId);
    t.view.webContents.setZoomFactor(1.5);
  });
  await pausa(500);
  const b = await page.locator('#p').boundingBox();
  await page.mouse.click(b.x + 5, b.y + 5, { button: 'right' });
  await expect(menuDi(page).principale).toBeVisible();
  const m = await menuDi(page).principale.boundingBox();
  const z = await page.evaluate(() => window.devicePixelRatio);
  console.log('ZOOM', JSON.stringify({ click: [b.x + 5, b.y + 5], menu: m, dpr: z, stato: (await statoDelloStrato(app)).punto }));
  expect(Math.abs(m.x - (b.x + 5) * 1.5)).toBeLessThan(6);
  expect(Math.abs(m.y - (b.y + 5) * 1.5)).toBeLessThan(6);
});
