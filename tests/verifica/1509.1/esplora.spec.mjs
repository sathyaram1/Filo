// Esplorazione del giro 3 (#1509.1): si cancella prima della critica.
import { test, expect } from '../../fixtures/electron.mjs';
import { statoDi, conta, paginaDelloStrato, nelMondoDiFilo } from '../../helpers/riquadri.mjs';

const pagina = (corpo = '') => `<!doctype html><html><head><meta charset="utf-8"></head><body style="margin:0;padding:40px;font:16px sans-serif">`
  + `<p style="font-size:20px">Il <span id="parola">gatto</span> dorme.</p>${corpo}</body></html>`;

let RISPOSTA = 'The cat sleeps.';
async function modelloFinto(app, testo) {
  await app.evaluate(async (_e, t) => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'k-test' },
      models: { [C.ACTIONS.TRANSLATE_SELECTION]: 'deepseek-flash', [C.ACTIONS.EDIT_TEXT]: 'deepseek-flash' },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
    });
    const orig = globalThis.SN_PROVIDER_OPENROUTER;
    globalThis.SN_PROVIDER_OPENROUTER = {
      ...orig,
      complete: async () => ({ text: 'ok', usage: {} }),
      streamComplete: async ({ onDelta }) => { onDelta(t); return { text: t, usage: {} }; },
    };
  }, testo || RISPOSTA);
}
const comando = (app, nome) => app.evaluate(({ BrowserWindow }, c) => {
  const win = BrowserWindow.getAllWindows().find((w) => w._filoTabs);
  globalThis.__filoShortcuts.dispatch(c, win);
}, nome);
const statoStrato = (app, u) => app.evaluate(({ BrowserWindow, webContents }, url) => {
  const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs);
  const tab = w._filoTabs.tabs.find((t) => t.view?.webContents?.getURL() === url);
  const st = w._filoTabs.riquadri.stato(tab.view.webContents);
  const f = webContents.getFocusedWebContents();
  return { st, tab: tab.view.getBounds(), fuoco: f ? String(f.getURL()) : null, attiva: w._filoTabs.activeId === tab.id };
}, u);

async function traduci(app, p) {
  await app.evaluate(({ BrowserWindow }, u) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs);
    w.show(); w.focus();
    w._filoTabs.tabs.find((t) => t.view?.webContents?.getURL() === u).view.webContents.focus();
  }, p.url());
  await p.locator('#parola').dblclick();
  await comando(app, 'translate-selection');
  await expect.poll(async () => (await statoDi(app, p, '.sn-popup-body'))?.testo || '', { timeout: 15_000 }).toContain('cat');
}

test('cambio scheda e ritorno', async ({ app, openTab, testServer }) => {
  test.setTimeout(90_000);
  await modelloFinto(app);
  const p = await testServer.openReady(openTab, pagina());
  await traduci(app, p);
  console.log('A aperta', JSON.stringify(await statoStrato(app, p.url())));
  const q = await testServer.openReady(openTab, pagina());
  await p.waitForTimeout(500);
  console.log('A dietro', JSON.stringify(await statoStrato(app, p.url())));
  await app.evaluate(({ BrowserWindow }, u) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs);
    const t = w._filoTabs.tabs.find((x) => x.view?.webContents?.getURL() === u);
    w._filoTabs.activate(t.id);
  }, p.url());
  await p.waitForTimeout(800);
  console.log('A tornata', JSON.stringify(await statoStrato(app, p.url())), await conta(app, p, '.sn-popup'));
  // finestra ridimensionata
  await app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs); w.setSize(900, 600); });
  await p.waitForTimeout(800);
  console.log('A ridimensionata', JSON.stringify(await statoStrato(app, p.url())));
  void q;
});

test('selezione e fuoco dopo Esc', async ({ app, openTab, testServer }) => {
  test.setTimeout(90_000);
  await modelloFinto(app);
  const p = await testServer.openReady(openTab, pagina('<input id="campo">'));
  await traduci(app, p);
  console.log('prima Esc', JSON.stringify(await statoStrato(app, p.url())), await p.evaluate(() => String(getSelection())));
  const strato = await paginaDelloStrato(app, p);
  await strato.keyboard.press('Escape');
  await expect.poll(() => conta(app, p, '.sn-popup')).toBe(0);
  await p.waitForTimeout(500);
  console.log('dopo Esc', JSON.stringify(await statoStrato(app, p.url())), 'sel=', await p.evaluate(() => String(getSelection())));
});

test('collegamento nella risposta', async ({ app, openTab, testServer }) => {
  test.setTimeout(90_000);
  const dest = testServer.html('<h1>destinazione</h1>');
  await modelloFinto(app, `Vedi [la pagina](${dest}) qui.`);
  const p = await testServer.openReady(openTab, pagina());
  await traduci(app, p);
  const a = await statoDi(app, p, 'a.filo-md-link');
  console.log('link', JSON.stringify(a));
  const strato = await paginaDelloStrato(app, p);
  await strato.mouse.click(a.x + a.width / 2, a.y + a.height / 2);
  await p.waitForTimeout(2000);
  const urls = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs.tabs.map((t) => t.view.webContents.getURL()));
  console.log('schede', JSON.stringify(urls), dest);
});

test('navigazione dalla pagina con la risposta aperta', async ({ app, openTab, testServer }) => {
  test.setTimeout(90_000);
  await modelloFinto(app);
  const dest = testServer.html('<h1>altrove</h1>');
  const p = await testServer.openReady(openTab, pagina(`<p><a id="vai" href="${dest}" style="font-size:30px">vai</a></p>`));
  await traduci(app, p);
  const b = await p.locator('#vai').boundingBox();
  const strato = await paginaDelloStrato(app, p);
  await strato.mouse.click(b.x + b.width / 2, b.y + b.height / 2);
  await expect.poll(() => p.url()).toBe(dest);
  await p.waitForTimeout(800);
  console.log('dopo navigazione', JSON.stringify(await statoStrato(app, p.url())), await conta(app, p, '.sn-popup'));
});

test('zoom 150% posa accanto alla parola', async ({ app, openTab, testServer }) => {
  test.setTimeout(90_000);
  await modelloFinto(app);
  const p = await testServer.openReady(openTab, pagina());
  await app.evaluate(({ BrowserWindow }, u) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs);
    w._filoTabs.tabs.find((t) => t.view?.webContents?.getURL() === u).view.webContents.setZoomFactor(1.5);
  }, p.url());
  await p.waitForTimeout(500);
  await traduci(app, p);
  const r = await p.locator('#parola').evaluate((el) => { const b = el.getBoundingClientRect(); return { x: b.x * 1.5, y: b.y * 1.5, b: b.bottom * 1.5 }; });
  const pop = await statoDi(app, p, '.sn-popup');
  console.log('parola(vista)', JSON.stringify(r), 'popup', JSON.stringify({ l: pop.left, t: pop.top, b: pop.bottom }));
});

test('feedback aperto due volte', async ({ app, openTab, testServer }) => {
  test.setTimeout(90_000);
  const p = await testServer.openReady(openTab, pagina());
  await nelMondoDiFilo(app, p, () => globalThis.SN_FEEDBACK_UI.open());
  await expect.poll(() => conta(app, p, '.sn-fb-overlay')).toBe(1);
  await nelMondoDiFilo(app, p, () => globalThis.SN_FEEDBACK_UI.open());
  await p.waitForTimeout(800);
  console.log('feedback overlay', await conta(app, p, '.sn-fb-overlay'));
});
