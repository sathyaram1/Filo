// Esplorazione del giro 6 di #1509.1: strade intorno ai riquadri nello strato sopra la scheda.

import { test, expect } from '../../fixtures/electron.mjs';
import { nelMondoDiFilo, statoDi, clicca, conta, paginaDelloStrato } from '../../helpers/riquadri.mjs';

const pagina = (corpo = '') => `<!doctype html><html><head><meta charset="utf-8"></head><body style="margin:0;padding:40px;font:16px sans-serif">`
  + `<p style="font-size:20px">Il <span id="parola">gatto</span> dorme sul <span id="altra">divano</span>.</p>${corpo}`
  + `<script>window.__sopra=0;document.addEventListener('mouseover',(e)=>{if(e.target.id==='zona')window.__sopra++;});</script></body></html>`;

async function modelloFinto(app, risposta) {
  await app.evaluate(async (_e, r) => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'k-test' },
      models: { [C.ACTIONS.TRANSLATE_SELECTION]: 'deepseek-flash', [C.ACTIONS.EXPLAIN_SELECTION || 'explain']: 'deepseek-flash' },
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

const strato = (app, u) => app.evaluate(({ BrowserWindow }, url) => {
  const tm = BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs;
  const tab = tm.tabs.find((t) => t.view?.webContents?.getURL() === url);
  const s = tab && tm.riquadri.strati.get(tab.view.webContents);
  if (!s) return null;
  return { visibile: s.vista.getVisible(), b: s.vista.getBounds(), tab: tab.view.getBounds(), attiva: tm.activeId === tab.id };
}, u);

async function traduci(app, p, testo = 'The cat sleeps.') {
  await p.locator('#parola').dblclick();
  await comando(app, 'translate-selection');
  await expect.poll(async () => (await statoDi(app, p, '.sn-popup-body'))?.testo || '', { timeout: 15_000 }).toContain(testo);
}

test('link nella risposta', async ({ app, openTab, testServer }) => {
  test.setTimeout(90_000);
  const dest = testServer.html('<h1>destinazione</h1>');
  await modelloFinto(app, `The cat. Vedi [la pagina](${dest}).`);
  const p = await testServer.openReady(openTab, pagina());
  await traduci(app, p, 'The cat');
  await expect.poll(async () => (await statoDi(app, p, '.sn-popup-body a'))?.testo || '').toContain('la pagina');
  await clicca(app, p, '.sn-popup-body a');
  await expect.poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()
    .find((w) => w._filoTabs)._filoTabs.tabs.map((t) => t.view.webContents.getURL())), { timeout: 8000 }).toContain(dest);
});

test('cambio scheda, ridimensiona, barra laterale', async ({ app, openTab, testServer }) => {
  test.setTimeout(120_000);
  await modelloFinto(app, 'The cat sleeps.');
  const p = await testServer.openReady(openTab, pagina());
  await traduci(app, p);
  const u = p.url();
  let st = await strato(app, u);
  console.log('aperto', JSON.stringify(st));
  expect(st.visibile).toBe(true);
  const altra = await testServer.openReady(openTab, '<h1>altra</h1>');
  await expect.poll(async () => (await strato(app, u)).visibile).toBe(false);
  await app.evaluate(({ BrowserWindow }, url) => {
    const tm = BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs;
    tm.activate(tm.tabs.find((t) => t.view.webContents.getURL() === url).id);
  }, u);
  await expect.poll(async () => (await strato(app, u)).visibile).toBe(true);
  st = await strato(app, u);
  console.log('tornato', JSON.stringify(st));
  expect(st.b).toEqual(st.tab);
  expect(await conta(app, p, '.sn-popup')).toBe(1);

  await app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs); const [a, b] = w.getSize(); w.setSize(a - 200, b - 100); });
  await p.waitForTimeout(800);
  st = await strato(app, u);
  console.log('ridimensionata', JSON.stringify(st));
  expect(st.b).toEqual(st.tab);

  await app.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows().find((x) => x._filoTabs)._filoTabs.barra.commuta('tasto'); });
  await p.waitForTimeout(1200);
  st = await strato(app, u);
  console.log('barra', JSON.stringify(st));
  expect(st.b).toEqual(st.tab);
  void altra;
});

test('con la risposta aperta: passaggio sopra, doppio clic su un\'altra parola, seconda traduzione', async ({ app, openTab, testServer }) => {
  test.setTimeout(90_000);
  await modelloFinto(app, 'The cat sleeps.');
  const p = await testServer.openReady(openTab, pagina('<div id="zona" style="margin-top:300px;width:300px;height:100px;background:#eee">zona</div>'));
  await traduci(app, p);
  const sopra = await paginaDelloStrato(app, p);
  const z = await p.locator('#zona').boundingBox();
  await sopra.mouse.move(z.x + 10, z.y + 10);
  await sopra.mouse.move(z.x + 40, z.y + 40);
  await expect.poll(() => p.evaluate(() => window.__sopra)).toBeGreaterThan(0);
  const a = await p.locator('#altra').boundingBox();
  await sopra.mouse.dblclick(a.x + a.width / 2, a.y + a.height / 2);
  await expect.poll(() => p.evaluate(() => String(getSelection()).trim())).toBe('divano');
  await comando(app, 'translate-selection');
  await p.waitForTimeout(1500);
  console.log('popup', await conta(app, p, '.sn-popup'));
  const shot = await app.evaluate(async ({ BrowserWindow }) => (await BrowserWindow.getAllWindows().find((w) => w._filoTabs).capturePage()).toPNG().toString('base64'));
  require('node:fs').mkdirSync('tests/.shots', { recursive: true });
  require('node:fs').writeFileSync('tests/.shots/1509-giro6-due.png', Buffer.from(shot, 'base64'));
});
