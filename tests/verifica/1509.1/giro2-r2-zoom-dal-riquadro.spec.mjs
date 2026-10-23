// Verifica #1509.1 giro 2, rilievo 2: con la tastiera in un riquadro di Filo sopra un sito, Ctrl+più e Ctrl+meno
// ingrandiscono e rimpiccioliscono la pagina come quando il riquadro stava nella pagina.
import { test, expect } from '../../fixtures/electron.mjs';
import { statoDi } from '../../helpers/riquadri.mjs';

const pagina = '<!doctype html><html><head><meta charset="utf-8"></head><body style="padding:40px;font:20px sans-serif">'
  + '<p>Il <span id="parola">gatto</span> dorme.</p></body></html>';

async function modelloFinto(app) {
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
}

const zoomDi = (app, u) => app.evaluate(({ BrowserWindow }, url) => BrowserWindow.getAllWindows().find((x) => x._filoTabs)
  ._filoTabs.tabs.find((t) => t.view?.webContents?.getURL() === url).view.webContents.getZoomFactor(), u);

// Il tasto arriva dove sta la tastiera, come una pressione vera.
const premi = (app, keyCode, modifiers) => app.evaluate(({ webContents }, { k, m }) => {
  const f = webContents.getFocusedWebContents();
  if (!f || !String(f.getURL()).startsWith('filo://riquadri/')) throw new Error(`la tastiera non è nello strato: ${f && f.getURL()}`);
  f.sendInputEvent({ type: 'keyDown', keyCode: k, modifiers: m });
  f.sendInputEvent({ type: 'keyUp', keyCode: k, modifiers: m });
}, { k: keyCode, m: modifiers });

test('r2 con la traduzione aperta su un sito, Ctrl+più ingrandisce la pagina e Ctrl+meno la rimpicciolisce', async ({ app, openTab, testServer }) => {
  test.setTimeout(60_000);
  await modelloFinto(app);
  const p = await testServer.openReady(openTab, pagina);
  const url = p.url();
  await app.evaluate(({ BrowserWindow }, u) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs);
    w.show(); w.focus();
    w._filoTabs.tabs.find((t) => t.view?.webContents?.getURL() === u).view.webContents.focus();
  }, url);
  await p.locator('#parola').dblclick();
  await app.evaluate(({ BrowserWindow }) => {
    globalThis.__filoShortcuts.dispatch('translate-selection', BrowserWindow.getAllWindows().find((w) => w._filoTabs));
  });
  await expect.poll(async () => (await statoDi(app, p, '.sn-popup-body'))?.testo || '', { timeout: 15_000 }).toContain('The cat');
  await expect.poll(() => app.evaluate(({ webContents }) => String(webContents.getFocusedWebContents()?.getURL() || '')))
    .toMatch(/^filo:\/\/riquadri\//);
  const prima = await zoomDi(app, url);
  await premi(app, '=', ['control']);
  await expect.poll(() => zoomDi(app, url), { timeout: 5000 }).toBeGreaterThan(prima);
  const ingrandita = await zoomDi(app, url);
  await premi(app, '-', ['control']);
  await expect.poll(() => zoomDi(app, url), { timeout: 5000 }).toBeLessThan(ingrandita);
});
