// #1509.1 giro 3, r2 — Con la risposta di Filo aperta su un sito, scorrere la pagina col dito (schermo tattile) deve
// scorrerla, come senza riquadro: fuori dai riquadri la pagina è dell'utente.

import { test, expect } from '../../fixtures/electron.mjs';
import { statoDi, conta, paginaDelloStrato } from '../../helpers/riquadri.mjs';

const pagina = `<!doctype html><html><head><meta charset="utf-8"></head><body style="margin:0;padding:40px;font:16px sans-serif">`
  + '<p style="font-size:20px">Il <span id="parola">gatto</span> dorme.</p><div style="height:4000px"></div></body></html>';

test('r2 con la risposta aperta il dito scorre la pagina', async ({ app, openTab, testServer }) => {
  test.setTimeout(90_000);
  await app.evaluate(async () => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'k-test' },
      models: { [C.ACTIONS.TRANSLATE_SELECTION]: 'deepseek-flash' },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
    });
    const orig = globalThis.SN_PROVIDER_OPENROUTER;
    globalThis.SN_PROVIDER_OPENROUTER = {
      ...orig,
      streamComplete: async ({ onDelta }) => { onDelta('The cat sleeps.'); return { text: 'The cat sleeps.', usage: {} }; },
    };
  });
  const p = await testServer.openReady(openTab, pagina);
  const scorri = async (dove) => {
    const s = await dove.context().newCDPSession(dove);
    await s.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 700, y: 600 }] });
    for (let i = 1; i <= 10; i++) await s.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 700, y: 600 - i * 30 }] });
    await s.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  };
  // Senza riquadro lo stesso gesto scorre la pagina: il controllo che l'ambiente lo sa fare.
  await scorri(p);
  await expect.poll(() => p.evaluate(() => scrollY)).toBeGreaterThan(100);
  await p.evaluate(() => scrollTo(0, 0));

  await app.evaluate(({ BrowserWindow }, u) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs);
    w.show(); w.focus();
    w._filoTabs.tabs.find((t) => t.view?.webContents?.getURL() === u).view.webContents.focus();
  }, p.url());
  await p.locator('#parola').dblclick();
  await app.evaluate(({ BrowserWindow }) => {
    globalThis.__filoShortcuts.dispatch('translate-selection', BrowserWindow.getAllWindows().find((w) => w._filoTabs));
  });
  await expect.poll(async () => (await statoDi(app, p, '.sn-popup-body'))?.testo || '', { timeout: 15_000 }).toContain('The cat');
  // Il dito tocca la pagina fuori dalla risposta: lì sopra c'è lo strato.
  await scorri(await paginaDelloStrato(app, p));
  await expect.poll(() => p.evaluate(() => scrollY)).toBeGreaterThan(100);
  expect(await conta(app, p, '.sn-popup')).toBe(1);
});
