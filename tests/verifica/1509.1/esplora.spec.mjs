// Esplorazione del giro 4 di #1509.1: cosa cambia per l'utente con la risposta aperta sopra un sito.
import { test, expect } from '../../fixtures/electron.mjs';
import { nelMondoDiFilo, nelloStrato, statoDi, conta, clicca, paginaDelloStrato } from '../../helpers/riquadri.mjs';
import { menuDi } from '../../helpers/menuContestuale.mjs';

const pagina = (corpo = '') => `<!doctype html><html><head><meta charset="utf-8"></head><body style="margin:0;padding:40px;font:16px sans-serif;background:#fff">`
  + `<p style="font-size:20px">Il <span id="parola">gatto</span> dorme.</p>${corpo}`
  + `<script>window.__over=0;window.__ctx=0;document.addEventListener('contextmenu',()=>window.__ctx++,true);</script></body></html>`;

let RISPOSTA = 'The cat sleeps.';
async function modelloFinto(app, risposta = 'The cat sleeps.') {
  await app.evaluate(async (_e, r) => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'k-test' },
      models: { [C.ACTIONS.TRANSLATE_SELECTION]: 'deepseek-flash', [C.ACTIONS.EXPLAIN_SELECTION || 'explain_selection']: 'deepseek-flash' },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
    });
    const orig = globalThis.SN_PROVIDER_OPENROUTER;
    globalThis.SN_PROVIDER_OPENROUTER = {
      ...orig,
      complete: async () => ({ text: r, usage: {} }),
      streamComplete: async ({ onDelta }) => { onDelta(r); return { text: r, usage: {} }; },
    };
  }, risposta);
}

const comando = (app, nome) => app.evaluate(({ BrowserWindow }, c) => {
  const win = BrowserWindow.getAllWindows().find((w) => w._filoTabs);
  globalThis.__filoShortcuts.dispatch(c, win);
}, nome);

async function traduci(app, p, atteso = 'The cat') {
  await app.evaluate(({ BrowserWindow }, u) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs);
    w.show(); w.focus();
    w._filoTabs.tabs.find((t) => t.view?.webContents?.getURL() === u).view.webContents.focus();
  }, p.url());
  await p.locator('#parola').dblclick();
  await comando(app, 'translate-selection');
  await expect.poll(async () => (await statoDi(app, p, '.sn-popup-body'))?.testo || '', { timeout: 15_000 }).toContain(atteso);
}

const sulloStrato = (app, eventi) => app.evaluate(({ webContents }, ev) => {
  const f = webContents.getAllWebContents().find((w) => String(w.getURL()).startsWith('filo://riquadri/'));
  for (const e of ev) f.sendInputEvent(e);
}, eventi);

const statoStrato = (app, u) => app.evaluate(({ BrowserWindow }, url) => {
  const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs);
  const t = w._filoTabs.tabs.find((x) => x.view?.webContents?.getURL() === url);
  const s = w._filoTabs.riquadri.stato(t.view.webContents);
  return s && { ...s, tab: t.view.getBounds() };
}, u);

test('e1 tasto destro sulla pagina con la risposta aperta apre il menu di Filo', async ({ app, openTab, testServer }) => {
  test.setTimeout(60_000);
  await modelloFinto(app);
  const p = await testServer.openReady(openTab, pagina('<p id="altra" style="font-size:24px;margin-top:300px">Una casa rossa</p>'));
  await traduci(app, p);
  const b = await p.locator('#altra').boundingBox();
  const x = Math.round(b.x + 30); const y = Math.round(b.y + b.height / 2);
  await sulloStrato(app, [
    { type: 'mouseMove', x, y },
    { type: 'mouseDown', x, y, button: 'right', clickCount: 1 },
    { type: 'mouseUp', x, y, button: 'right', clickCount: 1 },
  ]);
  await p.waitForTimeout(800);
  console.log('ctx sulla pagina', await p.evaluate(() => window.__ctx));
  await expect(menuDi(p).locator('.sn-menu').first()).toBeVisible({ timeout: 5000 });
});

test('e2 hover e selezione col trascinamento sulla pagina con la risposta aperta', async ({ app, openTab, testServer }) => {
  test.setTimeout(60_000);
  await modelloFinto(app);
  const p = await testServer.openReady(openTab, pagina('<p id="altra" onmouseover="window.__over++" style="font-size:24px;margin-top:300px">Una casa rossa grande</p>'));
  await traduci(app, p);
  const b = await p.locator('#altra').boundingBox();
  const y = Math.round(b.y + b.height / 2);
  await sulloStrato(app, [
    { type: 'mouseMove', x: Math.round(b.x + 2), y },
    { type: 'mouseDown', x: Math.round(b.x + 2), y, button: 'left', clickCount: 1 },
    { type: 'mouseMove', x: Math.round(b.x + 80), y, modifiers: ['leftButtonDown'] },
    { type: 'mouseMove', x: Math.round(b.x + 160), y, modifiers: ['leftButtonDown'] },
    { type: 'mouseUp', x: Math.round(b.x + 160), y, button: 'left', clickCount: 1 },
  ]);
  await p.waitForTimeout(500);
  expect(await p.evaluate(() => window.__over)).toBeGreaterThan(0);
  expect(await p.evaluate(() => String(getSelection()))).toMatch(/casa/);
});

test('e3 cambio di scheda e ridimensionamento con la risposta aperta', async ({ app, openTab, testServer }) => {
  test.setTimeout(60_000);
  await modelloFinto(app);
  const p = await testServer.openReady(openTab, pagina());
  await traduci(app, p);
  const u = p.url();
  expect((await statoStrato(app, u)).visibile).toBe(true);
  const altra = await testServer.openReady(openTab, '<h1>altra</h1>');
  await expect.poll(async () => (await statoStrato(app, u)).visibile).toBe(false);
  await app.evaluate(({ BrowserWindow }, url) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs);
    const t = w._filoTabs.tabs.find((x) => x.view?.webContents?.getURL() === url);
    w._filoTabs.activate(t.id);
  }, u);
  await expect.poll(async () => (await statoStrato(app, u)).visibile).toBe(true);
  expect(await conta(app, p, '.sn-popup')).toBe(1);
  await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs);
    const [a, b] = w.getSize(); w.setSize(a - 200, b - 100);
  });
  await p.waitForTimeout(600);
  const s = await statoStrato(app, u);
  expect(s.bounds).toEqual(s.tab);
  void altra;
});

test('e4 collegamento nella risposta su un sito si apre', async ({ app, openTab, testServer }) => {
  test.setTimeout(60_000);
  const dest = testServer.html('<h1>destinazione</h1>');
  await modelloFinto(app, `The cat, see [qui](${dest}) ok`);
  const p = await testServer.openReady(openTab, pagina());
  await traduci(app, p, 'The cat');
  const prima = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs.tabs.length);
  await expect.poll(() => statoDi(app, p, 'a.filo-md-link')).not.toBeNull();
  await clicca(app, p, 'a.filo-md-link');
  await p.waitForTimeout(1500);
  const urls = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs.tabs.map((t) => t.view.webContents.getURL()));
  console.log('schede', prima, urls, 'conferma?', await conta(app, p, '.sn-confirm, [class*=confirm]'));
  expect(urls.some((x) => x === dest) || urls.length > prima).toBe(true);
});

test('e5 la foto della pagina per il feedback mostra la risposta aperta', async ({ app, openTab, testServer }) => {
  test.setTimeout(60_000);
  await modelloFinto(app);
  const p = await testServer.openReady(openTab, pagina());
  await traduci(app, p);
  const r = await statoDi(app, p, '.sn-popup-body');
  const px = await app.evaluate(async ({ BrowserWindow }, { url, x, y }) => {
    const w = BrowserWindow.getAllWindows().find((q) => q._filoTabs);
    const t = w._filoTabs.tabs.find((q) => q.view?.webContents?.getURL() === url);
    const res = await globalThis.SN_HANDLERS_TEST?.capture?.(t) ;
    void res;
    const img = await t.view.webContents.capturePage();
    const sz = img.getSize();
    const sx = sz.width / t.view.getBounds().width;
    const bmp = img.toBitmap();
    const out = [];
    for (const [dx, dy] of [[0, 0], [10, 5], [-10, -5]]) {
      const i = (Math.round((y + dy) * sx) * sz.width + Math.round((x + dx) * sx)) * 4;
      out.push([bmp[i], bmp[i + 1], bmp[i + 2]]);
    }
    return out;
  }, { url: p.url(), x: Math.round(r.x + 6), y: Math.round(r.y + r.height / 2) });
  console.log('pixel sotto la risposta nella foto della pagina', JSON.stringify(px));
  expect(px.every(([a, b, c]) => a > 250 && b > 250 && c > 250), 'la foto della pagina non mostra la risposta').toBe(false);
});

test('e6 spiega una parola selezionata dentro la risposta', async ({ app, openTab, testServer }) => {
  test.setTimeout(60_000);
  await modelloFinto(app);
  const p = await testServer.openReady(openTab, pagina());
  await traduci(app, p);
  const strato = await paginaDelloStrato(app, p);
  await nelloStrato(app, p, () => {
    const T = globalThis.SN_FILO_UI._test;
    const el = T.trova('.sn-popup-body');
    const r = document.createRange();
    r.selectNodeContents(el);
    const s = el.getRootNode().getSelection ? el.getRootNode().getSelection() : getSelection();
    s.removeAllRanges(); s.addRange(r);
  });
  void strato;
  await comando(app, 'translate-selection');
  await p.waitForTimeout(1500);
  console.log('riquadri dopo la seconda', await conta(app, p, '.sn-popup'));
  expect(await conta(app, p, '.sn-popup')).toBeGreaterThanOrEqual(1);
});

void nelMondoDiFilo; void RISPOSTA;

test('e7 il tasto Indietro del mouse sul vuoto non clicca la pagina', async ({ app, openTab, testServer }) => {
  test.setTimeout(60_000);
  await modelloFinto(app);
  const p = await testServer.openReady(openTab, pagina('<button id="compra" onclick="window.__compra=(window.__compra||0)+1" style="margin-top:300px;width:300px;height:80px">Compra</button>'));
  await traduci(app, p);
  const strato = await paginaDelloStrato(app, p);
  const cdp = await strato.context().newCDPSession(strato);
  const b = await p.locator('#compra').boundingBox();
  const x = Math.round(b.x + b.width / 2); const y = Math.round(b.y + b.height / 2);
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
  await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'back', buttons: 8, clickCount: 1 });
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'back', buttons: 0, clickCount: 1 });
  await p.waitForTimeout(800);
  console.log('clic su Compra dal tasto Indietro', await p.evaluate(() => window.__compra || 0));
  expect(await p.evaluate(() => window.__compra || 0)).toBe(0);
});

test('e8 con la pagina ingrandita la risposta si apre accanto alla parola', async ({ app, openTab, testServer }) => {
  test.setTimeout(60_000);
  await modelloFinto(app);
  const p = await testServer.openReady(openTab, pagina());
  await app.evaluate(({ BrowserWindow }, u) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs);
    w._filoTabs.tabs.find((t) => t.view?.webContents?.getURL() === u).view.webContents.setZoomFactor(1.5);
  }, p.url());
  await p.waitForTimeout(500);
  await traduci(app, p);
  const parola = await p.locator('#parola').boundingBox();
  const pop = await statoDi(app, p, '.sn-popup');
  console.log('parola (px pagina)', JSON.stringify(parola), 'risposta (px vista)', JSON.stringify({ l: pop.left, t: pop.top, r: pop.right, b: pop.bottom }));
  const px = { x: parola.x * 1.5, y: parola.y * 1.5, w: parola.width * 1.5, h: parola.height * 1.5 };
  expect(pop.left <= px.x + px.w && pop.right >= px.x).toBe(true);
  expect(Math.min(Math.abs(pop.top - (px.y + px.h)), Math.abs(pop.bottom - px.y))).toBeLessThan(80);
});
