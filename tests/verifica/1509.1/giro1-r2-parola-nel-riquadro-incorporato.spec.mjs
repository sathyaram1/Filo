// Verifica #1509.1 giro 1, rilievo 2: la prima traduzione di una parola dentro un riquadro incorporato di un sito
// deve aprirsi vicino alla parola, non nell'angolo in alto a sinistra della pagina.
import { test, expect } from '../../fixtures/electron.mjs';
import { statoDi, conta } from '../../helpers/riquadri.mjs';

test('r2 la prima traduzione di una parola in un riquadro incorporato si apre accanto alla parola', async ({ app, openTab, testServer }) => {
  test.setTimeout(60_000);
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
      streamComplete: async ({ onDelta }) => { onDelta('The mouse runs.'); return { text: 'The mouse runs.', usage: {} }; },
    };
  });
  const dentro = testServer.html('<!doctype html><body style="margin:10px;font:18px sans-serif">Il <span id="w">topo</span> corre.</body>');
  const p = await testServer.openReady(openTab, '<!doctype html><body style="margin:0;padding:40px;font:16px sans-serif">'
    + `<p>Una pagina con un riquadro.</p><iframe id="embed" src="${dentro}" width="420" height="100" style="margin-left:500px;margin-top:300px;border:1px solid #333"></iframe></body>`);
  await expect.poll(() => p.frames().length).toBeGreaterThan(1);
  await p.waitForTimeout(800);
  const box = await p.frameLocator('#embed').locator('#w').boundingBox();
  // Doppio clic vero sulla scheda, come lo fa l'utente.
  await app.evaluate(({ BrowserWindow }, { u, x, y }) => {
    const w = BrowserWindow.getAllWindows().find((q) => q._filoTabs);
    const wc = w._filoTabs.tabs.find((t) => t.view?.webContents?.getURL() === u).view.webContents;
    wc.sendInputEvent({ type: 'mouseMove', x, y });
    for (const c of [1, 2]) {
      wc.sendInputEvent({ type: 'mouseDown', x, y, button: 'left', clickCount: c });
      wc.sendInputEvent({ type: 'mouseUp', x, y, button: 'left', clickCount: c });
    }
  }, { u: p.url(), x: Math.round(box.x + box.width / 2), y: Math.round(box.y + box.height / 2) });
  await expect.poll(() => p.frames().find((f) => f !== p.mainFrame()).evaluate(() => String(getSelection()).trim())).toBe('topo');
  await app.evaluate(({ BrowserWindow }) => {
    globalThis.__filoShortcuts.dispatch('translate-selection', BrowserWindow.getAllWindows().find((w) => w._filoTabs));
  });
  await expect.poll(() => conta(app, p, '.sn-popup'), { timeout: 15_000 }).toBe(1);
  const pop = await statoDi(app, p, '.sn-popup');
  // Accanto: il riquadro della risposta tocca la colonna della parola e le sta sopra o sotto a meno di 250 px.
  expect(pop.left <= box.x + box.width && pop.right >= box.x, `risposta a x=${Math.round(pop.left)}…${Math.round(pop.right)}, parola a x=${Math.round(box.x)}`).toBe(true);
  const distanza = Math.min(Math.abs(pop.top - (box.y + box.height)), Math.abs(pop.bottom - box.y));
  expect(distanza, `risposta a y=${Math.round(pop.top)}…${Math.round(pop.bottom)}, parola a y=${Math.round(box.y)}`).toBeLessThan(250);
});
